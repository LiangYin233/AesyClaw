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
import type { SpeechToTextDeps } from './speech-to-text';
import type { ImageUnderstandingDeps } from './image-understanding';
import type { RunSubAgentDeps } from './run-sub-agent';
import type { RunTempSubAgentDeps } from './run-temp-sub-agent';
import type { CronToolsDeps } from './cron-tools';
import type { CronManager } from '../../cron/cron-manager';
import { createSendMsgTool } from './send-msg';
import { createSpeechToTextTool } from './speech-to-text';
import { createImageUnderstandingTool } from './image-understanding';
import { createRunSubAgentTool } from './run-sub-agent';
import { createRunTempSubAgentTool } from './run-temp-sub-agent';
import { createCreateCronTool, createListCronTool, createDeleteCronTool } from './cron-tools';

/**
 * Dependencies for built-in tools.
 *
 * Most are typed as `unknown` because the subsystems (AgentEngine,
 * CronManager, Pipeline, LlmAdapter) are not yet implemented.
 */
export interface BuiltinToolDependencies {
  /** Will be Pipeline when implemented */
  pipeline: unknown;
  /** Will be AgentEngine when implemented */
  agentEngine: unknown;
  cronManager: Pick<CronManager, 'createJob' | 'listJobs' | 'deleteJob'>;
  /** Will be LlmAdapter when implemented */
  llmAdapter: unknown;
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
  const sendMsgDeps: SendMsgDeps = { pipeline: deps.pipeline };
  const sttDeps: SpeechToTextDeps = { llmAdapter: deps.llmAdapter };
  const iuDeps: ImageUnderstandingDeps = { llmAdapter: deps.llmAdapter };
  const subAgentDeps: RunSubAgentDeps = { agentEngine: deps.agentEngine };
  const tempSubAgentDeps: RunTempSubAgentDeps = { agentEngine: deps.agentEngine };
  const cronDeps: CronToolsDeps = { cronManager: deps.cronManager };

  registry.register(createSendMsgTool(sendMsgDeps));
  registry.register(createSpeechToTextTool(sttDeps));
  registry.register(createImageUnderstandingTool(iuDeps));
  registry.register(createRunSubAgentTool(subAgentDeps));
  registry.register(createRunTempSubAgentTool(tempSubAgentDeps));
  registry.register(createCreateCronTool(cronDeps));
  registry.register(createListCronTool(cronDeps));
  registry.register(createDeleteCronTool(cronDeps));
}
