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
import type { CronToolsDeps } from './cron-tools';
import type { CronManager } from '../../cron/cron-manager';
import type { AgentEngine } from '../../agent/agent-engine';
import type { RoleManager } from '../../role/role-manager';
import type { LlmAdapter } from '../../agent/llm-adapter';
import type { ConfigManager } from '../../core/config/config-manager';
import { createSendMsgTool } from './send-msg';
import { createCreateCronTool, createListCronTool, createDeleteCronTool } from './cron-tools';
import { createRunSubAgentTool } from './run-sub-agent';
import { createRunTempSubAgentTool } from './run-temp-sub-agent';
import { createSpeechToTextTool } from './speech-to-text';
import { createImageUnderstandingTool } from './image-understanding';
import { SubAgentSandbox } from '../../agent/sub-agent-sandbox';

/**
 * Dependencies for built-in tools.
 *
 * Dependencies for the currently available built-in tools.
 */
export interface BuiltinToolDependencies {
  cronManager: Pick<CronManager, 'createJob' | 'listJobs' | 'deleteJob'>;
  agentEngine: Pick<AgentEngine, 'createAgent' | 'process'>;
  roleManager: Pick<RoleManager, 'getRole' | 'getDefaultRole'>;
  llmAdapter: Pick<LlmAdapter, 'analyzeImage' | 'transcribeAudio'>;
  configManager: Pick<ConfigManager, 'get'>;
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
  const cronDeps: CronToolsDeps = { cronManager: deps.cronManager };
  const sandbox = new SubAgentSandbox({
    agentEngine: deps.agentEngine,
    roleManager: deps.roleManager,
  });

  registry.register(createSendMsgTool());
  registry.register(createCreateCronTool(cronDeps));
  registry.register(createListCronTool(cronDeps));
  registry.register(createDeleteCronTool(cronDeps));
  registry.register(createRunSubAgentTool({ sandbox }));
  registry.register(createRunTempSubAgentTool({ sandbox }));
  registry.register(createSpeechToTextTool({
    configManager: deps.configManager,
    llmAdapter: deps.llmAdapter,
  }));
  registry.register(createImageUnderstandingTool({
    configManager: deps.configManager,
    llmAdapter: deps.llmAdapter,
  }));
}
