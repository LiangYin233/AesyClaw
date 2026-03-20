import type { AgentRoleConfig } from '../../types.js';

function parseBooleanField(value: unknown, field: string): boolean {
  if (value === undefined) {
    return false;
  }
  if (typeof value === 'boolean') {
    return value;
  }
  if (value === 'true') {
    return true;
  }
  if (value === 'false') {
    return false;
  }
  throw new Error(`${field} must be a boolean`);
}

export function parseAgentRoleInput(body: any, nameFromPath?: string): AgentRoleConfig {
  if (!body || typeof body !== 'object') {
    throw new Error('Agent role payload must be an object');
  }

  const name = String(nameFromPath || body.name || '').trim();
  const provider = String(body.provider || '').trim();
  const model = String(body.model || '').trim();
  const systemPrompt = String(body.systemPrompt || '').trim();
  const description = String(body.description || '').trim();
  const vision = parseBooleanField(body.vision, 'vision');
  const reasoning = parseBooleanField(body.reasoning, 'reasoning');
  const visionProvider = String(body.visionProvider || '').trim();
  const visionModel = String(body.visionModel || '').trim();
  const allowedSkills = Array.isArray(body.allowedSkills)
    ? body.allowedSkills.filter((item: unknown): item is string => typeof item === 'string')
    : [];
  const allowedTools = Array.isArray(body.allowedTools)
    ? body.allowedTools.filter((item: unknown): item is string => typeof item === 'string')
    : [];

  if (!name) {
    throw new Error('name is required');
  }
  if (!provider) {
    throw new Error('provider is required');
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
    provider,
    model,
    vision,
    reasoning,
    visionProvider,
    visionModel,
    allowedSkills,
    allowedTools
  };
}
