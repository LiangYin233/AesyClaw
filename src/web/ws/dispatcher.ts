/** WebSocket 消息分发器 — 根据 type 路由到对应的 service handler。 */

import { Type, type TSchema, type Static } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import type { WebRuntimeDependencies } from '@aesyclaw/web/types';
import type { WsMessage, WsResponse } from './types';

import * as configService from '@aesyclaw/web/services/config';
import * as cronService from '@aesyclaw/web/services/cron';
import * as logService from '@aesyclaw/web/services/logs';
import * as roleService from '@aesyclaw/web/services/roles';
import * as sessionService from '@aesyclaw/web/services/sessions';
import * as statusService from '@aesyclaw/web/services/status';
import * as usageService from '@aesyclaw/web/services/usage';

import { createScopedLogger } from '@aesyclaw/core/logger';

const logger = createScopedLogger('webui:ws');

type Handler = (data: unknown, deps: WebRuntimeDependencies) => unknown | Promise<unknown>;

const handlers = new Map<string, Handler>();

const SessionIdPayloadSchema = Type.Object({ sessionId: Type.String({ minLength: 1 }) });
const JobIdPayloadSchema = Type.Object({ jobId: Type.String({ minLength: 1 }) });
const IdPayloadSchema = Type.Object({ id: Type.String({ minLength: 1 }) });
const ToggleSchema = Type.Object({
  name: Type.String({ minLength: 1 }),
  enabled: Type.Boolean(),
});
const UpdateRoleSchema = Type.Intersect([
  Type.Object({ id: Type.String({ minLength: 1 }) }),
  Type.Record(Type.String(), Type.Unknown()),
]);
const SkillNameSchema = Type.Object({ name: Type.String({ minLength: 1 }) });

function on(type: string, handler: Handler): void {
  handlers.set(type, handler);
}

// ── 会话 ──
on('get_sessions', (_, deps) => sessionService.getSessions(deps));
on('get_messages', (data, deps) =>
  sessionService.getSessionMessages(deps, parsePayload(SessionIdPayloadSchema, data).sessionId),
);
on('clear_session', (data, deps) =>
  sessionService.clearSessionHistory(deps, parsePayload(SessionIdPayloadSchema, data).sessionId),
);

// ── 配置 ──
on('get_config', (_, deps) => configService.getConfig(deps));
on('get_config_schema', () => configService.getConfigSchema());
on('update_config', async (data, deps) => {
  await configService.updateConfig(deps, data as Record<string, unknown>);
});

// ── Cron ──
on('get_cron', (_, deps) => cronService.getCronJobs(deps));
on('get_cron_runs', (data, deps) =>
  cronService.getCronJobRuns(deps, parsePayload(JobIdPayloadSchema, data).jobId),
);

// ── 角色 ──
on('get_roles', (_, deps) => roleService.getRoles(deps));
on('get_role', (data, deps) => roleService.getRole(deps, parsePayload(IdPayloadSchema, data).id));
on('create_role', (data, deps) =>
  roleService.createRole(deps, data as Parameters<typeof roleService.createRole>[1]),
);
on('update_role', (data, deps) => {
  const { id, ...body } = parsePayload(UpdateRoleSchema, data);
  return roleService.updateRole(deps, id, body as Parameters<typeof roleService.updateRole>[2]);
});
on('delete_role', (data, deps) =>
  roleService.deleteRole(deps, parsePayload(IdPayloadSchema, data).id),
);

// ── 渠道 / 插件 ──
on('get_channels', (_, deps) => deps.channelManager.getRegisteredChannels());
on('get_plugins', (_, deps) => deps.pluginManager.getPluginDefinitions());
on('set_channel_enabled', async (data, deps) => {
  const { name, enabled } = parsePayload(ToggleSchema, data);
  if (enabled) await deps.channelManager.enable(name);
  else await deps.channelManager.disable(name);
});
on('set_plugin_enabled', async (data, deps) => {
  const { name, enabled } = parsePayload(ToggleSchema, data);
  if (enabled) await deps.pluginManager.enable(name);
  else await deps.pluginManager.disable(name);
});

// ── 状态 / 用量 ──
on('get_status', (_, deps) => statusService.getStatus(deps));
on('get_usage', (data, deps) =>
  usageService.getUsage(deps, data as Parameters<typeof usageService.getUsage>[1]),
);
on('get_usage_today', (_, deps) => usageService.getUsageToday(deps));
on('get_usage_tools', (data, deps) =>
  usageService.getUsageTools(deps, data as Parameters<typeof usageService.getUsageTools>[1]),
);

// ── 日志 ──
on('get_logs', (data) => logService.getLogs(data as Parameters<typeof logService.getLogs>[0]));

// ── 工具 ──
on('get_tools', (_, deps) =>
  deps.toolRegistry.getAll().map((tool) => ({
    name: tool.name,
    description: tool.description,
    owner: tool.owner,
    parameters: JSON.parse(JSON.stringify(tool.parameters)),
  })),
);

// ── 技能 ──
on('get_skills', (_, deps) =>
  deps.skillManager.getAllSkills().map((skill) => ({
    name: skill.name,
    description: skill.description,
    isSystem: skill.isSystem,
  })),
);
on('reload_skills', async (_, deps) => {
  const reloadCount = deps.skillManager.getAllSkills().length;
  await deps.skillManager.reload();
  const newCount = deps.skillManager.getAllSkills().length;
  return { message: `技能已重新加载。${reloadCount} → ${newCount}` };
});
on('get_skill_content', (data, deps) => {
  const { name } = parsePayload(SkillNameSchema, data);
  const skill = deps.skillManager.getSkill(name);
  if (!skill) throw new Error(`技能 "${name}" 未找到`);
  return { name: skill.name, content: skill.content };
});

/**
 * 消息分发器 — 接收 WebSocket 消息，路由到对应的 service handler，返回响应。
 */
export async function dispatchMessage(
  msg: WsMessage,
  deps: WebRuntimeDependencies,
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

function parsePayload<T extends TSchema>(schema: T, data: unknown): Static<T> {
  if (!Value.Check(schema, data)) {
    throw new Error('消息参数无效');
  }
  return data as Static<T>;
}
