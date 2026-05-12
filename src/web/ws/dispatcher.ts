/** WebSocket 消息分发器 — 根据 type 路由到对应的 service handler。 */

import type { WebUiManagerDependencies } from '@aesyclaw/web/webui-manager';
import type { WsMessage, WsResponse } from './types';

import {
  clearSessionHistory,
  getSessions,
  getSessionMessages,
} from '@aesyclaw/web/services/sessions';
import { getConfig, getConfigSchema, updateConfig } from '@aesyclaw/web/services/config';
import { getCronJobs, getCronJobRuns } from '@aesyclaw/web/services/cron';
import {
  getRoles,
  getRole,
  createRole,
  updateRole,
  deleteRole,
} from '@aesyclaw/web/services/roles';

import { getStatus } from '@aesyclaw/web/services/status';
import { getUsage, getUsageToday, getUsageTools } from '@aesyclaw/web/services/usage';
import { getLogs } from '@aesyclaw/web/services/logs';

import { createScopedLogger } from '@aesyclaw/core/logger';

const logger = createScopedLogger('webui:ws');

type Handler = (data: unknown, deps: WebUiManagerDependencies) => Promise<unknown>;

const handlers = new Map<string, Handler>();

function on(type: string, handler: Handler): void {
  handlers.set(type, handler);
}

// ── 会话 ──
on('get_sessions', (_, deps) => getSessions(deps));
on('get_messages', async (data, deps) => {
  return await getSessionMessages(deps, extractStringData(data, 'sessionId'));
});
on('clear_session', async (data, deps) => {
  await clearSessionHistory(deps, extractStringData(data, 'sessionId'));
});

// ── 配置 ──
on('get_config', (_, deps) => Promise.resolve(getConfig(deps)));
on('get_config_schema', () => Promise.resolve(getConfigSchema()));
on('update_config', async (data, deps) => {
  await updateConfig(deps, data as Record<string, unknown>);
});

// ── Cron ──
on('get_cron', (_, deps) => getCronJobs(deps));
on('get_cron_runs', async (data, deps) => {
  return await getCronJobRuns(deps, extractStringData(data, 'jobId'));
});

// ── 角色 ──
on('get_roles', (_, deps) => Promise.resolve(getRoles(deps)));
on('get_role', (data, deps) =>
  Promise.resolve(getRole(deps, extractStringData(data, 'id'))),
);
on('create_role', async (data, deps) => {
  return await createRole(deps, data as Parameters<typeof createRole>[1]);
});
on('update_role', async (data, deps) => {
  const { id, ...body } = data as { id: string } & Record<string, unknown>;
  return await updateRole(deps, id, body as Parameters<typeof updateRole>[2]);
});
on('delete_role', async (data, deps) => {
  await deleteRole(deps, extractStringData(data, 'id'));
});

// ── 渠道 / 插件 ──
on('get_channels', (_, deps) => Promise.resolve(deps.channelManager.getRegisteredChannels()));
on('get_plugins', async (_, deps) => {
  return await deps.pluginManager.getPluginDefinitions();
});

// ── 状态 / 用量 ──
on('get_status', (_, deps) => Promise.resolve(getStatus(deps)));
on('get_usage', (data, deps) => getUsage(deps, data as Parameters<typeof getUsage>[1]));
on('get_usage_today', (_, deps) => getUsageToday(deps));
on('get_usage_tools', (data, deps) =>
  getUsageTools(deps, data as Parameters<typeof getUsageTools>[1]),
);

// ── 日志 ──
on('get_logs', (data) => Promise.resolve(getLogs(data as Parameters<typeof getLogs>[0])));

// ── 工具 ──
on('get_tools', (_, deps) =>
  Promise.resolve(
    deps.toolRegistry.getAll().map((tool) => ({
      name: tool.name,
      description: tool.description,
      owner: tool.owner,
      parameters: JSON.parse(JSON.stringify(tool.parameters)),
    })),
  ),
);

// ── 技能 ──
on('get_skills', (_, deps) =>
  Promise.resolve(
    deps.skillManager.getAllSkills().map((skill) => ({
      name: skill.name,
      description: skill.description,
      isSystem: skill.isSystem,
    })),
  ),
);
on('reload_skills', async (_, deps) => {
  const reloadCount = deps.skillManager.getAllSkills().length;
  await deps.skillManager.reload();
  const newCount = deps.skillManager.getAllSkills().length;
  return { message: `技能已重新加载。${reloadCount} → ${newCount}` };
});
on('get_skill_content', (data, deps) => {
  const { name } = data as { name: string };
  if (!name) throw new Error('缺少技能名称');
  const skill = deps.skillManager.getSkill(name);
  if (!skill) throw new Error(`技能 "${name}" 未找到`);
  return Promise.resolve({ name: skill.name, content: skill.content });
});

/**
 * 消息分发器 — 接收 WebSocket 消息，路由到对应的 service handler，返回响应。
 */
export async function dispatchMessage(
  msg: WsMessage,
  deps: WebUiManagerDependencies,
): Promise<WsResponse> {
  try {
    const handler = handlers.get(msg.type);
    if (!handler) {
      logger.warn('未知消息类型', { type: msg.type });
      return errorResponse(msg, `未知消息类型: ${msg.type}`);
    }
    const data = await handler(msg.data, deps);
    return okResponse(msg, data);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('处理 WS 消息失败', { type: msg.type, error: message });
    return errorResponse(msg, message);
  }
}

function okResponse(msg: WsMessage, data?: unknown): WsResponse {
  const response: WsResponse = { type: msg.type, ok: true };
  if (data !== undefined) {
    response.data = data;
  }
  return response;
}

function errorResponse(msg: WsMessage, error: string): WsResponse {
  return { type: msg.type, ok: false, error };
}

function extractStringData(data: unknown, key: string): string {
  if (data !== null && typeof data === 'object' && !Array.isArray(data)) {
    const value = (data as Record<string, unknown>)[key];
    if (typeof value === 'string') return value;
  }
  throw new Error(`缺少必要参数: ${key}`);
}
