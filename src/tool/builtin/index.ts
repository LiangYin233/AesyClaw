/**
 * 内置工具的 Barrel 导出。
 *
 * `registerBuiltinTools()` 将所有内置工具注册到
 * ToolRegistry。依赖通过
 * BuiltinToolDependencies 接口注入。
 */

import type { ToolRegistry } from '@aesyclaw/tool/tool-registry';
import type { CronToolsDeps } from './cron-tools';
import type { CronManager } from '@aesyclaw/cron/cron-manager';
import type { AgentEngine } from '@aesyclaw/agent/agent-engine';
import type { RoleManager } from '@aesyclaw/role/role-manager';
import type { LlmAdapter } from '@aesyclaw/agent/llm-adapter';
import type { ConfigManager } from '@aesyclaw/core/config/config-manager';
import type { SkillManager } from '@aesyclaw/skill/skill-manager';
import { createSendMsgTool } from './send-msg';
import { createCreateCronTool, createListCronTool, createDeleteCronTool } from './cron-tools';
import { createRunSubAgentTool } from './run-sub-agent';
import { createRunTempSubAgentTool } from './run-temp-sub-agent';
import { createSpeechToTextTool } from './speech-to-text';
import { createImageUnderstandingTool } from './image-understanding';
import { createLoadSkillTool } from './load-skill';

export type BuiltinToolDependencies = {
  cronManager: Pick<CronManager, 'createJob' | 'listJobs' | 'deleteJob'>;
  agentEngine: Pick<AgentEngine, 'runAgentTurn'>;
  roleManager: Pick<RoleManager, 'getRole' | 'getDefaultRole'>;
  llmAdapter: Pick<LlmAdapter, 'resolveModel'>;
  configManager: Pick<ConfigManager, 'get'>;
  skillManager: Pick<SkillManager, 'getSkill'>;
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
  registry.register(
    createSpeechToTextTool({
      configManager: deps.configManager,
      llmAdapter: deps.llmAdapter,
    }),
  );
  registry.register(
    createImageUnderstandingTool({
      configManager: deps.configManager,
      llmAdapter: deps.llmAdapter,
    }),
  );
}
