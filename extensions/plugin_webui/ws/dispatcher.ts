/** plugin_webui WebSocket dispatcher — routes WebUI messages through PluginContext control APIs. */

import { Type, type Static, type TSchema } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import { AppConfigSchema, type PluginContext, type RoleConfig } from '@aesyclaw/sdk';
import * as extensionService from '../services/extensions';
import * as configService from '../services/config';
import * as cronService from '../services/cron';
import * as logService from '../services/logs';
import * as roleService from '../services/roles';
import * as sessionService from '../services/sessions';
import * as statusService from '../services/status';
import * as usageService from '../services/usage';
import type { WsMessage, WsResponse } from './types';

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

type Handler = (data: unknown, ctx: PluginContext) => unknown | Promise<unknown>;
const handlers = new Map<string, Handler>();

function on(type: string, handler: Handler): void {
  handlers.set(type, handler);
}

on('get_sessions', (_, ctx) => sessionService.getSessions(ctx));
on('get_messages', (data, ctx) =>
  sessionService.getSessionMessages(ctx, parsePayload(SessionIdPayloadSchema, data).sessionId),
);
on('clear_session', (data, ctx) =>
  sessionService.clearSessionHistory(ctx, parsePayload(SessionIdPayloadSchema, data).sessionId),
);

on('get_config', (_, ctx) => configService.getConfig(ctx));
on('get_config_schema', () => AppConfigSchema);
on('update_config', (data, ctx) => configService.updateConfig(ctx, data));

on('get_cron', (_, ctx) => cronService.getCronJobs(ctx));
on('get_cron_runs', (data, ctx) =>
  cronService.getCronJobRuns(ctx, parsePayload(JobIdPayloadSchema, data).jobId),
);

on('get_roles', (_, ctx) => roleService.getRoles(ctx));
on('get_role', (data, ctx) => roleService.getRole(ctx, parsePayload(IdPayloadSchema, data).id));
on('create_role', (data, ctx) =>
  roleService.createRole(ctx, data as Omit<RoleConfig, 'id'> & { id?: string }),
);
on('update_role', (data, ctx) => {
  const { id, ...body } = parsePayload(UpdateRoleSchema, data);
  return roleService.updateRole(ctx, id, body as Partial<RoleConfig>);
});
on('delete_role', (data, ctx) => roleService.deleteRole(ctx, parsePayload(IdPayloadSchema, data).id));

on('get_channels', (_, ctx) => extensionService.listExtensions(ctx, 'channels'));
on('get_plugins', (_, ctx) => extensionService.listExtensions(ctx, 'plugins'));
on('set_channel_enabled', (data, ctx) => {
  const { name, enabled } = parsePayload(ToggleSchema, data);
  return extensionService.setExtensionEnabled(ctx, 'channels', name, enabled);
});
on('set_plugin_enabled', (data, ctx) => {
  const { name, enabled } = parsePayload(ToggleSchema, data);
  return extensionService.setExtensionEnabled(ctx, 'plugins', name, enabled);
});

on('get_status', (_, ctx) => statusService.getStatus(ctx));
on('get_usage', (data, ctx) =>
  usageService.getUsage(ctx, data as { model?: string; from?: string; to?: string }),
);
on('get_usage_today', (_, ctx) => usageService.getUsageToday(ctx));
on('get_usage_tools', (data, ctx) =>
  usageService.getUsageTools(ctx, data as { from?: string; to?: string }),
);

on('get_logs', (data, ctx) => logService.getLogs(ctx, normalizeLogQuery(data)));
on('get_tools', (_, ctx) => ctx.control.tools.list());
on('get_skills', (_, ctx) => ctx.control.skills.list());
on('reload_skills', async (_, ctx) => {
  const before = (await ctx.control.skills.list()).length;
  await ctx.control.skills.reload();
  const after = (await ctx.control.skills.list()).length;
  return { message: `技能已重新加载。${before} → ${after}` };
});
on('get_skill_content', (data, ctx) =>
  ctx.control.skills.getContent(parsePayload(SkillNameSchema, data).name),
);

export async function dispatchMessage(msg: WsMessage, ctx: PluginContext): Promise<WsResponse> {
  try {
    const handler = handlers.get(msg.type);
    if (!handler) return errorResponse(msg, `未知消息类型: ${msg.type}`);
    const data = await handler(msg.data, ctx);
    return okResponse(msg, data);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    ctx.log.error('处理 WebUI WS 消息失败', { type: msg.type, error: message });
    return errorResponse(msg, message);
  }
}

function okResponse(msg: WsMessage, data?: unknown): WsResponse {
  const response: WsResponse = { type: msg.type, ok: true };
  if (data !== undefined) response.data = data;
  return response;
}

function errorResponse(msg: WsMessage, error: string): WsResponse {
  return { type: msg.type, ok: false, error };
}

function parsePayload<T extends TSchema>(schema: T, data: unknown): Static<T> {
  if (!Value.Check(schema, data)) throw new Error('消息参数无效');
  return data as Static<T>;
}

function normalizeLogQuery(data: unknown): { limit?: number } | undefined {
  if (!isRecord(data)) return undefined;
  const raw = data['limit'];
  if (typeof raw === 'number') return { limit: raw };
  if (typeof raw === 'string') return { limit: Number.parseInt(raw, 10) };
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
