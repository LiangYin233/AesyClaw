import { mkdirSync, existsSync } from 'fs';
import type { Config } from '../../types.js';
import type { CronJob } from '../../features/cron/index.js';
import { dispatchCronJob } from '../../features/cron/index.js';
import { ConfigManager } from '../../features/config/index.js';
import { createServices, type Services } from './factory/ServiceFactory.js';
import { setupConfigReload } from './app/configReload.js';
import { setupEventListeners } from './app/eventListeners.js';
import { setupSignalHandlers, shutdownServices } from './app/shutdown.js';
import { EventBus } from '../../platform/events/EventBus.js';
import type { AesyClawEvents } from '../../platform/events/events.js';
import { dirPaths } from '../../platform/utils/paths.js';

const CHANNEL_START_TIMEOUT = 30000;

/**
 * 启动前确保运行目录存在，避免后续服务各自兜底创建。
 */
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
    // 渠道启动可能依赖外部网络，超时后直接打断整个启动流程。
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Channel start timeout')), CHANNEL_START_TIMEOUT)
    )
  ]);
}

/**
 * 按固定顺序完成核心服务装配、事件接线、渠道启动与运行时拉起。
 */
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

    // 渠道就绪后再开放 agent runtime，避免启动期消息早于下游依赖准备完成。
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
