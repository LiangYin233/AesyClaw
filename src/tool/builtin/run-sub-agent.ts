/**
 * Built-in run_sub_agent tool.
 *
 * Runs a delegated sub-agent turn with a specified role ID and prompt.
 *
 */

import type { Static } from '@sinclair/typebox';
import { Type } from '@sinclair/typebox';
import type { AesyClawTool, ToolExecutionContext, ToolExecutionResult } from '../tool-registry';
import type { ToolOwner } from '../../core/types';
import type { SubAgentSandbox } from '../../agent/sub-agent-sandbox';

/** Parameter schema for run_sub_agent */
const RunSubAgentParamsSchema = Type.Object({
  roleId: Type.String({ description: '要使用的角色 ID' }),
  prompt: Type.String({ description: '子代理的输入提示' }),
});

type RunSubAgentParams = Static<typeof RunSubAgentParamsSchema>;

export interface RunSubAgentDeps {
  sandbox: Pick<SubAgentSandbox, 'runWithRole'>;
}

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
      const { roleId, prompt } = params as RunSubAgentParams;

      try {
        const content = await deps.sandbox.runWithRole(
          { roleId, prompt },
          { sessionKey: context.sessionKey, sendMessage: context.sendMessage },
        );
        return { content };
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: `Sub-agent execution failed: ${message}`,
          isError: true,
        };
      }
    },
  };
}
