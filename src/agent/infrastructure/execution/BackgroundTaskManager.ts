import type { LLMMessage, LLMResponse, OutboundMessage } from '../../../types.js';
import type { ToolContext } from '../../../platform/tools/ToolRegistry.js';
import { logger } from '../../../platform/observability/index.js';
import type { EventBus } from '../../../platform/events/EventBus.js';
import type { AesyClawEvents } from '../../../platform/events/events.js';

export interface BackgroundTaskResult {
  content: string;
  reasoning_content?: string;
  toolsUsed: string[];
  agentMode: boolean;
}

export interface BackgroundTaskCallbacks {
  onComplete?: (
    result: BackgroundTaskResult,
    messages: LLMMessage[]
  ) => Promise<void>;
  onError?: (error: Error) => Promise<void>;
}

export interface BackgroundTaskHandle {
  id: string;
  sessionKey: string;
  status: 'pending' | 'running' | 'completed' | 'aborted' | 'failed';
  createdAt: Date;
}

interface BackgroundTask {
  id: string;
  sessionKey: string;
  channel: string;
  chatId: string;
  messageType?: 'private' | 'group';
  messages: LLMMessage[];
  toolContext: ToolContext;
  initialResponse: LLMResponse;
  status: 'pending' | 'running' | 'completed' | 'aborted' | 'failed';
  createdAt: Date;
  abortController: AbortController;
  callbacks?: BackgroundTaskCallbacks;
  result?: BackgroundTaskResult;
  error?: Error;
}

export interface BackgroundTaskExecutor {
  executeToolLoop(
    messages: LLMMessage[],
    toolContext: ToolContext,
    options?: {
      sessionKey?: string;
      allowTools?: boolean;
      source?: 'user' | 'cron';
      initialToolCalls?: any[];
      signal?: AbortSignal;
    }
  ): Promise<{
    content: string;
    reasoning_content?: string;
    toolsUsed: string[];
    agentMode: boolean;
  }>;
  abort(sessionKey: string): void;
}

/**
 * 后台任务管理器
 * 管理所有后台任务的执行、状态追踪和中止
 */
export class BackgroundTaskManager {
  private tasks: Map<string, BackgroundTask> = new Map();
  private maxConcurrentPerSession: number = 5;
  private log = logger.child('BackgroundTask');

  constructor(
    private sendOutbound: (message: OutboundMessage) => Promise<void>,
    private eventBus?: EventBus<AesyClawEvents>
  ) {
  }

