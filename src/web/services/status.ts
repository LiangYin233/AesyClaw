/** 状态 Service。 */

import type { WebUiManagerDependencies } from '@aesyclaw/web/webui-manager';
import { APP_NAME, APP_VERSION } from '@aesyclaw/core/types';

/**
 * 获取应用状态。
 */
export function getStatus(deps: WebUiManagerDependencies): {
  app: string;
  version: string;
  uptime: number;
  channels: Array<{ name: string; state: string; version?: string; error?: string }>;
  database: unknown;
} {
  const channels = deps.channelManager.listChannels();
  const stats = deps.databaseManager.getStats();

  return {
    app: APP_NAME,
    version: APP_VERSION,
    uptime: process.uptime(),
    channels: channels.map((ch) => ({
      name: ch.name,
      state: ch.state,
      version: ch.version,
      error: ch.error,
    })),
    database: stats,
  };
}
