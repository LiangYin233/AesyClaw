/**
 * 内置 run_sub_agent 工具。
 *
 * 使用指定的角色 ID 和提示运行委托子代理轮次。
 *
 */

import type { Static } from '@sinclair/typebox';
import { Type } from '@sinclair/typebox';
import type { AesyClawTool, ToolExecutionContext, ToolExecutionResult } from '../tool-registry';
import { errorMessage } from '../../core/utils';
import type { ToolOwner } from '../../core/types';
import type { SubAgentSandbox } from '../../agent/sub-agent-sandbox';

/** run_sub_agent 的参数模式 */
const RunSubAgentParamsSchema = Type.Object({
  roleId: Type.String({ description: '要使用的角色 ID' }),
  prompt: Type.String({ description: '子代理的输入提示' }),
  enableTools: Type.Optional(Type.Boolean({ description: '是否允许子代理使用工具' })),
});

type RunSubAgentParams = Static<typeof RunSubAgentParamsSchema>;

export type RunSubAgentDeps = {
  sandbox: Pick<SubAgentSandbox, 'runWithRole'>;
};

/**
 * 创建 run_sub_agent 工具定义。
 *
 * @param deps - 包含 sandbox 的依赖项
 * @returns run_sub_agent 工具的 AesyClawTool 定义
 */
export function createRunSubAgentTool(deps: RunSubAgentDeps): AesyClawTool {
  return {
    name: 'run_sub_agent',
    description: '使用指定角色运行子代理',
    parameters: RunSubAgentParamsSchema,
    owner: 'system' as ToolOwner,
    execute: async (
      params: unknown,
      context: ToolExecutionContext,
    ): Promise<ToolExecutionResult> => {
      const { roleId, prompt, enableTools } = params as RunSubAgentParams;

      try {
        const content = await deps.sandbox.runWithRole(
          {
            roleId,
            prompt,
            ...(enableTools === undefined ? {} : { enableTools }),
          },
          { sessionKey: context.sessionKey, sendMessage: context.sendMessage },
        );
        return { content };
      } catch (error: unknown) {
        return {
          content: `子代理执行失败: ${errorMessage(error)}`,
          isError: true,
        };
      }
    },
  };
}
