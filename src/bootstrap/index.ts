import { join } from 'path';
import { mkdirSync, existsSync } from 'fs';
import { logger } from '../observability/index.js';
import type { Config } from '../types.js';
import type { CronJob } from '../cron/index.js';
import { ConfigManager } from '../config/ConfigManager.js';
import { getMainAgentConfig } from '../config/index.js';
import { createServices, type Services } from './factory/ServiceFactory.js';
import { dispatchCronJob } from './app/cronDispatch.js';
import { setupConfigReload } from './app/configReload.js';
import { setupEventListeners } from './app/eventListeners.js';
import { setupSignalHandlers, shutdownServices } from './app/shutdown.js';
import { EventBus } from '../events/EventBus.js';
import type { AesyClawEvents } from '../events/events.js';

const log = logger.child('Bootstrap');
const CHANNEL_START_TIMEOUT = 30000;

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
      log.info('启动阶段事件循环延迟较高', {
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
  const startedAt = Date.now();
  await Promise.race([
    channelManager.startAll(),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Channel start timeout')), CHANNEL_START_TIMEOUT)
    )
  ]);
  log.info('渠道启动完成', {
    channelCount: channelManager.getEnabledChannels().length,
    durationMs: Date.now() - startedAt
  });
}

export async function bootstrap(options: BootstrapOptions = {}): Promise<void> {
  const startedAt = Date.now();
  const stopLagMonitor = startStartupLagMonitor();
  const eventBus = new EventBus<AesyClawEvents>();
  const configManager = new ConfigManager(eventBus);
  const config = await configManager.load() as Config;
  const port = config.server.apiPort ?? 18792;
  const workspace = join(process.cwd(), 'workspace');
  const tempDir = join(process.cwd(), '.aesyclaw', 'temp');
  const mainAgent = getMainAgentConfig(config);

  ensureRuntimeDirectories(workspace, tempDir);

  log.info('网关启动中', {
    workspace,
    provider: mainAgent.provider.name,
    model: mainAgent.role.model,
    apiPort: port
  });

  let servicesRef: Services | undefined;
  let startupAbortCleanedUp = false;

  try {
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
      configManager,
      eventBus,
      port,
      onCronJob
    });
    log.info('启动阶段完成', {
      phase: 'services',
      durationMs: Date.now() - servicesStartedAt
    });

    if (options.shouldAbortStartup?.()) {
      await shutdownServices(servicesRef);
      startupAbortCleanedUp = true;
      throw new StartupInterruptedError();
    }

    const wiringStartedAt = Date.now();
    setupConfigReload(servicesRef);
    setupEventListeners(servicesRef);
    setupSignalHandlers(servicesRef);
    options.onSignalHandlersReady?.();
    if (options.shouldAbortStartup?.()) {
      await shutdownServices(servicesRef);
      startupAbortCleanedUp = true;
      throw new StartupInterruptedError();
    }
    log.info('启动阶段完成', {
      phase: 'wiring',
      durationMs: Date.now() - wiringStartedAt
    });

    const channelsStartedAt = Date.now();
    await startChannels(servicesRef);
    log.info('启动阶段完成', {
      phase: 'channels',
      durationMs: Date.now() - channelsStartedAt
    });

    servicesRef.agentRuntime.start();
    servicesRef.startPluginLoading();

    log.info('网关启动完成', {
      durationMs: Date.now() - startedAt,
      provider: mainAgent.provider.name,
      model: mainAgent.role.model,
      apiEnabled: servicesRef.apiServer !== undefined,
      channelCount: servicesRef.channelManager.getEnabledChannels().length,
      pluginCount: Object.keys(servicesRef.pluginManager.getPluginConfigs()).length,
      skillCount: servicesRef.skillManager?.listSkills().length || 0
    });
  } catch (error) {
    log.error('网关启动失败', { error });
    if (servicesRef && !startupAbortCleanedUp) {
      try {
        await shutdownServices(servicesRef);
      } catch (cleanupError) {
        log.error('启动失败后的清理未完全成功', { error: cleanupError });
      }
    }
    throw error;
  } finally {
    stopLagMonitor();
  }
}
