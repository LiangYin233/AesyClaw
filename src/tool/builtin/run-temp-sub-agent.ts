/**
 * 内置 run_temp_sub_agent 工具。
 *
 * 使用临时系统提示运行临时委托子代理。
 *
 */

import type { Static } from '@sinclair/typebox';
import { Type } from '@sinclair/typebox';
import type { AesyClawTool, ToolExecutionContext, ToolExecutionResult } from '../tool-registry';
import type { ToolOwner } from '../../core/types';
import type { SubAgentSandbox } from '../../agent/sub-agent-sandbox';

/** run_temp_sub_agent 的参数模式 */
const RunTempSubAgentParamsSchema = Type.Object({
  systemPrompt: Type.String({ description: '子代理的系统提示' }),
  model: Type.Optional(Type.String({ description: '临时子代理使用的模型，格式为 provider/model' })),
  prompt: Type.String({ description: '子代理的输入提示' }),
  enableTools: Type.Optional(Type.Boolean({ description: '是否允许子代理使用工具' })),
});

type RunTempSubAgentParams = Static<typeof RunTempSubAgentParamsSchema>;

export type RunTempSubAgentDeps = {
  sandbox: Pick<SubAgentSandbox, 'runWithPrompt'>;
}

/**
 * 创建 run_temp_sub_agent 工具定义。
 *
 * @param deps - 包含 sandbox 的依赖项
 * @returns run_temp_sub_agent 工具的 AesyClawTool 定义
 */
export function createRunTempSubAgentTool(deps: RunTempSubAgentDeps): AesyClawTool {
  return {
    name: 'run_temp_sub_agent',
    description: '使用自定义系统提示运行临时子代理',
    parameters: RunTempSubAgentParamsSchema,
    owner: 'system' as ToolOwner,
    execute: async (
      params: unknown,
      context: ToolExecutionContext,
    ): Promise<ToolExecutionResult> => {
      const { systemPrompt, model, prompt, enableTools } = params as RunTempSubAgentParams;

      try {
        const content = await deps.sandbox.runWithPrompt(
          {
            systemPrompt,
            prompt,
            ...(model === undefined ? {} : { model }),
            ...(enableTools === undefined ? {} : { enableTools }),
          },
          {
            sessionKey: context.sessionKey,
            sendMessage: context.sendMessage,
            toolPermission: context.toolPermission,
          },
        );
        return { content };
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: `临时子代理执行失败: ${message}`,
          isError: true,
        };
      }
    },
  };
}
