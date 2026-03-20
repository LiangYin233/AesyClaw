import type { ExecutionStatus } from '../../domain/execution.js';

interface ExecutionEntry {
  controller: AbortController;
  status: ExecutionStatus;
}

export class ExecutionRegistry {
  private readonly entries = new Map<string, ExecutionEntry>();

  start(
    sessionKey: string,
    controller = new AbortController(),
    metadata?: Pick<ExecutionStatus, 'channel' | 'chatId'>
  ): AbortController {
    this.entries.set(sessionKey, {
      controller,
      status: {
        sessionKey,
        active: !controller.signal.aborted,
        channel: metadata?.channel,
        chatId: metadata?.chatId
      }
    });
    return controller;
  }

  getStatus(sessionKey: string): ExecutionStatus | undefined {
    const entry = this.entries.get(sessionKey);
    if (!entry) {
      return undefined;
    }

    return {
      ...entry.status,
      active: !entry.controller.signal.aborted
    };
  }

  abortBySessionKey(sessionKey: string): boolean {
    const entry = this.entries.get(sessionKey);
    if (!entry) {
      return false;
    }

    entry.controller.abort();
    return true;
  }

  end(sessionKey: string): void {
    this.entries.delete(sessionKey);
  }
}
