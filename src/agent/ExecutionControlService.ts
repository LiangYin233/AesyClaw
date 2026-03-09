import type { SessionRoutingService } from './SessionRoutingService.js';
import type { ExecutionRegistry, ForegroundExecutionHandle } from './ExecutionRegistry.js';
import type { BackgroundTaskHandle, BackgroundTaskManager } from './BackgroundTaskManager.js';

export interface ExecutionStatus {
  sessionKey: string;
  foreground?: ForegroundExecutionHandle;
  background: BackgroundTaskHandle[];
  active: boolean;
}

export class ExecutionControlService {
  constructor(
    private sessionRouting: SessionRoutingService,
    private executionRegistry: ExecutionRegistry,
    private backgroundTasks: BackgroundTaskManager
  ) {}

  abortExecution(sessionKey: string): boolean {
    const abortedForeground = this.executionRegistry.abort(sessionKey);
    const abortedBackground = this.backgroundTasks.abortTask(sessionKey);
    return abortedForeground || abortedBackground;
  }

  abortSession(channel: string, chatId: string): boolean {
    const sessionKey = this.sessionRouting.resolveByChannel(channel, chatId);
    if (!sessionKey) {
      return false;
    }

    return this.abortExecution(sessionKey);
  }

  abortBackgroundSession(channel: string, chatId: string): boolean {
    const sessionKey = this.sessionRouting.resolveByChannel(channel, chatId);
    if (!sessionKey) {
      return false;
    }

    return this.backgroundTasks.abortTask(sessionKey);
  }

  getExecutionStatus(sessionKey: string): ExecutionStatus {
    const foreground = this.executionRegistry.getHandle(sessionKey);
    const background = this.backgroundTasks.getTasksBySessionHandle(sessionKey);

    return {
      sessionKey,
      foreground,
      background,
      active: !!foreground || background.length > 0
    };
  }
}
