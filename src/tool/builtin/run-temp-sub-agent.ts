/**
 * Built-in run_temp_sub_agent tool.
 *
 * Runs a temporary sub-agent with an ad-hoc system prompt.
 * Stub until AgentEngine/SubAgentSandbox is implemented.
 *
 * @see project.md §5.15
 */

import { Type, Static } from '@sinclair/typebox';
import type { AesyClawTool, ToolExecutionContext, ToolExecutionResult } from '../tool-registry';
import type { ToolOwner } from '../../core/types';

/** Parameter schema for run_temp_sub_agent */
const RunTempSubAgentParamsSchema = Type.Object({
  systemPrompt: Type.String({ description: '子代理的系统提示' }),
  prompt: Type.String({ description: '子代理的输入提示' }),
});

type RunTempSubAgentParams = Static<typeof RunTempSubAgentParamsSchema>;

/** Dependencies needed by run_temp_sub_agent (typed as unknown until AgentEngine is implemented) */
export interface RunTempSubAgentDeps {
  /** Will be AgentEngine when implemented */
  agentEngine: unknown;
}

export function createRunTempSubAgentTool(_deps: RunTempSubAgentDeps): AesyClawTool {
  return {
    name: 'run_temp_sub_agent',
    description: '使用自定义系统提示运行临时子代理',
    parameters: RunTempSubAgentParamsSchema,
    owner: 'system' as ToolOwner,
    execute: async (params: unknown, _context: ToolExecutionContext): Promise<ToolExecutionResult> => {
      const { systemPrompt, prompt } = params as RunTempSubAgentParams;
      // Stub — depends on AgentEngine and SubAgentSandbox
      return {
        content: `Temp sub-agent not available (would run with system prompt: "${systemPrompt.substring(0, 50)}")`,
        isError: true,
      };
    },
  };
}