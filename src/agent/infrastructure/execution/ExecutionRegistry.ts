export interface ActiveExecutionHandle {
  sessionKey: string;
  status: 'running' | 'aborted';
  scope?: 'chat' | 'session';
  channel?: string;
  chatId?: string;
  startedAt?: Date;
}

interface ExecutionEntry {
  controller: AbortController;
  handle: ActiveExecutionHandle;
}

/**
 * 维护 session 级当前执行句柄。
 * 同一 session 新执行开始时，会主动中止旧执行，避免并发主 turn 互相覆盖。
 */
export class ExecutionRegistry {
  private controllers = new Map<string, ExecutionEntry>();

  private createAbortError(message: string): Error {
    const error = new Error(message);
    error.name = 'AbortError';
    return error;
  }

  begin(
    key: string,
    controller?: AbortController,
    metadata?: Omit<ActiveExecutionHandle, 'sessionKey' | 'status'>
  ): AbortController {
    const existing = this.controllers.get(key);
    if (existing && !existing.controller.signal.aborted) {
      // 同一 session 只保留最新一次主执行。
      existing.controller.abort(this.createAbortError(`Execution superseded by newer run: ${key}`));
    }

    const activeController = controller ?? new AbortController();
    this.controllers.set(key, {
      controller: activeController,
      handle: {
        sessionKey: key,
        status: activeController.signal.aborted ? 'aborted' : 'running',
        scope: metadata?.scope || 'session',
        channel: metadata?.channel,
        chatId: metadata?.chatId,
        startedAt: metadata?.startedAt || new Date()
      }
    });
    return activeController;
  }

  get(key: string): AbortController | undefined {
    return this.controllers.get(key)?.controller;
  }

  getHandle(key: string): ActiveExecutionHandle | undefined {
    const entry = this.controllers.get(key);
    if (!entry) {
      return undefined;
    }

    return {
      ...entry.handle,
      status: entry.controller.signal.aborted ? 'aborted' : 'running'
    };
  }

  listHandles(): ActiveExecutionHandle[] {
    return Array.from(this.controllers.keys())
      .map((sessionKey) => this.getHandle(sessionKey))
      .filter((handle): handle is ActiveExecutionHandle => !!handle);
  }

  abort(key: string): boolean {
    const entry = this.controllers.get(key);
    if (!entry) {
      return false;
    }

    entry.controller.abort();
    return true;
  }

  end(key: string, controller?: AbortController): void {
    const current = this.controllers.get(key);
    if (!current) {
      return;
    }

    // 仅移除当前这一轮持有的句柄，避免旧执行 finally 误删新执行记录。
    if (!controller || current.controller === controller) {
      this.controllers.delete(key);
    }
  }
}
