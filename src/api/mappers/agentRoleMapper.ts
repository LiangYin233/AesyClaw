import type { AgentRoleConfig } from '../../types.js';

export function parseAgentRoleInput(body: any, nameFromPath?: string): AgentRoleConfig {
  if (!body || typeof body !== 'object') {
    throw new Error('Agent role payload must be an object');
  }

  const name = String(nameFromPath || body.name || '').trim();
  const model = String(body.model || '').trim();
  const systemPrompt = String(body.systemPrompt || '').trim();
  const description = String(body.description || '').trim();
  const allowedSkills = Array.isArray(body.allowedSkills)
    ? body.allowedSkills.filter((item: unknown): item is string => typeof item === 'string')
    : [];
  const allowedTools = Array.isArray(body.allowedTools)
    ? body.allowedTools.filter((item: unknown): item is string => typeof item === 'string')
    : [];

  if (!name) {
    throw new Error('name is required');
  }
  if (!model) {
    throw new Error('model is required');
  }
  if (!systemPrompt) {
    throw new Error('systemPrompt is required');
  }

  return {
    name,
    description,
    systemPrompt,
    model,
    allowedSkills,
    allowedTools
  };
}
