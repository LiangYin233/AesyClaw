import type { Express } from 'express';
import type { AgentRuntime } from '../../../agent/index.js';
import { ChatService } from '../application/ChatService.js';
import { registerChatController } from '../api/chat.controller.js';

export interface ChatFeatureDeps {
  app: Express;
  maxMessageLength: number;
  agentRuntime: Pick<AgentRuntime, 'handleDirect'>;
  log: {
    info(message: string, ...args: any[]): void;
  };
}

export function registerChatFeature(deps: ChatFeatureDeps): void {
  registerChatController(
    deps.app,
    new ChatService(deps.agentRuntime, deps.maxMessageLength),
    deps.log
  );
}
