/**
 * ConfigInjectionMiddleware — injects the current config snapshot into PipelineState.
 *
 * This middleware reads the current config from ConfigManager and sets
 * it on the state, making it available to subsequent middlewares.
 *
 */

import type { PipelineState, NextFn } from './types';
import type { ConfigManager } from '../../core/config/config-manager';

/**
 * Injects the current application config into the pipeline state.
 *
 * Should be the first middleware in the chain so that all subsequent
 * middlewares have access to the config.
 */
export class ConfigInjectionMiddleware {
  readonly name = 'ConfigInjection';

  constructor(private configManager: ConfigManager) {}

  async execute(state: PipelineState, next: NextFn): Promise<PipelineState> {
    state.config = this.configManager.getConfig();
    return next(state);
  }
}