  /**
   * 生成唯一任务 ID
   */
  private generateTaskId(): string {
    return `task_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
  }

  /**
   * 启动后台任务
   */
  async startTask(
    executor: BackgroundTaskExecutor,
    sessionKey: string,
    channel: string,
    chatId: string,
    messageType: 'private' | 'group' | undefined,
    messages: LLMMessage[],
    toolContext: ToolContext,
    initialResponse: LLMResponse,
    callbacks?: BackgroundTaskCallbacks
  ): Promise<BackgroundTaskHandle> {
    const sessionTasks = this.getTasksBySession(sessionKey);
    if (sessionTasks.length >= this.maxConcurrentPerSession) {
      this.log.withFields({ sessionKey, channel, chatId }).warn('后台任务因会话繁忙被拒绝', {
        runningTasks: sessionTasks.length,
        limit: this.maxConcurrentPerSession
      });
      await this.sendBusyMessage(channel, chatId, messageType);
      throw new Error(`Session ${sessionKey} has too many concurrent tasks`);
    }

    const taskId = this.generateTaskId();
    const abortController = new AbortController();

    const task: BackgroundTask = {
      id: taskId,
      sessionKey,
      channel,
      chatId,
      messageType,
      messages,
      toolContext,
      initialResponse,
      status: 'running',
      createdAt: new Date(),
      abortController,
      callbacks
    };

    this.tasks.set(taskId, task);
    this.createTaskLogger(task).info('后台任务开始执行', {
      messageCount: messages.length
    });

    // 后台执行完整的工具循环
    this.executeTask(executor, task).catch((_err) => {
    });

    return this.toHandle(task);
  }

  /**
   * 执行后台任务
   */
  private async executeTask(
    executor: BackgroundTaskExecutor,
    task: BackgroundTask
  ): Promise<void> {
    const taskLog = this.createTaskLogger(task);
    try {
      // 提取第一次 toolCalls
      const initialToolCalls = task.initialResponse.toolCalls;

      // 执行完整的工具循环（从第一次 toolCalls 开始）
      const result = await executor.executeToolLoop(
        task.messages,
        task.toolContext,
        {
          sessionKey: task.sessionKey,
          allowTools: true,
          source: 'user',
          initialToolCalls,
          signal: task.abortController.signal
        }
      );

      task.result = result;
      task.status = 'completed';
      taskLog.info('后台任务执行完成', {
        toolCount: result.toolsUsed.length,
        agentMode: result.agentMode
      });
      await this.eventBus?.emit('background_task.completed', {
        sessionKey: task.sessionKey,
        taskId: task.id,
        channel: task.channel,
        chatId: task.chatId
      });

      // 调用完成回调
      await task.callbacks?.onComplete?.(result, task.messages);
    } catch (error: any) {
      const normalizedError = error instanceof Error ? error : new Error(String(error));
      task.error = normalizedError;
      if (normalizedError.message === 'Execution aborted' || normalizedError.name === 'AbortError') {
        task.status = 'aborted';
        taskLog.warn('后台任务已中止', {
          error: normalizedError
        });
      } else {
        task.status = 'failed';
        taskLog.error('后台任务执行失败', {
          error: normalizedError
        });
        await this.eventBus?.emit('background_task.failed', {
          sessionKey: task.sessionKey,
          taskId: task.id,
          error: normalizedError
        });
      }
      // 调用错误回调
      await task.callbacks?.onError?.(normalizedError);
    } finally {
      this.tasks.delete(task.id);
    }
  }

  /**
   * 中止指定会话的所有后台任务
   */
  abortTask(sessionKey: string): boolean {
    const tasks = this.getTasksBySession(sessionKey);
    for (const task of tasks) {
      this.createTaskLogger(task).warn('收到后台任务中止请求');
      task.abortController.abort();
      task.status = 'aborted';
    }
    return tasks.length > 0;
  }

  /**
   * 根据 channel 和 chatId 中止任务
   */
  abortTaskByChannel(channel: string, chatId: string): boolean {
    const tasks = this.getTasksByChannel(channel, chatId);
    for (const task of tasks) {
      this.createTaskLogger(task).warn('收到后台任务中止请求');
      task.abortController.abort();
      task.status = 'aborted';
    }
    return tasks.length > 0;
  }

  /**
   * 获取指定会话的任务
   */
  private getTasksBySession(sessionKey: string): BackgroundTask[] {
    return Array.from(this.tasks.values()).filter(t => t.sessionKey === sessionKey);
  }

  /**
   * 获取指定 channel:chatId 的任务
   */
  private getTasksByChannel(channel: string, chatId: string): BackgroundTask[] {
    return Array.from(this.tasks.values()).filter(t => t.channel === channel && t.chatId === chatId);
  }

  /**
   * 发送忙碌消息
   */
  private async sendBusyMessage(
    channel: string,
    chatId: string,
    messageType?: 'private' | 'group'
  ): Promise<void> {
    await this.sendOutbound({
      channel,
      chatId,
      content: '当前会话任务过多，请稍后再试',
      messageType
    });
  }

  stop(): void {
    for (const task of this.tasks.values()) {
      task.abortController.abort();
      task.status = 'aborted';
    }
    this.tasks.clear();
  }

  /**
   * 获取指定会话的任务句柄
   */
  getTasksBySessionHandle(sessionKey: string): BackgroundTaskHandle[] {
    return this.getTasksBySession(sessionKey).map(task => this.toHandle(task));
  }

  /**
   * 获取后台任务句柄
   */
  getTask(taskId: string): BackgroundTaskHandle | undefined {
    const task = this.tasks.get(taskId);
    return task ? this.toHandle(task) : undefined;
  }

  /**
   * 获取当前任务数量
   */
  getTaskCount(): number {
    return this.tasks.size;
  }

  /**
   * 获取指定会话的任务数量
   */
  getTaskCountBySession(sessionKey: string): number {
    return this.getTasksBySession(sessionKey).length;
  }

  private createTaskLogger(task: Pick<BackgroundTask, 'id' | 'sessionKey' | 'channel' | 'chatId'>) {
    return this.log.withFields({
      ssn: task.sessionKey,
      ch: task.channel,
      chId: task.chatId,
      tskId: task.id
    });
  }

  private toHandle(task: BackgroundTask): BackgroundTaskHandle {
    return {
      id: task.id,
      sessionKey: task.sessionKey,
      status: task.status,
      createdAt: task.createdAt
    };
  }
}
