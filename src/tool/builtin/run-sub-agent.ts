/**
 * Built-in run_sub_agent tool.
 *
 * Runs a sub-agent with a specified role ID and prompt.
 * Stub until AgentEngine/SubAgentSandbox is implemented.
 *
 * @see project.md §5.15
 */

import { Type, Static } from '@sinclair/typebox';
import type { AesyClawTool, ToolExecutionContext, ToolExecutionResult } from '../tool-registry';
import type { ToolOwner } from '../../core/types';

/** Parameter schema for run_sub_agent */
const RunSubAgentParamsSchema = Type.Object({
  roleId: Type.String({ description: '要使用的角色 ID' }),
  prompt: Type.String({ description: '子代理的输入提示' }),
});

type RunSubAgentParams = Static<typeof RunSubAgentParamsSchema>;

/** Dependencies needed by run_sub_agent (typed as unknown until AgentEngine is implemented) */
export interface RunSubAgentDeps {
  /** Will be AgentEngine when implemented */
  agentEngine: unknown;
}

export function createRunSubAgentTool(_deps: RunSubAgentDeps): AesyClawTool {
  return {
    name: 'run_sub_agent',
    description: '使用指定角色运行子代理',
    parameters: RunSubAgentParamsSchema,
    owner: 'system' as ToolOwner,
    execute: async (params: unknown, _context: ToolExecutionContext): Promise<ToolExecutionResult> => {
      const { roleId, prompt } = params as RunSubAgentParams;
      // Stub — depends on AgentEngine and SubAgentSandbox
      return {
        content: `Sub-agent not available (would run role "${roleId}" with prompt: "${prompt.substring(0, 50)}")`,
        isError: true,
      };
    },
  };
}