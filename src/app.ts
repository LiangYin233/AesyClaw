/**
 * Application — the main orchestrator that owns all subsystem manager instances.
 *
 * Startup order (§3.2 of project.md):
 *   1.  PathResolver.resolve()
 *   2.  ConfigManager.load()
 *   3.  DatabaseManager.initialize()
 *   4.  … (subsequent steps not yet implemented)
 *
 * Shutdown order is the reverse. Each step is independently try-caught
 * so that a failure in one step does not prevent cleanup of the others.
 */

import { PathResolver } from './core/path-resolver';
import { ConfigManager } from './core/config/config-manager';
import { DatabaseManager } from './core/database/database-manager';
import { createScopedLogger, setLogLevel } from './core/logger';

const logger = createScopedLogger('app');

export class Application {
  private pathResolver: PathResolver;
  private configManager: ConfigManager;
  private databaseManager: DatabaseManager;

  // --- Managers not yet implemented ---
  // private skillManager: SkillManager;
  // private roleManager: RoleManager;
  // private pipeline: Pipeline;
  // private pluginManager: PluginManager;
  // private cronManager: CronManager;
  // private mcpManager: McpManager;
  // private channelManager: ChannelManager;

  private started = false;

  constructor() {
    this.pathResolver = new PathResolver();
    this.configManager = new ConfigManager();
    this.databaseManager = new DatabaseManager();
  }

  async start(): Promise<void> {
    if (this.started) {
      logger.warn('Application already started');
      return;
    }

    logger.info('Starting AesyClaw…');

    // 1. PathResolver
    try {
      const root = process.cwd();
      this.pathResolver.resolve(root);
      logger.info('Path resolution complete', { root });
    } catch (err) {
      logger.error('Path resolution failed', err);
      await this.shutdown();
      throw err;
    }

    // 2. ConfigManager
    try {
      await this.configManager.load(this.pathResolver.configFile);
      const config = this.configManager.getConfig();
      setLogLevel(config.server.logLevel);
      logger.info('Configuration loaded');
    } catch (err) {
      logger.error('Config loading failed', err);
      await this.shutdown();
      throw err;
    }

    // 3. DatabaseManager
    try {
      await this.databaseManager.initialize(this.pathResolver.dbFile);
      logger.info('Database initialised');
    } catch (err) {
      logger.error('Database initialisation failed', err);
      await this.shutdown();
      throw err;
    }

    // --- Steps 4–13 not yet implemented ---
    logger.info('Infrastructure layer initialised (steps 4+ not yet implemented)');

    this.started = true;
    logger.info('AesyClaw started successfully');
  }

  async shutdown(): Promise<void> {
    logger.info('Shutting down AesyClaw…');

    // Each step is independently try-caught — a failure in one
    // does NOT prevent subsequent cleanup.
    const steps: Array<() => Promise<void> | void> = [
      // Reverse order of startup
      () => this.configManager.stopHotReload(),
      () => this.databaseManager.close(),
    ];

    for (const step of steps) {
      try {
        await step();
      } catch (err) {
        logger.error('Shutdown step failed', err);
        // Continue to next step
      }
    }

    this.started = false;
    logger.info('AesyClaw shutdown complete');
  }
}