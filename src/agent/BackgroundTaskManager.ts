import type { LLMMessage, OutboundMessage, LLMResponse } from '../types.js';
import type { ToolContext } from '../tools/ToolRegistry.js';
import type { EventBus } from '../bus/EventBus.js';
import { logger } from '../logger/index.js';

export interface BackgroundTaskCallbacks {
  onComplete?: (
    result: {
      content: string;
      reasoning_content?: string;
      toolsUsed: string[];
      agentMode: boolean;
    },
    messages: LLMMessage[]
  ) => Promise<void>;
  onError?: (error: Error) => Promise<void>;
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
  status: 'pending' | 'running' | 'completed' | 'aborted';
  createdAt: Date;
  abortController: AbortController;
  callbacks?: BackgroundTaskCallbacks;
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
  ): Promise<string> {
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

    return taskId;
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
          initialToolCalls
        }
      );

      // 调用完成回调（用于保存会话和执行插件钩子）
      if (task.callbacks?.onComplete) {
        await task.callbacks.onComplete(result, task.messages);
      } else {
        // 默认发送最终回复
        await this.sendFinalMessage(task, result);
      }
    } catch (error: any) {
      if (error.message === 'Execution aborted') {
        task.status = 'aborted';
        this.log.info(`Background task ${task.id} aborted`);
        // 调用错误回调
        if (task.callbacks?.onError) {
          await task.callbacks.onError(error);
        }
      } else {
        // 调用错误回调
        if (task.callbacks?.onError) {
          await task.callbacks.onError(error);
        } else {
          await this.sendErrorMessage(task, error);
        }
      }
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
   * 发送最终回复
   */
  private async sendFinalMessage(
    task: BackgroundTask,
    result: {
      content: string;
      reasoning_content?: string;
      toolsUsed: string[];
      agentMode: boolean;
    }
  ): Promise<void> {
    this.eventBus.publishOutbound({
      channel: task.channel,
      chatId: task.chatId,
      content: result.content,
      reasoning_content: result.reasoning_content,
      messageType: task.messageType
    });
  }

  /**
   * 发送错误消息
   */
  private async sendErrorMessage(task: BackgroundTask, error: any): Promise<void> {
    const errorMessage = error?.message || String(error) || '未知错误';
    this.eventBus.publishOutbound({
      channel: task.channel,
      chatId: task.chatId,
      content: `执行出错: ${errorMessage}`,
      messageType: task.messageType
    });
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
}
