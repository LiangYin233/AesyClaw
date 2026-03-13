import { join } from 'path';
import { mkdirSync, existsSync } from 'fs';
import { logger } from '../observability/index.js';
import { CONSTANTS } from '../constants/index.js';
import type { Config } from '../types.js';
import type { CronJob } from '../cron/index.js';
import { ConfigLoader } from '../config/loader.js';
import { createServices, type Services } from './factory/ServiceFactory.js';
import { dispatchCronJob } from './app/cronDispatch.js';
import { setupConfigReload } from './app/configReload.js';
import { setupSignalHandlers } from './app/shutdown.js';

const log = logger.child('Bootstrap');

function startStartupLagMonitor(): () => void {
  const intervalMs = 250;
  const warnThresholdMs = 200;
  let expectedAt = Date.now() + intervalMs;
  let maxLagMs = 0;

  const timer = setInterval(() => {
    const now = Date.now();
    const lagMs = Math.max(0, now - expectedAt);
    maxLagMs = Math.max(maxLagMs, lagMs);

    expectedAt = now + intervalMs;
  }, intervalMs);

  return () => {
    clearInterval(timer);
    if (maxLagMs >= warnThresholdMs) {
      log.info('Startup event loop lag summary', {
        maxLagMs
      });
    }
  };
}

function ensureRuntimeDirectories(workspace: string, tempDir: string): void {
  if (!existsSync(workspace)) {
    mkdirSync(workspace, { recursive: true });
  }

  if (!existsSync(tempDir)) {
    mkdirSync(tempDir, { recursive: true });
  }
}

async function startChannels(services: Services): Promise<void> {
  const { channelManager } = services;
  const startedAt = Date.now();
  try {
    await Promise.race([
      channelManager.startAll(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Channel start timeout')), CONSTANTS.CHANNEL_START_TIMEOUT)
      )
    ]);
  } catch (error) {
    log.error('Channel startup failed', { error });
  }
  log.info('Channel startup finished', {
    channelCount: channelManager.getEnabledChannels().length,
    durationMs: Date.now() - startedAt
  });
}

export async function bootstrap(): Promise<void> {
  const startedAt = Date.now();
  const stopLagMonitor = startStartupLagMonitor();
  const config = await ConfigLoader.load() as Config;
  const port = config.server.apiPort ?? 18792;
  const workspace = join(process.cwd(), 'workspace');
  const tempDir = join(process.cwd(), '.aesyclaw', 'temp');

  ensureRuntimeDirectories(workspace, tempDir);

  log.info('Gateway bootstrap started', {
    workspace,
    provider: config.agent.defaults.provider,
    model: config.agent.defaults.model,
    apiPort: port
  });

  let servicesRef: Services | undefined;
  const onCronJob = async (job: CronJob): Promise<void> => {
    if (!servicesRef) {
      throw new Error('Services are not ready for cron dispatch');
    }

    await dispatchCronJob(servicesRef, workspace, job);
  };

  const servicesStartedAt = Date.now();
  servicesRef = await createServices({
    workspace,
    tempDir,
    config,
    port,
    onCronJob
  });
  log.info('Bootstrap phase completed', {
    phase: 'services',
    durationMs: Date.now() - servicesStartedAt
  });

  const wiringStartedAt = Date.now();
  setupConfigReload(servicesRef);
  setupSignalHandlers(servicesRef);
  log.info('Bootstrap phase completed', {
    phase: 'wiring',
    durationMs: Date.now() - wiringStartedAt
  });

  const channelsStartedAt = Date.now();
  await startChannels(servicesRef);
  log.info('Bootstrap phase completed', {
    phase: 'channels',
    durationMs: Date.now() - channelsStartedAt
  });

  servicesRef.agentRuntime.start();
  servicesRef.startPluginLoading();

  log.info('Gateway bootstrap completed', {
    durationMs: Date.now() - startedAt,
    provider: config.agent.defaults.provider,
    model: config.agent.defaults.model,
    apiEnabled: servicesRef.apiServer !== undefined,
    channelCount: servicesRef.channelManager.getEnabledChannels().length,
    pluginCount: Object.keys(servicesRef.pluginManager.getPluginConfigs()).length,
    skillCount: servicesRef.skillManager?.listSkills().length || 0
  });

  stopLagMonitor();
}
