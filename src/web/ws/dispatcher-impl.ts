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

/**
 * 消息分发器 — 接收 WebSocket 消息，路由到对应的 service handler，返回响应。
 *
 * @param msg - 客户端发来的 WebSocket 消息
 * @param deps - WebUI 管理器依赖项
 * @returns 封装为 WsResponse 的处理结果
 */
export async function dispatchMessage(
  msg: WsMessage,
  deps: WebUiManagerDependencies,
): Promise<WsResponse> {
  try {
    switch (msg.type) {
      // 会话
      case 'get_sessions':
        return okResponse(msg, await getSessions(deps));
      case 'get_messages': {
        const sessionId = extractStringData(msg.data, 'sessionId');
        return okResponse(msg, await getSessionMessages(deps, sessionId));
      }
      case 'clear_session': {
        const sessionId = extractStringData(msg.data, 'sessionId');
        await clearSessionHistory(deps, sessionId);
        return okResponse(msg);
      }

      // 配置
      case 'get_config':
        return okResponse(msg, getConfig(deps));
      case 'get_config_schema':
        return okResponse(msg, getConfigSchema());
      case 'update_config': {
        await updateConfig(deps, msg.data as Record<string, unknown>);
        return okResponse(msg);
      }

      // Cron
      case 'get_cron':
        return okResponse(msg, await getCronJobs(deps));
      case 'get_cron_runs': {
        const jobId = extractStringData(msg.data, 'jobId');
        return okResponse(msg, await getCronJobRuns(deps, jobId));
      }

      // 角色
      case 'get_roles':
        return okResponse(msg, getRoles(deps));
      case 'get_role': {
        const roleId = extractStringData(msg.data, 'id');
        return okResponse(msg, getRole(deps, roleId));
      }
      case 'create_role': {
        const data = await createRole(deps, msg.data as Parameters<typeof createRole>[1]);
        return okResponse(msg, data);
      }
      case 'update_role': {
        const { id: roleUpdateId, ...body } = msg.data as { id: string } & Record<string, unknown>;
        const data = await updateRole(deps, roleUpdateId, body as Parameters<typeof updateRole>[2]);
        return okResponse(msg, data);
      }
      case 'delete_role': {
        const deleteId = extractStringData(msg.data, 'id');
        await deleteRole(deps, deleteId);
        return okResponse(msg);
      }

      // 渠道
      case 'get_channels':
        return okResponse(msg, deps.channelManager.getRegisteredChannels());

      // 插件
      case 'get_plugins':
        return okResponse(msg, await deps.pluginManager.getPluginDefinitions());

      // 状态
      case 'get_status':
        return okResponse(msg, getStatus(deps));

      // 用量
      case 'get_usage':
        return okResponse(msg, await getUsage(deps, msg.data as Parameters<typeof getUsage>[1]));
      case 'get_usage_today':
        return okResponse(msg, await getUsageToday(deps));
      case 'get_usage_tools':
        return okResponse(
          msg,
          await getUsageTools(deps, msg.data as Parameters<typeof getUsageTools>[1]),
        );

      // 日志
      case 'get_logs':
        return okResponse(msg, getLogs(msg.data as Parameters<typeof getLogs>[0]));

      // 工具
      case 'get_tools':
        return okResponse(
          msg,
          deps.toolRegistry.getAll().map((tool) => ({
            name: tool.name,
            description: tool.description,
            owner: tool.owner,
            parameters: JSON.parse(JSON.stringify(tool.parameters)),
          })),
        );

      // 技能
      case 'get_skills':
        return okResponse(
          msg,
          deps.skillManager.getAllSkills().map((skill) => ({
            name: skill.name,
            description: skill.description,
            isSystem: skill.isSystem,
          })),
        );
      case 'reload_skills': {
        const reloadCount = deps.skillManager.getAllSkills().length;
        await deps.skillManager.reload();
        const newCount = deps.skillManager.getAllSkills().length;
        return okResponse(msg, { message: `技能已重新加载。${reloadCount} → ${newCount}` });
      }
      case 'get_skill_content': {
        const data = msg.data as { name: string };
        if (!data?.name) {
          return errorResponse(msg, '缺少技能名称');
        }
        const skill = deps.skillManager.getSkill(data.name);
        if (!skill) {
          return errorResponse(msg, `技能 "${data.name}" 未找到`);
        }
        return okResponse(msg, { name: skill.name, content: skill.content });
      }

      default:
        logger.warn('未知消息类型', { type: msg.type });
        return errorResponse(msg, `未知消息类型: ${msg.type}`);
    }
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
