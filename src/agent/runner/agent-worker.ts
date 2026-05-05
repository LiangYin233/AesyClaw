/**
 * Agent Worker — 在独立线程中运行 PiAgent 提示循环。
 *
 * 工具调用的 execute 函数通过 IPC 代理到主线程执行，
 * 主线程在 ToolRegistry 中查找工具并返回结果。
 *
 * 注意：此文件必须是自包含的 — 不导入任何项目内的 TS 模块，
 * 因为 Worker 线程运行在独立 V8 isolate 中，没有 tsx/vitest 的加载器。
 */

import { parentPort, type MessagePort } from 'node:worker_threads';
import { Agent as PiAgent } from '@mariozechner/pi-agent-core';
import { streamSimple } from '@mariozechner/pi-ai';
import type { AgentTool, StreamFn } from '@mariozechner/pi-agent-core';
import type {
  Api,
  Context,
  Message,
  Model,
  SimpleStreamOptions,
  TSchema,
  TextContent,
} from '@mariozechner/pi-ai';

/**
 * IPC 消息类型 — Worker 与主线程之间的通信协议。
 *
 * - `init`: 主线程通知 Worker 启动一个 agent 会话
 * - `toolCall`: Worker 向主线程请求执行某个工具
 * - `toolResult`: 主线程将工具执行结果返回给 Worker
 */

/** 工具定义，由主线程序列化后传给 Worker */
type ToolDef = {
  name: string;
  description: string;
  parameters: unknown;
};

/** 工具调用请求（Worker → 主线程） */
type IpcToolCallMessage = {
  type: 'toolCall';
  callId: string;
  toolName: string;
  toolCallId: string;
  params: unknown;
};

/** 工具调用结果（主线程 → Worker） */
type IpcToolResultMessage = {
  type: 'toolResult';
  callId: string;
  result: unknown;
  error?: string;
};

/** Worker 初始化消息（主线程 → Worker） */
type IpcInitMessage = {
  type: 'init';
  systemPrompt: string;
  model: Model<Api>;
  apiKey: string;
  tools: ToolDef[];
  history: Message[];
  content: string;
  extraBody?: Record<string, unknown>;
  sessionId?: string;
};

/** Worker 可接收的所有 IPC 消息类型的联合 */
type IpcMessage = IpcInitMessage | IpcToolCallMessage | IpcToolResultMessage;

/** 提取 parentPort，不可用时抛出异常（Worker 必须有 parentPort） */
const parent = parentPort;
if (parent === null) {
  throw new Error('parentPort is required in worker thread');
}
/** 使用显式 MessagePort 类型变量，使闭包也能看到非 null 类型 */
const port: MessagePort = parent;

/**
 * 工具代理 — 将工具调用通过 IPC 委托给主线程执行。
 */
type ToolProxy = {
  name: string;
  label: string;
  description: string;
  parameters: unknown;
  execute: (toolCallId: string, params: unknown) => Promise<unknown>;
};

/**
 * 根据工具定义创建工具代理对象。
 *
 * @param def - 工具定义（名称、描述、参数 Schema）
 * @returns 适配 PiAgent AgentTool 接口的代理对象
 */
function createToolProxy(def: ToolDef): ToolProxy {
  return {
    name: def.name,
    label: def.name,
    description: def.description,
    parameters: def.parameters,
    execute: async (toolCallId: string, params: unknown): Promise<unknown> => {
      const callId = crypto.randomUUID();
      port.postMessage({
        type: 'toolCall' as const,
        callId,
        toolName: def.name,
        toolCallId,
        params,
      });
      return await new Promise<unknown>((resolve, reject) => {
        const handler = (msg: IpcMessage): void => {
          if (msg.type === 'toolResult' && msg.callId === callId) {
            port.removeListener('message', handler);
            if (msg.error !== undefined) {
              reject(new Error(msg.error));
            } else {
              resolve(msg.result);
            }
          }
        };
        port.on('message', handler);
      });
    },
  };
}

