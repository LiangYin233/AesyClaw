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

// ========== IPC Message Types ==========

type ToolDef = {
  name: string;
  description: string;
  parameters: unknown;
};

type IpcToolCallMessage = {
  type: 'toolCall';
  callId: string;
  toolName: string;
  toolCallId: string;
  params: unknown;
};

type IpcToolResultMessage = {
  type: 'toolResult';
  callId: string;
  result: unknown;
  error?: string;
};

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

type IpcMessage = IpcInitMessage | IpcToolCallMessage | IpcToolResultMessage;

// ========== parentPort extraction ==========

// Extract parentPort, throwing if unavailable (worker must have it).
// Use an explicit MessagePort-typed variable so closures also see the non-null type.
const parent = parentPort;
if (parent === null) {
  throw new Error('parentPort is required in worker thread');
}
const port: MessagePort = parent;

type ToolProxy = {
  name: string;
  label: string;
  description: string;
  parameters: unknown;
  execute: (toolCallId: string, params: unknown) => Promise<unknown>;
};

// ========== Tool Proxy ==========

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
        const timeout = setTimeout(() => {
          port.removeAllListeners('message');
          reject(new Error(`工具 "${def.name}" 超时 (120s)`));
        }, 120_000);
        const handler = (msg: IpcMessage): void => {
          if (msg.type === 'toolResult' && msg.callId === callId) {
            clearTimeout(timeout);
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

// ========== Stream Function ==========

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

// ========== Message Helpers ==========

function extractMessageText(message: Message): string {
  const { content } = message;
  if (typeof content === 'string') return content;
  return content
    .filter((c): c is TextContent => c.type === 'text')
    .map((c) => c.text)
    .join('\n');
}

function findLastAssistantText(messages: readonly Message[]): string | null {
  for (const message of [...messages].reverse()) {
    if (message.role !== 'assistant') continue;
    const text = extractMessageText(message);
    if (text.trim().length > 0) return text;
  }
  return null;
}

// ========== Init Handler ==========

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
  // Cast: the IPC proxy doesn't satisfy AgentTool.execute's exact return type
  // contract (Promise<AgentToolResult>), but PiAgent accepts it structurally at runtime.
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

// ========== Message Listener ==========

port.on('message', (msg: IpcMessage) => {
  void handleInit(msg);
});
