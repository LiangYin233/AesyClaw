/**
 * src/web/types — Web 模块公共依赖类型。
 *
 * 此类型供 WebUiManager、WebSocket handler 和所有 Web service 共享，
 * 避免 web/services/*、web/ws/* 反向依赖 webui-manager，打破循环。
 */

import type { ConfigManager } from '@aesyclaw/core/config/config-manager';
import type { DatabaseManager } from '@aesyclaw/core/database/database-manager';
import type { SessionManager } from '@aesyclaw/session';
import type { CronManager } from '@aesyclaw/cron/cron-manager';
import type { RoleManager } from '@aesyclaw/role/role-manager';
import type { ChannelManager } from '@aesyclaw/extension/channel/channel-manager';
import type { ExtensionManager } from '@aesyclaw/extension/extension-manager';
import type { ToolRegistry } from '@aesyclaw/tool/tool-registry';
import type { SkillManager } from '@aesyclaw/skill/skill-manager';
import type { ResolvedPaths } from '@aesyclaw/core/path-resolver';

/** Web 运行时需要的所有依赖项 */
export type WebRuntimeDependencies = {
  configManager: ConfigManager;
  databaseManager: DatabaseManager;
  sessionManager: SessionManager;
  cronManager: CronManager;
  roleManager: RoleManager;
  channelManager: ChannelManager;
  pluginManager: ExtensionManager;
  toolRegistry: ToolRegistry;
  skillManager: SkillManager;
  paths: Readonly<ResolvedPaths>;
};
