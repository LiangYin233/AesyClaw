import { z } from 'zod';
import type { Config } from '../../../types.js';
import { RequestValidationError } from '../../../platform/errors/boundary.js';
import { requireBoolean, requireObjectBody } from '../../shared/requestParsers.js';

const HTTP_URL_PROTOCOL = 'http:';

const mcpTransportTypeSchema = z.enum(['local', 'http']);

const mcpServerConfigSchema = z.object({
  type: mcpTransportTypeSchema.default('local'),
  command: z.array(z.string()).optional(),
  url: z.string().url().optional(),
  environment: z.record(z.string(), z.string()).optional(),
  enabled: z.boolean().default(true),
  timeout: z.number().int().finite().optional(),
  headers: z.record(z.string(), z.string()).optional()
}).refine((value) => {
  if (value.type === 'local' && (!value.command || value.command.length === 0)) {
    return false;
  }
  if (value.type === 'http' && !value.url) {
    return false;
  }
  return true;
}, {
  message: 'Invalid MCP server configuration'
});

type MCPServerConfig = z.output<typeof mcpServerConfigSchema>;

function getConfigValidationIssue(error: unknown): { message: string; field?: string } | null {
  if (!(error instanceof z.ZodError)) {
    return null;
  }
  const issue = error.issues[0];
  if (!issue) {
    return { message: 'Invalid configuration' };
  }
  const field = issue.path.map(String).join('.');
  return {
    message: issue.message || 'Invalid configuration',
    field: field || undefined
  };
}

export function parseCreateMcpServer(body: unknown): Config['mcp'][string] {
  try {
    return mcpServerConfigSchema.parse(body);
  } catch (error) {
    const issue = getConfigValidationIssue(error);
    if (issue) {
      throw new RequestValidationError(issue.message, issue.field);
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
