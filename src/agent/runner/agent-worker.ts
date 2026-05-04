/**
 * Agent Worker — 在独立线程中运行 PiAgent 提示循环。
 *
 * 工具调用的 execute 函数通过 IPC 代理到主线程执行，
 * 主线程在 ToolRegistry 中查找工具并返回结果。
 *
 * 注意：此文件必须是自包含的 — 不导入任何项目内的 TS 模块，
 * 因为 Worker 线程运行在独立 V8 isolate 中，没有 tsx/vitest 的加载器。
 */

import { parentPort } from 'node:worker_threads';
import { Agent as PiAgent } from '@mariozechner/pi-agent-core';
import { streamSimple } from '@mariozechner/pi-ai';

type ToolDef = {
  name: string;
  description: string;
  parameters: unknown;
};

function createToolProxy(def: ToolDef) {
  return {
    name: def.name,
    label: def.name,
    description: def.description,
    parameters: def.parameters,
    execute: async (toolCallId: string, params: unknown): Promise<unknown> => {
      const callId = crypto.randomUUID();
      parentPort!.postMessage({ type: 'toolCall', callId, toolName: def.name, toolCallId, params });
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          parentPort!.removeAllListeners('message');
          reject(new Error(`工具 "${def.name}" 超时 (120s)`));
        }, 120_000);
        const handler = (msg: any): void => {
          if (msg.type === 'toolResult' && msg.callId === callId) {
            clearTimeout(timeout);
            parentPort!.removeListener('message', handler);
            if ('error' in msg) reject(new Error(msg.error));
            else resolve(msg.result);
          }
        };
        parentPort!.on('message', handler);
      });
    },
  };
}

function createStreamFn(model: any, apiKey: string, extraBody?: Record<string, unknown>) {
  const hasExtra = extraBody && Object.keys(extraBody).length > 0;
  return (m: any, ctx: any, opts: any) =>
    streamSimple(m, ctx, {
      ...(opts as Record<string, unknown>),
      apiKey,
      ...(hasExtra
        ? {
            onPayload: (p: unknown) =>
              typeof p === 'object' && p !== null
                ? { ...(p as Record<string, unknown>), ...extraBody }
                : p,
          }
        : {}),
    });
}

function extractMessageText(message: any): string {
  if (!message) return '';
  const content = message.content;
  if (!content) return '';
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter((c: any) => c?.type === 'text')
      .map((c: any) => c?.text ?? '')
      .join('\n');
  }
  return String(content);
}

function findLastAssistantText(messages: any[]): string | null {
  for (const message of [...messages].reverse()) {
    if (message.role !== 'assistant') continue;
    const text = extractMessageText(message);
    if (text.trim().length > 0) return text;
  }
  return null;
}

parentPort!.on('message', async (msg: any) => {
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
  const agent = new PiAgent({
    initialState: {
      systemPrompt,
      model,
      tools: agentTools,
      messages: history,
    } as any,
    streamFn: createStreamFn(model, apiKey, extraBody),
    getApiKey: () => apiKey,
    sessionId: sessionId as any,
  });

  try {
    await agent.prompt(content);
    await agent.waitForIdle();

    const newMessages = agent.state.messages.slice(history.length);
    parentPort!.postMessage({
      type: 'done',
      newMessages,
      lastAssistant: findLastAssistantText(newMessages),
    });
  } catch (err) {
    parentPort!.postMessage({
      type: 'fatal',
      message: err instanceof Error ? err.message : String(err),
    });
  }
});
