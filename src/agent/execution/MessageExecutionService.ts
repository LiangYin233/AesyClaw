import type { OutboundMessage } from '../../types.js';
import type { PluginManager } from '../../plugins/index.js';
import type { ExecutionFinalizeService } from './ExecutionFinalizeService.js';
import type { BackgroundTaskManager } from './BackgroundTaskManager.js';
import { ExecutionCoordinator } from './ExecutionCoordinator.js';
import { logger } from '../../logger/index.js';
import { metrics } from '../../logger/Metrics.js';
import type { ExecutionContext } from './contracts.js';
import type { ExecutionPolicyFactory } from './ExecutionPolicyFactory.js';

export class MessageExecutionService {
  private log = logger.child({ prefix: 'MessageExecutionService' });

  constructor(
    private policyFactory: ExecutionPolicyFactory,
    private backgroundTasks: BackgroundTaskManager,
    private completionService: ExecutionFinalizeService,
    private pluginManager?: PluginManager,
    private onSendOutbound?: (message: OutboundMessage) => Promise<void>
  ) {}

  setPluginManager(pluginManager?: PluginManager): void {
    this.pluginManager = pluginManager;
  }

  setCompletionService(completionService: ExecutionFinalizeService): void {
    this.completionService = completionService;
  }

  setSendOutbound(handler: (message: OutboundMessage) => Promise<void>): void {
    this.onSendOutbound = handler;
  }

  async execute(context: ExecutionContext): Promise<string | undefined> {
    const endTimer = metrics.timer('agent.process_message', {
      channel: context.channel,
      sessionKey: context.sessionKey
    });

    try {
      const policy = this.policyFactory.createPolicy(context.agentName);
      const executor = this.policyFactory.createExecutor(policy);
      executor.setCurrentContext(context.channel, context.chatId, context.messageType);
      const messages = executor.buildMessages(
        context.history,
        context.request.content,
        context.request.media,
        context.request.files
      );

      if (this.pluginManager) {
        await this.pluginManager.applyOnAgentBefore(context.request, messages);
      }

      const coordinator = new ExecutionCoordinator(executor, this.backgroundTasks, this.completionService);
      const executionResult = await coordinator.execute({
        sessionKey: context.sessionKey,
        request: context.request,
        messages,
        toolContext: context.toolContext,
        suppressOutbound: context.suppressOutbound,
        sendOutbound: (message) => this.sendOutbound(message)
      });

      if (executionResult.needsBackground) {
        this.log.info(`Session ${context.sessionKey} delegated to background, returning immediately`);
        metrics.record('agent.message_count', 1, 'count', { status: 'background' });
        return executionResult.content;
      }

      metrics.record('agent.message_count', 1, 'count', { status: 'success' });
      return executionResult.content;
    } catch (error) {
      metrics.record('agent.message_count', 1, 'count', { status: 'error' });
      this.log.error(`Failed to execute message for session ${context.sessionKey}:`, error);
      throw error;
    } finally {
      endTimer();
    }
  }

  async runSubAgentTask(
    agentName: string,
    task: string,
    toolContext: ExecutionContext['toolContext'],
    extra?: { signal?: AbortSignal }
  ): Promise<string> {
    const policy = this.policyFactory.createPolicy(agentName, {
      excludeTools: ['send_msg_to_user', 'call_agent']
    });
    const executor = this.policyFactory.createExecutor(policy);
    executor.setCurrentContext(toolContext.channel, toolContext.chatId, toolContext.messageType);
    const messages = executor.buildMessages([], task);
    const result = await executor.executeToolLoop(messages, {
      ...toolContext,
      signal: extra?.signal ?? toolContext.signal
    }, {
      allowTools: true,
      source: 'user',
      signal: extra?.signal ?? toolContext.signal
    });

    return result.content;
  }

  private async sendOutbound(message: OutboundMessage): Promise<void> {
    if (!this.onSendOutbound) {
      return;
    }
    await this.onSendOutbound(message);
  }
}
