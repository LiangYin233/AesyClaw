/**
 * Built-in run_temp_sub_agent tool.
 *
 * Runs a temporary delegated sub-agent with an ad-hoc system prompt.
 *
 */

import type { Static } from '@sinclair/typebox';
import { Type } from '@sinclair/typebox';
import type { AesyClawTool, ToolExecutionContext, ToolExecutionResult } from '../tool-registry';
import type { ToolOwner } from '../../core/types';
import type { SubAgentSandbox } from '../../agent/sub-agent-sandbox';

/** Parameter schema for run_temp_sub_agent */
const RunTempSubAgentParamsSchema = Type.Object({
  systemPrompt: Type.String({ description: '子代理的系统提示' }),
  prompt: Type.String({ description: '子代理的输入提示' }),
});

type RunTempSubAgentParams = Static<typeof RunTempSubAgentParamsSchema>;

export interface RunTempSubAgentDeps {
  sandbox: Pick<SubAgentSandbox, 'runWithPrompt'>;
}

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
      const { systemPrompt, prompt } = params as RunTempSubAgentParams;

      try {
        const content = await deps.sandbox.runWithPrompt(
          { systemPrompt, prompt },
          { sessionKey: context.sessionKey, sendMessage: context.sendMessage },
        );
        return { content };
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: `Temp sub-agent execution failed: ${message}`,
          isError: true,
        };
      }
    },
  };
}
