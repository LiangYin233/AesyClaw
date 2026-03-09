export interface ForegroundExecutionHandle {
  sessionKey: string;
  status: 'running' | 'aborted';
}

export class ExecutionRegistry {
  private controllers = new Map<string, AbortController>();

  begin(key: string, controller?: AbortController): AbortController {
    const activeController = controller ?? new AbortController();
    this.controllers.set(key, activeController);
    return activeController;
  }

  get(key: string): AbortController | undefined {
    return this.controllers.get(key);
  }

  getHandle(key: string): ForegroundExecutionHandle | undefined {
    const controller = this.controllers.get(key);
    if (!controller) {
      return undefined;
    }

    return {
      sessionKey: key,
      status: controller.signal.aborted ? 'aborted' : 'running'
    };
  }

  listHandles(): ForegroundExecutionHandle[] {
    return Array.from(this.controllers.entries()).map(([sessionKey, controller]) => ({
      sessionKey,
      status: controller.signal.aborted ? 'aborted' : 'running'
    }));
  }

  abort(key: string): boolean {
    const controller = this.controllers.get(key);
    if (!controller) {
      return false;
    }

    controller.abort();
    return true;
  }

  end(key: string, controller?: AbortController): void {
    const current = this.controllers.get(key);
    if (!current) {
      return;
    }

    if (!controller || current === controller) {
      this.controllers.delete(key);
    }
  }
}
