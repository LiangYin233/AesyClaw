import { mkdirSync, existsSync } from 'fs';
import type { Config } from '../../types.js';
import type { CronJob } from '../../features/cron/index.js';
import { dispatchCronJob } from '../../features/cron/index.js';
import { ConfigManager } from '../../features/config/index.js';
import { createServices, type Services } from './factory/ServiceFactory.js';
import { setupConfigReload } from './configReload.js';
import { setupEventListeners } from './eventListeners.js';
import { setupSignalHandlers, shutdownServices } from './shutdown.js';
import { EventBus } from '../../platform/events/EventBus.js';
import type { AesyClawEvents } from '../../platform/events/events.js';
import { dirPaths } from '../../platform/utils/paths.js';

const CHANNEL_START_TIMEOUT = 30000;

function ensureRuntimeDirectories(workspace: string, tempDir: string): void {
  if (!existsSync(workspace)) {
    mkdirSync(workspace, { recursive: true });
  }

  if (!existsSync(tempDir)) {
    mkdirSync(tempDir, { recursive: true });
  }
}

export interface BootstrapOptions {
  onSignalHandlersReady?: () => void;
  shouldAbortStartup?: () => boolean;
}

export class StartupInterruptedError extends Error {
  constructor() {
    super('Startup interrupted by signal');
    this.name = 'StartupInterruptedError';
  }
}

async function startChannels(services: Services): Promise<void> {
  const { channelManager } = services;
  await Promise.race([
    channelManager.startAll(),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Channel start timeout')), CHANNEL_START_TIMEOUT)
    )
  ]);
}

export async function bootstrap(options: BootstrapOptions = {}): Promise<void> {
  const eventBus = new EventBus<AesyClawEvents>();
  const configManager = new ConfigManager(eventBus);
  const config = await configManager.load() as Config;
  const port = config.server.apiPort ?? 18792;
  const workspace = dirPaths.workspace();
  const tempDir = dirPaths.temp();
  ensureRuntimeDirectories(workspace, tempDir);

  let servicesRef: Services | undefined;
  let startupAbortCleanedUp = false;

  try {
    const onCronJob = async (job: CronJob): Promise<void> => {
      if (!servicesRef) {
        throw new Error('Services are not ready for cron dispatch');
      }

      await dispatchCronJob(servicesRef, job);
    };

    servicesRef = await createServices({
      workspace,
      tempDir,
      config,
      configManager,
      eventBus,
      port,
      onCronJob
    });

    if (options.shouldAbortStartup?.()) {
      await shutdownServices(servicesRef);
      startupAbortCleanedUp = true;
      throw new StartupInterruptedError();
    }

    setupConfigReload(servicesRef);
    setupEventListeners(servicesRef);
    setupSignalHandlers(servicesRef);
    options.onSignalHandlersReady?.();
    if (options.shouldAbortStartup?.()) {
      await shutdownServices(servicesRef);
      startupAbortCleanedUp = true;
      throw new StartupInterruptedError();
    }

    await startChannels(servicesRef);

    servicesRef.agentRuntime.start();
    servicesRef.startPluginLoading();
  } catch (error) {
    if (servicesRef && !startupAbortCleanedUp) {
      try {
        await shutdownServices(servicesRef);
      } catch {
      }
    }
    throw error;
  }
}
