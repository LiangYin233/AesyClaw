import { pathResolver } from './platform/utils/paths.js';
import { sqliteManager } from './platform/db/sqlite-manager.js';
import { configManager } from './features/config/config-manager.js';
import { logger } from './platform/observability/logger.js';

export interface BootstrapOptions {
  skipDb?: boolean;
  skipConfig?: boolean;
}

export class Bootstrap {
  private static initialized: boolean = false;

  static async initialize(options: BootstrapOptions = {}): Promise<void> {
    if (this.initialized) {
      logger.warn({}, 'Bootstrap already initialized, skipping...');
      return;
    }

    try {
      logger.info({}, 'Starting AesyClaw bootstrap...');

      logger.info({}, '[1/3] Initializing PathResolver...');
      pathResolver.initialize();

      if (!options.skipConfig) {
        logger.info({}, '[2/3] Loading configuration...');
        await configManager.initialize();
      }

      if (!options.skipDb) {
        logger.info({}, '[3/3] Initializing SQLite database...');
        sqliteManager.initialize();
      }

      this.initialized = true;
      logger.info({}, 'AesyClaw bootstrap completed successfully');
    } catch (error) {
      logger.error({ error }, 'Bootstrap failed');
      throw error;
    }
  }

  static async shutdown(): Promise<void> {
    logger.info({}, 'Shutting down AesyClaw...');

    try {
      sqliteManager.close();
      logger.info({}, 'SQLiteManager closed');
    } catch (error) {
      logger.error({ error }, 'Error closing SQLiteManager');
    }

    this.initialized = false;
    logger.info({}, 'AesyClaw shutdown completed');
  }

  static isInitialized(): boolean {
    return this.initialized;
  }

  static async restart(options: BootstrapOptions = {}): Promise<void> {
    await this.shutdown();
    await this.initialize(options);
  }

  static getStatus(): {
    initialized: boolean;
    pathResolver: boolean;
    configManager: boolean;
    sqliteManager: boolean;
  } {
    return {
      initialized: this.initialized,
      pathResolver: pathResolver.isInitialized(),
      configManager: configManager.isInitialized(),
      sqliteManager: sqliteManager.isInitialized(),
    };
  }
}

export async function bootstrap(options?: BootstrapOptions): Promise<void> {
  return Bootstrap.initialize(options);
}

export async function shutdown(): Promise<void> {
  return Bootstrap.shutdown();
}
