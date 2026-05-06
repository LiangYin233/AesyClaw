import type {
  InboundMessage,
  OutboundMessage,
  PipelineResult,
  SendFn,
  SessionKey,
  SenderInfo,
} from '@aesyclaw/core/types';
import type { PipelineDependencies, PipelineState } from './middleware/types';
import { HookDispatcher } from './hook-dispatcher';
import { sessionAgentResolver } from './middleware/agent-resolver';
import { commandDetector } from './middleware/command-detector';
import { agentProcessor } from './middleware/agent-processor';
import { createScopedLogger } from '@aesyclaw/core/logger';
import { requireInitialized } from '@aesyclaw/core/utils';

const logger = createScopedLogger('pipeline');

export class Pipeline {
  private deps: PipelineDependencies | null = null;
  hookDispatcher: HookDispatcher = new HookDispatcher();

  async initialize(deps: PipelineDependencies): Promise<void> {
    if (this.deps) {
      logger.warn('Pipeline 已初始化 — 跳过');
      return;
    }
    this.deps = deps;
    logger.info('Pipeline 已初始化');
  }

  destroy(): void {
    this.hookDispatcher.clearAll();
    this.deps = null;
    logger.info('Pipeline 已销毁');
  }

  async receiveWithSend(
    message: InboundMessage,
    sessionKey: SessionKey,
    sender: SenderInfo | undefined,
    send: SendFn,
  ): Promise<void> {
    const deps = requireInitialized(this.deps, 'Pipeline');

    try {
      const receiveResult = await this.hookDispatcher.dispatchOnReceive(
        message,
        sessionKey,
        sender,
      );
      if (await this.handleHookResult('onReceive', receiveResult, send, undefined)) {
        return;
      }

      let state: PipelineState = { stage: 'continue', inbound: message, sessionKey, sender };
      state = await sessionAgentResolver(state, {
        sessionManager: deps.sessionManager,
        roleManager: deps.roleManager,
        skillManager: deps.skillManager,
        databaseManager: deps.databaseManager,
        llmAdapter: deps.llmAdapter,
        toolRegistry: deps.toolRegistry,
        hookDispatcher: deps.hookDispatcher,
      });
      if (state.stage === 'continue') {
        const sessionKey = state.session?.key;
        state = {
          ...state,
          sendMessage: async (outbound: OutboundMessage): Promise<boolean> =>
            await this.dispatchOnSendAndDeliver(outbound, send, sessionKey),
        };
      }
      if (state.stage === 'respond') {
        await this.dispatchOnSendAndDeliver(state.outbound, send, state.session?.key);
        return;
      }

      state = await commandDetector(state, deps.commandRegistry);
      if (state.stage === 'respond') {
        await this.dispatchOnSendAndDeliver(state.outbound, send, state.session?.key);
        return;
      }
      if (state.stage === 'blocked') {
        logger.info('管道被阻止', { reason: state.reason });
        return;
      }

      if (state.session && state.agent && state.activeRole) {
        const beforeLLMResult = await this.hookDispatcher.dispatchBeforeLLMRequest({
          message: state.inbound,
          sessionKey: state.sessionKey,
          sender: state.sender,
          session: state.session,
          agent: state.agent,
          role: state.activeRole,
        });
        if (
          await this.handleHookResult('beforeLLMRequest', beforeLLMResult, send, state.session.key)
        ) {
          return;
        }
      }

      state = await agentProcessor(state);
      if (state.stage === 'respond') {
        await this.dispatchOnSendAndDeliver(state.outbound, send, state.session?.key);
        return;
      }
      if (state.stage === 'blocked') {
        logger.info('管道被阻止', { reason: state.reason });
      }
    } catch (err) {
      logger.error('管道处理错误', err);
      throw err;
    }
  }

  private async handleHookResult(
    hookName: string,
    result: PipelineResult,
    send: SendFn,
    sessionKey: SessionKey | undefined,
  ): Promise<boolean> {
    if (result.action === 'block') {
      logger.info(`${hookName} 钩子阻止流程`, { reason: result.reason });
      return true;
    }
    if (result.action === 'respond') {
      await this.dispatchOnSendAndDeliver({ components: result.components }, send, sessionKey);
      return true;
    }
    return false;
  }

  private async dispatchOnSendAndDeliver(
    outbound: OutboundMessage,
    send: SendFn,
    sessionKey?: SessionKey,
  ): Promise<boolean> {
    const sendResult = await this.hookDispatcher.dispatchOnSend({ message: outbound, sessionKey });
    if (sendResult.action === 'block') {
      logger.info('出站消息被 onSend 钩子阻止', { reason: sendResult.reason });
      return false;
    }

    const finalOutbound: OutboundMessage =
      sendResult.action === 'respond' ? { components: sendResult.components } : outbound;

    await send(finalOutbound);
    return true;
  }
}
