/**
 * Barrel export for built-in tools.
 *
 * `registerBuiltinTools()` registers all built-in tools with
 * the ToolRegistry. Dependencies are injected through the
 * BuiltinToolDependencies interface.
 *
 * @see project.md §5.15
 */

import type { ToolRegistry, ToolExecutionContext } from '../tool-registry';
import type { SendMsgDeps } from './send-msg';
import type { CronToolsDeps } from './cron-tools';
import type { CronManager } from '../../cron/cron-manager';
import { createSendMsgTool } from './send-msg';
import { createCreateCronTool, createListCronTool, createDeleteCronTool } from './cron-tools';

/**
 * Dependencies for built-in tools.
 *
 * Dependencies for the currently available built-in tools.
 */
export interface BuiltinToolDependencies {
  cronManager: Pick<CronManager, 'createJob' | 'listJobs' | 'deleteJob'>;
}

/**
 * Register all built-in tools with the given registry.
 *
 * @param registry - The ToolRegistry to register tools into
 * @param deps - Dependencies required by the tool implementations
 */
export function registerBuiltinTools(
  registry: ToolRegistry,
  deps: BuiltinToolDependencies,
): void {
  const sendMsgDeps: SendMsgDeps = {};
  const cronDeps: CronToolsDeps = { cronManager: deps.cronManager };

  registry.register(createSendMsgTool(sendMsgDeps));
  registry.register(createCreateCronTool(cronDeps));
  registry.register(createListCronTool(cronDeps));
  registry.register(createDeleteCronTool(cronDeps));
}