/**
 * 创建 PiAgent 使用的 stream 函数。
 * 如果传入了 extraBody，会在每个 API 请求的 payload 中注入额外参数。
 *
 * @param model - LLM 模型配置
 * @param apiKey - API 密钥
 * @param extraBody - 可选，注入到请求体的额外参数
 * @returns 适配 PiAgent StreamFn 接口的函数
 */
function createStreamFn(
  model: Model<Api>,
  apiKey: string,
  extraBody?: Record<string, unknown>,
): StreamFn {
  const hasExtra = extraBody !== undefined && Object.keys(extraBody).length > 0;
  if (!hasExtra) {
    return (m: Model<Api>, ctx: Context, opts?: SimpleStreamOptions) =>
      streamSimple(m, ctx, {
        ...opts,
        apiKey,
      });
  }
  return (m: Model<Api>, ctx: Context, opts?: SimpleStreamOptions) =>
    streamSimple(m, ctx, {
      ...opts,
      apiKey,
      onPayload: (p: unknown): unknown =>
        typeof p === 'object' && p !== null
          ? { ...(p as Record<string, unknown>), ...extraBody }
          : p,
    });
}

/**
 * 从 Message 中提取纯文本内容。
 * 如果 content 是字符串直接返回；如果是 ContentBlock 数组，拼接所有 text 块。
 *
 * @param message - Agent 消息对象
 * @returns 拼接后的文本
 */
function extractMessageText(message: Message): string {
  const { content } = message;
  if (typeof content === 'string') return content;
  return content
    .filter((c): c is TextContent => c.type === 'text')
    .map((c) => c.text)
    .join('\n');
}

/**
 * 从消息数组中查找最后一条有文本内容的 assistant 消息。
 *
 * @param messages - 消息数组（从头到尾顺序）
 * @returns 最后一条 assistant 消息的文本，或 null
 */
function findLastAssistantText(messages: readonly Message[]): string | null {
  for (const message of [...messages].reverse()) {
    if (message.role !== 'assistant') continue;
    const text = extractMessageText(message);
    if (text.trim().length > 0) return text;
  }
  return null;
}

/**
 * 处理 init 消息：创建 PiAgent 实例并运行提示循环。
 * 完成后通过 IPC 返回结果（done / fatal）。
 *
 * @param msg - 从主线程收到的 IPC 消息（仅处理 type === 'init' 的情况）
 */
async function handleInit(msg: IpcMessage): Promise<void> {
  if (msg.type !== 'init') return;

  const {
    systemPrompt,
    model,
    apiKey,
    tools: toolDefs,
    history,
    content,
    extraBody,
    sessionId,
  } = msg;

  const agentTools = toolDefs.map(createToolProxy);
  // 强制类型转换：IPC 代理不满足 AgentTool.execute 的精确返回类型
  // 契约（Promise<AgentToolResult>），但 PiAgent 在运行时按结构类型接受。
  const tools = agentTools as unknown as AgentTool<TSchema, unknown>[];
  const agent = new PiAgent({
    initialState: {
      systemPrompt,
      model,
      tools,
      messages: history,
    },
    streamFn: createStreamFn(model, apiKey, extraBody),
    getApiKey: () => apiKey,
    sessionId,
  });

  try {
    await agent.prompt(content);
    await agent.waitForIdle();

    const newMessages = agent.state.messages.slice(history.length);
    port.postMessage({
      type: 'done',
      newMessages,
      lastAssistant: findLastAssistantText(newMessages),
    });
  } catch (err) {
    port.postMessage({
      type: 'fatal',
      message: err instanceof Error ? err.message : String(err),
    });
  }
}

/** 监听主线程消息，收到 init 后启动 agent 循环 */
port.on('message', (msg: IpcMessage) => {
  void handleInit(msg);
});
