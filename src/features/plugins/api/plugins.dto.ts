import { requireBoolean, requireObjectBody, requireRecord } from '../../shared/requestParsers.js';

export function parseTogglePlugin(body: unknown): { enabled: boolean } {
  const payload = requireObjectBody(body);
  return {
    enabled: requireBoolean(payload.enabled, 'enabled', 'enabled is required and must be a boolean')
  };
}

export function parsePluginConfigUpdate(body: unknown): { options: Record<string, unknown> } {
  const payload = requireObjectBody(body);
  return {
    options: requireRecord(payload.options, 'options', 'options is required and must be an object')
  };
}
