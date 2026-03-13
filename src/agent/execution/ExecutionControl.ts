import type { OutboundMessage } from '../../types.js';
import type { SessionRoutingService } from '../session/SessionRoutingService.js';
import type { BackgroundTaskHandle } from './BackgroundTaskManager.js';
import { BackgroundTaskManager } from './BackgroundTaskManager.js';
import { ExecutionRegistry, type ForegroundExecutionHandle } from './ExecutionRegistry.js';

export interface ExecutionStatusView {
  sessionKey: string;
  foreground?: ForegroundExecutionHandle;
  background: BackgroundTaskHandle[];
  active: boolean;
}

export class ExecutionControl {
  readonly registry: ExecutionRegistry;
  readonly backgroundTasks: BackgroundTaskManager;

  constructor(
    private sessionRouting: SessionRoutingService,
    sendOutbound: (message: OutboundMessage) => Promise<void>
  ) {
    this.registry = new ExecutionRegistry();
    this.backgroundTasks = new BackgroundTaskManager(sendOutbound);
  }

  abortBySessionKey(sessionKey: string): boolean {
    return this.registry.abort(sessionKey) || this.backgroundTasks.abortTask(sessionKey);
  }

  abortByChat(channel: string, chatId: string): boolean {
    const sessionKey = this.sessionRouting.resolveByChannel(channel, chatId);
    const abortedForeground = sessionKey ? this.registry.abort(sessionKey) : false;
    const abortedBackground = sessionKey
      ? this.backgroundTasks.abortTask(sessionKey)
      : this.backgroundTasks.abortTaskByChannel(channel, chatId);

    return abortedForeground || abortedBackground;
  }

  getStatus(sessionKey: string): ExecutionStatusView {
    const foreground = this.registry.getHandle(sessionKey);
    const background = this.backgroundTasks.getTasksBySessionHandle(sessionKey);

    return {
      sessionKey,
      foreground,
      background,
      active: !!foreground || background.length > 0
    };
  }

  stop(): void {
    for (const handle of this.registry.listHandles()) {
      this.registry.abort(handle.sessionKey);
    }
    this.backgroundTasks.stop();
  }
}
