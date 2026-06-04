export type DesktopConnectionConfig = {
  host: string;
  desktopPort: number;
  token: string;
};

export const DEFAULT_CONNECTION_CONFIG: DesktopConnectionConfig = {
  host: '127.0.0.1',
  desktopPort: 9730,
  token: 'desktop-local',
};

export function normalizeConnectionConfig(
  config: Partial<DesktopConnectionConfig>,
  options: { strict?: boolean; fallback?: DesktopConnectionConfig } = {},
): DesktopConnectionConfig {
  const fallback = options.fallback ?? DEFAULT_CONNECTION_CONFIG;
  const strict = options.strict ?? false;
  return {
    host: normalizeHost(config.host, fallback.host, strict),
    desktopPort: normalizePort(config.desktopPort, fallback.desktopPort),
    token:
      typeof config.token === 'string' && config.token.trim()
        ? config.token.trim()
        : fallback.token,
  };
}

export function isValidConnectionHost(host: string): boolean {
  if (!host || /\s/.test(host) || /[/?#]/.test(host) || host.includes('://')) return false;
  if (host.startsWith('[') || host.endsWith(']')) {
    return /^\[[0-9a-f:.]+\]$/i.test(host);
  }
  if (host.includes(':')) return false;
  return /^[a-z0-9.-]+$/i.test(host);
}

export function buildDesktopWsUrl(config: DesktopConnectionConfig): string {
  const url = new URL('ws://127.0.0.1/ws');
  url.hostname = config.host;
  url.port = String(config.desktopPort);
  url.searchParams.set('token', config.token);
  return url.toString();
}

function normalizeHost(value: unknown, fallback: string, strict: boolean): string {
  if (typeof value !== 'string') return fallback;
  const host = value.trim();
  if (isValidConnectionHost(host)) return host;
  if (strict) {
    throw new Error('Host must be a hostname or IP address without scheme, path, or port');
  }
  return fallback;
}

function normalizePort(value: unknown, fallback: number): number {
  const port = typeof value === 'number' ? value : Number(value);
  return Number.isInteger(port) && port > 0 && port <= 65535 ? port : fallback;
}
