import { requireObjectBody } from '../../shared/requestParsers.js';

export function parseConfigUpdate(body: unknown): Record<string, unknown> {
  return requireObjectBody(body, 'config', 'config body must be an object');
}
