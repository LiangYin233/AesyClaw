import type { ToolRegistry } from '@aesyclaw/tool/tool-registry';
import type { CronToolsDeps } from './cron-tools';
import type { CronManager } from '@aesyclaw/cron/cron-manager';
import type { AgentEngine } from '@aesyclaw/agent/agent-engine';
import type { RoleManager } from '@aesyclaw/role/role-manager';
import type { LlmAdapter } from '@aesyclaw/agent/llm-adapter';
import type { ConfigManager } from '@aesyclaw/core/config/config-manager';
import type { SkillManager } from '@aesyclaw/skill/skill-manager';
import type { UsageRecord } from '@aesyclaw/core/database-types';
import { createSendMsgTool } from './send-msg';
import { createCreateCronTool, createListCronTool, createDeleteCronTool } from './cron-tools';
import { createRunSubAgentTool } from './run-sub-agent';
import { createRunTempSubAgentTool } from './run-temp-sub-agent';
import { createSpeechToTextTool } from './speech-to-text';
import { createImageUnderstandingTool } from './image-understanding';
import { createLoadSkillTool } from './load-skill';

export { createSpeechToTextTool, createImageUnderstandingTool };

export type BuiltinToolDependencies = {
  cronManager: Pick<CronManager, 'createJob' | 'listJobs' | 'deleteJob'>;
  agentEngine: Pick<AgentEngine, 'runAgentTurn'>;
  roleManager: Pick<RoleManager, 'getRole' | 'getDefaultRole'>;
  llmAdapter: Pick<LlmAdapter, 'resolveModel'>;
  configManager: Pick<ConfigManager, 'get'>;
  skillManager: Pick<SkillManager, 'getSkill'>;
  usageRepository?: { create: (record: UsageRecord) => Promise<number> };
};

export function registerBuiltinTools(registry: ToolRegistry, deps: BuiltinToolDependencies): void {
  const cronDeps: CronToolsDeps = { cronManager: deps.cronManager };
  registry.register(createSendMsgTool());
  registry.register(createCreateCronTool(cronDeps));
  registry.register(createListCronTool(cronDeps));
  registry.register(createDeleteCronTool(cronDeps));
  registry.register(
    createRunSubAgentTool({ agentEngine: deps.agentEngine, roleManager: deps.roleManager }),
  );
  registry.register(
    createRunTempSubAgentTool({ agentEngine: deps.agentEngine, roleManager: deps.roleManager }),
  );
  registry.register(createLoadSkillTool({ skillManager: deps.skillManager }));
  registry.register(createSpeechToTextTool(deps));
  registry.register(createImageUnderstandingTool(deps));
}
