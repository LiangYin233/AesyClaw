import type { Config } from '../../../types.js';

export type PublicConfigPayload = Omit<Config, 'server'> & {
  server: Omit<Config['server'], 'token'>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function sanitizePublicConfig(config: Config): PublicConfigPayload {
  const nextConfig = structuredClone(config);
  const { token: _token, ...server } = nextConfig.server;
  return {
    ...nextConfig,
    server
  };
}

export function preserveServerTokenInPublicConfig(
  nextConfig: unknown,
  currentConfig: Config
): Record<string, unknown> {
  const candidate = isRecord(nextConfig) ? structuredClone(nextConfig) : {};
  const server = isRecord(candidate.server) ? candidate.server : {};

  candidate.server = {
    ...server,
    token: currentConfig.server.token
  };

  return candidate;
}
