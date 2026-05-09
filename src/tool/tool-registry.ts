/**
 * Tool registry — 管理工具的注册和执行。
 *
 * 提供注册、注销、按所有者范围的清理，
 * 以及基于角色的权限过滤。通过 ToolAdapter
 * 将已注册的工具转换为 Pi-mono AgentTool 格式。
 *
 */

import type { TSchema } from '@sinclair/typebox';
import type {
  ToolOwner,
  SessionKey,
  RoleConfig,
  Message,
  ToolPermissionConfig,
} from '@aesyclaw/core/types';
import { createScopedLogger } from '@aesyclaw/core/logger';
import type { HookDispatcher } from '@aesyclaw/pipeline/hook-dispatcher';
import type { AgentTool } from '@aesyclaw/agent/agent-types';
import { toAgentTool } from './tool-adapter';

const logger = createScopedLogger('tool-registry');

// ─── 核心类型 ─────────────────────────────────────────────────────

/**
 * 执行工具的结果。
 *
 * 工具返回结构化结果而不是抛出错误，
 * 允许代理 LLM 对失败和重试进行推理。
 *
 * @see error-handling.md — "Agent Tool Execution: Return Error Result"
 */
export type ToolExecutionResult = {
  content: string;
  details?: unknown;
  isError?: boolean;
  terminate?: boolean;
};

/**
 * 提供给工具执行函数的工具执行上下文。
 *
 * 随着更多子系统的实现，将会扩展。
 */
export type ToolExecutionContext = {
  sessionKey: SessionKey;
  /** 在可用时通过管道的 onSend 感知传递路径发送 */
  sendMessage?: (message: Message) => Promise<boolean>;
  /** 调用者角色的工具权限，子代理用于继承限制 */
  toolPermission?: ToolPermissionConfig;
  /** 将消息写入当前会话记录，使 LLM 在后续回合中可见 */
  addToHistory?: (role: 'user' | 'assistant', text: string) => Promise<void>;
};

/**
 * 可以注册到代理的工具。
 *
 * 每个工具都有一个所有者范围，以便在所属
 * 子系统（插件、MCP 服务器）卸载时自动清理。
 *
 * 参数模式使用 TypeBox (`TSchema`)，因此可以转换为
 * 用于 LLM 工具接口的 JSON Schema。`execute` 函数
 * 接收 `params: unknown`；各个工具实现内部使用
 * `Static<typeof SchemaParam>` 断言缩小类型，
 * 在运行时通过 TypeBox 模式进行验证。
 *
 * 为什么使用 `unknown` 而不是泛型？
 * 工具存储在异构注册表中。泛型 `execute`
 * 参数将是逆变的，阻止
 * `AesyClawTool<SpecificSchema>` 赋值给 `AesyClawTool`。
 * 由于适配器始终传递 `unknown` 参数（来自 LLM 输出），
 * `unknown` 是诚实、运行时准确的类型。TypeBox `Static<>`
 * + 运行时验证确保每个调用点的类型安全。
 */
export type AesyClawTool = {
  name: string;
  description: string;
  parameters: TSchema;
  owner: ToolOwner;
  execute: (params: unknown, context: ToolExecutionContext) => Promise<ToolExecutionResult>;
};

// ─── ToolRegistry ──────────────────────────────────────────────────

/**
 * 代理可用所有工具的中央注册表。
 *
 * 工具按所有者范围注册，以便当插件
 * 或 MCP 服务器卸载时，可以通过一次调用
 * `unregisterByOwner()` 移除其所有工具。
 *
 * 注册表强制名称唯一性 — 尝试注册
 * 名称已存在的工具会抛出错误。
 */
export class ToolRegistry {
  private tools: Map<string, AesyClawTool> = new Map();

  /**
   * 注册一个工具。
   *
   * @throws Error 如果同名工具已存在
   */
  register(tool: AesyClawTool): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`工具 "${tool.name}" 已注册`);
    }
    this.tools.set(tool.name, tool);
    logger.debug(`已注册工具: ${tool.name} (owner: ${tool.owner})`);
  }

  /**
   * 按名称注销工具。
   *
   * 如果工具不存在则为空操作。
   */
  unregister(name: string): void {
    const removed = this.tools.delete(name);
    if (removed) {
      logger.debug(`已注销工具: ${name}`);
    }
  }

  /**
   * 注销指定所有者拥有的所有工具。
   *
   * 用于插件或 MCP 服务器卸载时的清理。
   */
  unregisterByOwner(owner: ToolOwner): void {
    let count = 0;
    for (const [name, tool] of this.tools) {
      if (tool.owner === owner) {
        this.tools.delete(name);
        count++;
      }
    }
    if (count > 0) {
      logger.debug(`已注销 ${count} 个属于 ${owner} 的工具`);
    }
  }

  /** 获取所有已注册工具。 */
  getAll(): AesyClawTool[] {
    return [...this.tools.values()];
  }

  /** 按名称获取工具，未找到则返回 undefined。 */
  get(name: string): AesyClawTool | undefined {
    return this.tools.get(name);
  }

  /** 检查给定名称的工具是否已注册。 */
  has(name: string): boolean {
    return this.tools.has(name);
  }

  /**
   * 返回在运行时适配前角色可用的内部工具。
   */
  getForRole(role: RoleConfig): AesyClawTool[] {
    return filterToolsByRole(this.getAll(), role);
  }

  /**
   * 从单个过滤后的工具集解析面向提示的工具定义和运行时 AgentTools。
   */
  resolveForRole(
    role: RoleConfig,
    toolHookDispatcher: HookDispatcher,
    executionContext: Partial<ToolExecutionContext>,
  ): { tools: AesyClawTool[]; agentTools: AgentTool[] } {
    const tools = this.getForRole(role);
    return {
      tools,
      agentTools: this.toAgentTools(tools, toolHookDispatcher, executionContext),
    };
  }

  private toAgentTools(
    tools: AesyClawTool[],
    toolHookDispatcher: HookDispatcher,
    executionContext: Partial<ToolExecutionContext>,
  ): AgentTool[] {
    return tools.map((tool) => toAgentTool(tool, toolHookDispatcher, executionContext));
  }
}

// ─── 工具函数 ─────────────────────────────────────────────────────

/**
 * 基于角色权限过滤工具。
 *
 * - allowlist 模式：仅保留列表中的工具名称
 * - denylist 模式：排除列表中的工具名称
 */
export function filterToolsByRole(tools: AesyClawTool[], role: RoleConfig): AesyClawTool[] {
  const { mode, list } = role.toolPermission;

  if (mode === 'allowlist') {
    if (list.includes('*')) {
      return tools;
    }
    return tools.filter((tool) => list.includes(tool.name));
  }

  // 黑名单模式
  return tools.filter((tool) => !list.includes(tool.name));
}
