import { ChatApiService } from './ChatApiService.js';
import { ChatRepository } from './ChatRepository.js';
import { registerChatController } from './chat.controller.js';
import type { ApiFeatureControllerDeps } from '../featureDeps.js';

export function registerChatFeature(deps: ApiFeatureControllerDeps): void {
  registerChatController(
    deps.app,
    new ChatApiService(new ChatRepository(deps.agentRuntime), deps.maxMessageLength),
    deps.log
  );
}
