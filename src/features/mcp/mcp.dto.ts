import { getConfigValidationIssue, parseMCPServerConfig } from '../../config/index.js';
import type { Config } from '../../types.js';
import { ValidationError } from '../../api/errors.js';
import { requireBoolean, requireObjectBody } from '../shared/requestParsers.js';

export function parseCreateMcpServer(body: unknown): Config['mcp'][string] {
  try {
    return parseMCPServerConfig(body);
  } catch (error) {
    const issue = getConfigValidationIssue(error);
    if (issue) {
      throw new ValidationError(issue.message, issue.field);
    }
    throw error;
  }
}

export function parseToggleMcpServer(body: unknown): { enabled: boolean } {
  const payload = requireObjectBody(body);
  return {
    enabled: requireBoolean(payload.enabled, 'enabled', 'enabled must be a boolean')
  };
}
