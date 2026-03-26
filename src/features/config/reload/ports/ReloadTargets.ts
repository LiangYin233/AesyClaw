import type { Config } from '../../schema/index.js';

export interface ConfigReloadLogger {
  info(message: string, fields?: Record<string, unknown>): void;
  debug(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
}

export interface ConfigReloadTargets {
  observability?: { applyConfig(config: Config): void | Promise<void> };
  mainAgent?: { applyConfig(config: Config): void | Promise<void> };
  memory?: { applyConfig(config: Config): void | Promise<void> };
  tools?: { applyConfig(config: Config): void | Promise<void> };
  sessionRouting?: { applyConfig(config: Config): void | Promise<void> };
  channels?: { applyDiff(previousConfig: Config, currentConfig: Config): Promise<void> };
  plugins?: { applyConfig(config: Config): Promise<void> };
  skills?: { applyConfig(config: Config): void | Promise<void> };
  mcp?: { applyConfig(config: Config): Promise<void> };
  api?: { applyConfig(config: Config): void | Promise<void> };
}
