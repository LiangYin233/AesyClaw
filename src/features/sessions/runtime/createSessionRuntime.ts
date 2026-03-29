import type { SessionContext, SessionManager } from '../../../platform/context/index.js';
import { SessionRoutingService } from '../infrastructure/SessionRoutingService.js';
import type { Config } from '../../../types.js';
import { createMemoryRuntime } from '../../memory/index.js';

export async function createSessionRuntime(context: SessionContext, config: Config): Promise<{
  sessionRouting: SessionRoutingService;
  memoryService: ReturnType<typeof createMemoryRuntime>;
}> {
  const contextMode = config.agent.defaults.contextMode;

  const memoryService = createMemoryRuntime(config, context.sessionManager, context.longTermMemoryStore);

  return {
    sessionRouting: new SessionRoutingService(context.sessionManager as unknown as SessionManager, contextMode),
    memoryService
  };
}
