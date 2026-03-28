import type { AgentRoleConfig } from '../../../types.js';
import { RequestValidationError } from '../../../platform/errors/boundary.js';

export function parseAgentRoleInput(body: unknown, nameFromPath?: string): AgentRoleConfig {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new RequestValidationError('Agent role payload must be an object');
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
    throw new RequestValidationError('name is required', 'name');
  }
  if (!model) {
    throw new RequestValidationError('model is required', 'model');
  }
  if (!systemPrompt) {
    throw new RequestValidationError('systemPrompt is required', 'systemPrompt');
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
