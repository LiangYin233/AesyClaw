import type { ToolRegistry } from '@aesyclaw/tool/tool-registry';
import type { CronManager } from '@aesyclaw/cron/manager';
import type { RoleManager } from '@aesyclaw/role/manager';
import type { SkillManager } from '@aesyclaw/skill/manager';
import type { AgentRegistry } from '@aesyclaw/agent/registry';
import type { Agent } from '@aesyclaw/agent/agent';
import { createSendMsgTool } from './send-msg';
import { createCreateCronTool, createListCronTool, createDeleteCronTool } from './cron-tools';
import { createRunSubAgentTool, createRunTempSubAgentTool } from './run-sub-agent';
import { createLoadSkillTool } from './load-skill';

/**
 * 注册内置工具所需的依赖项。
 *
 * 每个依赖项使用 `Pick<>` 声明最小接口，仅声明内置工具实际使用的方法。
 */
export type BuiltinToolDependencies = {
  cronManager: Pick<CronManager, 'createJob' | 'listJobs' | 'deleteJob'>;
  roleManager: Pick<RoleManager, 'getRole' | 'getDefaultRole'>;
  skillManager: Pick<SkillManager, 'getSkill'>;
  agentRegistry: AgentRegistry;
};

/**
 * 将所有内置工具注册到 ToolRegistry。
 *
 * @param registry - 工具注册表实例
 * @param deps - 内置工具所需的依赖项
 */
export function registerBuiltinTools(registry: ToolRegistry, deps: BuiltinToolDependencies): void {
  const cronDeps = { cronManager: deps.cronManager };

  const lookupCallLLM: (
    ...params: Parameters<InstanceType<typeof Agent>['callLLM']>
  ) => ReturnType<InstanceType<typeof Agent>['callLLM']> = (
    role,
    content,
    history,
    sessionKey,
    sendMessage,
  ) => {
    const agent = deps.agentRegistry.getAgent(sessionKey);
    if (!agent) throw new Error('未找到活跃 Agent');
    return agent.callLLM(role, content, history, sessionKey, sendMessage);
  };

  registry.register(createSendMsgTool());
  registry.register(createCreateCronTool(cronDeps));
  registry.register(createListCronTool(cronDeps));
  registry.register(createDeleteCronTool(cronDeps));
  registry.register(
    createRunSubAgentTool({ roleManager: deps.roleManager, callLLM: lookupCallLLM }),
  );
  registry.register(
    createRunTempSubAgentTool({ roleManager: deps.roleManager, callLLM: lookupCallLLM }),
  );
  registry.register(createLoadSkillTool({ skillManager: deps.skillManager }));
}
