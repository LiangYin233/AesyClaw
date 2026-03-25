import type { AgentRoleConfig } from '../../types.js';
import { ValidationError } from '../../api/errors.js';

export function parseAgentRoleInput(body: unknown, nameFromPath?: string): AgentRoleConfig {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new ValidationError('Agent role payload must be an object');
  }

  const payload = body as Record<string, unknown>;
  const name = String(nameFromPath || payload.name || '').trim();
  const model = String(payload.model || '').trim();
  const systemPrompt = String(payload.systemPrompt || '').trim();
  const description = String(payload.description || '').trim();
  const allowedSkills = Array.isArray(payload.allowedSkills)
    ? payload.allowedSkills.filter((item): item is string => typeof item === 'string')
    : [];
  const allowedTools = Array.isArray(payload.allowedTools)
    ? payload.allowedTools.filter((item): item is string => typeof item === 'string')
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
