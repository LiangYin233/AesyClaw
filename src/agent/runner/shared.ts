/**
 * runner/shared — 跨 runner 模块共享的工具类与函数。
 *
 * 包括可重用的错误类和取消检查函数，
 * 避免在 runner.ts 和 tool-runtime.ts 中重复定义。
 */

export class AgentRunCancelledError extends Error {
  constructor() {
    super('Agent 处理已中止');
  }
}

export function throwIfCancelled(signal: AbortSignal): void {
  if (signal.aborted) {
    throw signal.reason instanceof Error ? signal.reason : new AgentRunCancelledError();
  }
}
