import type { Config } from '../../../types.js';

export interface ReloadRuntimeConfigInput {
  previousConfig: Config;
  currentConfig: Config;
}
