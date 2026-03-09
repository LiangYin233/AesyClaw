import { join } from 'path';
import { mkdirSync, existsSync } from 'fs';
import { logger } from '../logger/index.js';
import type { Config } from '../types.js';
import type { CronJob } from '../cron/index.js';
import { ConfigLoader } from '../config/loader.js';
import { createServices, type Services } from './factory/ServiceFactory.js';
import { dispatchCronJob } from './app/cronDispatch.js';
import { setupConfigReload } from './app/configReload.js';
import { setupSignalHandlers } from './app/shutdown.js';
import { startChannels } from './app/channelStartup.js';
import { wireOutbound } from './app/outbound.js';

const log = logger.child({ prefix: 'Bootstrap' });

function ensureRuntimeDirectories(workspace: string, tempDir: string): void {
  if (!existsSync(workspace)) {
    mkdirSync(workspace, { recursive: true });
  }

  if (!existsSync(tempDir)) {
    mkdirSync(tempDir, { recursive: true });
  }
}

export async function bootstrap(port: number): Promise<void> {
  const config = await ConfigLoader.load() as Config;
  const workspace = join(process.cwd(), 'workspace');
  const tempDir = join(process.cwd(), '.aesyclaw', 'temp');

  ensureRuntimeDirectories(workspace, tempDir);

  log.info('Starting AesyClaw...');
  log.info(`Workspace: ${workspace}`);
  log.info(`Provider: ${config.agent.defaults.provider}, Model: ${config.agent.defaults.model}`);

  let servicesRef: Services | undefined;
  const onCronJob = async (job: CronJob): Promise<void> => {
    if (!servicesRef) {
      throw new Error('Services are not ready for cron dispatch');
    }

    await dispatchCronJob(servicesRef, workspace, job);
  };

  servicesRef = await createServices({
    workspace,
    tempDir,
    config,
    port,
    onCronJob
  });

  wireOutbound(servicesRef);
  setupConfigReload(servicesRef);
  await startChannels(servicesRef);
  setupSignalHandlers(servicesRef);

  servicesRef.agent.run().catch((error: Error) => {
    log.error(`Agent crashed: ${error.message}`);
    process.exit(1);
  });

  log.info('AesyClaw gateway started successfully');
}
