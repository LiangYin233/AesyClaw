import type { BackgroundTaskHandle, BackgroundTaskManager } from './BackgroundTaskManager.js';
import type { SessionRoutingService } from '../session/SessionRoutingService.js';
import type { ExecutionRegistry, ForegroundExecutionHandle } from './ExecutionRegistry.js';
import type { ExecutionHandle, ExecutionScope } from './contracts.js';

export interface ExecutionStatusView {
  sessionKey: string;
  foreground?: ForegroundExecutionHandle;
  background: BackgroundTaskHandle[];
  active: boolean;
}

export class ExecutionAbortService {
  constructor(
    private executionRegistry: Pick<ExecutionRegistry, 'getHandle' | 'abort' | 'listHandles'>,
    private backgroundTasks: Pick<BackgroundTaskManager, 'abortTask' | 'abortTaskByChannel' | 'getTasksBySessionHandle'>,
    private sessionRouting: Pick<SessionRoutingService, 'resolveByChannel'>
  ) {}

  abortBySessionKey(sessionKey: string): boolean {
    return this.executionRegistry.abort(sessionKey) || this.backgroundTasks.abortTask(sessionKey);
  }

  abortByChat(channel: string, chatId: string): boolean {
    const sessionKey = this.sessionRouting.resolveByChannel(channel, chatId);
    const abortedForeground = sessionKey ? this.executionRegistry.abort(sessionKey) : false;
    const abortedBackground = sessionKey
      ? this.backgroundTasks.abortTask(sessionKey)
      : this.backgroundTasks.abortTaskByChannel(channel, chatId);

    return abortedForeground || abortedBackground;
  }

  getStatus(sessionKey: string): ExecutionStatusView {
    const foreground = this.executionRegistry.getHandle(sessionKey);
    const background = this.backgroundTasks.getTasksBySessionHandle(sessionKey);

    return {
      sessionKey,
      foreground,
      background,
      active: !!foreground || background.length > 0
    };
  }

  listHandles(): ExecutionHandle[] {
    const foreground = this.executionRegistry.listHandles().map((handle) => this.mapForegroundHandle(handle));
    return foreground;
  }

  private mapForegroundHandle(handle: ForegroundExecutionHandle): ExecutionHandle {
    return {
      sessionKey: handle.sessionKey,
      scope: (handle.scope || 'session') as ExecutionScope,
      status: handle.status,
      channel: handle.channel,
      chatId: handle.chatId,
      startedAt: handle.startedAt || new Date(0)
    };
  }
}
