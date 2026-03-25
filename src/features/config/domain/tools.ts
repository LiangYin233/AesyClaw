import type { ToolsConfig } from '../schema/index.js';
import { readConfig, type ConfigSource } from './shared.js';

export function getToolRuntimeConfig(source: ConfigSource): ToolsConfig {
  return readConfig(source).tools;
}
