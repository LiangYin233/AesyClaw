import { z } from 'zod';
import { memoryFactsConfigSchema, memorySummaryConfigSchema } from './memory.js';
import {
  DEFAULT_SYSTEM_PROMPT,
  MAIN_AGENT_NAME,
  withObjectInputDefault
} from './shared.js';

export const agentRoleConfigSchema = z.object({
  name: z.string(),
  description: z.string().default(''),
  systemPrompt: z.string().default(DEFAULT_SYSTEM_PROMPT),
  model: z.string(),
  allowedSkills: z.array(z.string()).default(() => []),
  allowedTools: z.array(z.string()).default(() => [])
});

export const contextModeSchema = z.enum(['session', 'channel']);

export const agentDefaultsSchema = z.object({
  maxToolIterations: z.number().int().finite().default(128),
  memoryWindow: z.number().int().finite().default(10),
  memorySummary: memorySummaryConfigSchema,
  memoryFacts: memoryFactsConfigSchema,
  visionFallbackModel: z.string().default(''),
  contextMode: contextModeSchema.default('session'),
  maxSessions: z.number().int().finite().default(100)
}).strict().prefault(() => ({}));

export const agentConfigSchema = withObjectInputDefault({
  defaults: agentDefaultsSchema
});

export function createDefaultMainAgentRole(): z.output<typeof agentRoleConfigSchema> {
  return agentRoleConfigSchema.parse({
    name: MAIN_AGENT_NAME,
    description: '内建主 Agent',
    systemPrompt: DEFAULT_SYSTEM_PROMPT,
    model: 'openai/gpt-4o',
    allowedSkills: [],
    allowedTools: []
  });
}

export const agentsConfigSchema = z.object({
  roles: z.record(z.string(), agentRoleConfigSchema)
    .default(() => ({
      [MAIN_AGENT_NAME]: createDefaultMainAgentRole()
    }))
}).strict().prefault(() => ({
  roles: {
    [MAIN_AGENT_NAME]: createDefaultMainAgentRole()
  }
})).superRefine((value, ctx) => {
  if (!value.roles[MAIN_AGENT_NAME]) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['roles', MAIN_AGENT_NAME],
      message: 'agents.roles.main is required'
    });
  }
});

export type AgentRoleConfig = z.output<typeof agentRoleConfigSchema>;
export type AgentConfig = z.output<typeof agentConfigSchema>;
export type AgentsConfig = z.output<typeof agentsConfigSchema>;
export type ContextMode = z.output<typeof contextModeSchema>;
