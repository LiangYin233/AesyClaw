import type { AgentRoleConfig } from '../../types.js';
import { ValidationError } from '../errors.js';

export function parseAgentRoleInput(body: any, nameFromPath?: string): AgentRoleConfig {
  if (!body || typeof body !== 'object') {
    throw new ValidationError('Agent role payload must be an object');
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
    throw new ValidationError('name is required', 'name');
  }
  if (!model) {
    throw new ValidationError('model is required', 'model');
  }
  if (!systemPrompt) {
    throw new ValidationError('systemPrompt is required', 'systemPrompt');
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
