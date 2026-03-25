import { requireBoolean, requireObjectBody } from '../shared/requestParsers.js';

export function parseToggleSkill(body: unknown): { enabled: boolean } {
  const payload = requireObjectBody(body);
  return {
    enabled: requireBoolean(payload.enabled, 'enabled', 'enabled must be a boolean')
  };
}
