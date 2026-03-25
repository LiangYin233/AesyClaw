import type { Config } from '../../types.js';

export type ChannelStatusSnapshot = Record<string, {
  running?: boolean;
  enabled?: boolean;
  connected?: boolean;
}>;

export function buildChannelStatusSnapshot(args: {
  runtimeStatus: Record<string, { running: boolean }>;
  configuredChannels: Config['channels'];
}): ChannelStatusSnapshot {
  const { runtimeStatus, configuredChannels } = args;
  const snapshot: ChannelStatusSnapshot = {};

  for (const [name, config] of Object.entries(configuredChannels)) {
    const status = runtimeStatus[name];
    const running = status?.running ?? false;
    snapshot[name] = {
      running,
      enabled: Boolean((config as Record<string, unknown>)?.enabled),
      connected: running
    };
  }

  for (const [name, status] of Object.entries(runtimeStatus)) {
    snapshot[name] = {
      enabled: snapshot[name]?.enabled ?? true,
      running: status.running,
      connected: status.running
    };
  }

  snapshot.webui = {
    running: true,
    enabled: true,
    connected: true
  };

  return snapshot;
}
