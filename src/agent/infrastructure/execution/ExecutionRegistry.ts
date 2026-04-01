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

    if (!controller || current.controller === controller) {
      this.controllers.delete(key);
    }
  }
}
