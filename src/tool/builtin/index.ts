import type { ToolRegistry } from '@aesyclaw/tool/tool-registry';
import type { CronManager } from '@aesyclaw/cron/cron-manager';
import type { RoleManager } from '@aesyclaw/role/role-manager';
import type { LlmAdapter } from '@aesyclaw/agent/llm-adapter';
import type { ConfigManager } from '@aesyclaw/core/config/config-manager';
import type { SkillManager } from '@aesyclaw/skill/skill-manager';
import type { UsageRecord } from '@aesyclaw/core/database-types';
import { serializeSessionKey } from '@aesyclaw/core/types';
import { Agent } from '@aesyclaw/agent/agent';
import { createSendMsgTool } from './send-msg';
import { createCreateCronTool, createListCronTool, createDeleteCronTool } from './cron-tools';
import { createRunSubAgentTool, createRunTempSubAgentTool } from './run-sub-agent';
import { createSpeechToTextTool } from './speech-to-text';
import { createImageUnderstandingTool } from './image-understanding';
import { createLoadSkillTool } from './load-skill';

export { createSpeechToTextTool, createImageUnderstandingTool };

export type BuiltinToolDependencies = {
  cronManager: Pick<CronManager, 'createJob' | 'listJobs' | 'deleteJob'>;
  roleManager: Pick<RoleManager, 'getRole' | 'getDefaultRole'>;
  llmAdapter: Pick<LlmAdapter, 'resolveModel'>;
  configManager: Pick<ConfigManager, 'get'>;
  skillManager: Pick<SkillManager, 'getSkill'>;
  usageRepository?: { create: (record: UsageRecord) => Promise<number> };
};

export function registerBuiltinTools(registry: ToolRegistry, deps: BuiltinToolDependencies): void {
  const cronDeps = { cronManager: deps.cronManager };

  const lookupRunTurn: (
    ...params: Parameters<InstanceType<typeof Agent>['runTurn']>
  ) => ReturnType<InstanceType<typeof Agent>['runTurn']> = (
    role,
    content,
    history,
    sessionKey,
    sendMessage,
  ) => {
    const agent = Agent.activeAgents.get(serializeSessionKey(sessionKey));
    if (!agent) throw new Error('未找到活跃 Agent');
    return agent.runTurn(role, content, history, sessionKey, sendMessage);
  };

  registry.register(createSendMsgTool());
  registry.register(createCreateCronTool(cronDeps));
  registry.register(createListCronTool(cronDeps));
  registry.register(createDeleteCronTool(cronDeps));
  registry.register(
    createRunSubAgentTool({ roleManager: deps.roleManager, runTurn: lookupRunTurn }),
  );
  registry.register(
    createRunTempSubAgentTool({ roleManager: deps.roleManager, runTurn: lookupRunTurn }),
  );
  registry.register(createLoadSkillTool({ skillManager: deps.skillManager }));
  registry.register(createSpeechToTextTool(deps));
  registry.register(createImageUnderstandingTool(deps));
}
