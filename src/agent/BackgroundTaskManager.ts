import type { LLMMessage, LLMResponse } from '../types.js';
import type { ToolContext } from '../tools/ToolRegistry.js';
import type { EventBus } from '../bus/EventBus.js';
import { logger } from '../logger/index.js';

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
  private eventBus: EventBus;
  private maxConcurrentPerSession: number = 5;
  private log = logger.child({ prefix: 'BackgroundTask' });

  constructor(eventBus: EventBus) {
    this.eventBus = eventBus;
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
    this.log.info(`Started background task ${taskId} for session ${sessionKey}`);

    // 后台执行完整的工具循环
    this.executeTask(executor, task).catch(err => {
      this.log.error(`Background task ${taskId} failed:`, err);
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

      // 调用完成回调
      await task.callbacks?.onComplete?.(result, task.messages);
    } catch (error: any) {
      const normalizedError = error instanceof Error ? error : new Error(String(error));
      task.error = normalizedError;
      if (normalizedError.message === 'Execution aborted' || normalizedError.name === 'AbortError') {
        task.status = 'aborted';
        this.log.info(`Background task ${task.id} aborted`);
      } else {
        task.status = 'failed';
      }
      // 调用错误回调
      await task.callbacks?.onError?.(normalizedError);
    } finally {
      this.tasks.delete(task.id);
      this.log.info(`Background task ${task.id} completed, remaining tasks: ${this.tasks.size}`);
    }
  }

  /**
   * 中止指定会话的所有后台任务
   */
  abortTask(sessionKey: string): boolean {
    const tasks = this.getTasksBySession(sessionKey);
    for (const task of tasks) {
      task.abortController.abort();
      task.status = 'aborted';
      this.log.info(`Aborted background task ${task.id} for session ${sessionKey}`);
    }
    return tasks.length > 0;
  }

  /**
   * 根据 channel 和 chatId 中止任务
   */
  abortTaskByChannel(channel: string, chatId: string): boolean {
    const tasks = this.getTasksByChannel(channel, chatId);
    for (const task of tasks) {
      task.abortController.abort();
      task.status = 'aborted';
      this.log.info(`Aborted background task ${task.id} for channel ${channel}:${chatId}`);
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
    this.eventBus.publishOutbound({
      channel,
      chatId,
      content: '当前会话任务过多，请稍后再试',
      messageType
    });
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

  private toHandle(task: BackgroundTask): BackgroundTaskHandle {
    return {
      id: task.id,
      sessionKey: task.sessionKey,
      status: task.status,
      createdAt: task.createdAt
    };
  }
}
