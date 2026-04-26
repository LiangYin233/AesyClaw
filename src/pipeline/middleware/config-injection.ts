/**
 * Config Injection — injects the current config snapshot into PipelineState.
 *
 * This step reads the current config from ConfigManager and sets
 * it on the state, making it available to subsequent steps.
 */

import type { PipelineState } from './types';
import type { ConfigManager } from '../../core/config/config-manager';

/**
 * Injects the current application config into the pipeline state.
 *
 * Should be the first step in the chain so that all subsequent
 * steps have access to the config.
 */
export async function configInjection(
  state: PipelineState,
  configManager: ConfigManager,
): Promise<PipelineState> {
  state.config = configManager.getConfig();
  return state;
}
