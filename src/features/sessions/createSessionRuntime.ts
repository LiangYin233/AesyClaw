import { join } from 'path';
import { SessionRoutingService } from '../../agent/infrastructure/session/SessionRoutingService.js';
import { getSessionRuntimeConfig } from '../../config/index.js';
import { logger } from '../../observability/index.js';
import { LongTermMemoryStore, SessionManager } from '../../session/index.js';
import type { Config } from '../../types.js';
import { createMemoryRuntime } from '../memory/createMemoryRuntime.js';

const appLog = logger.child('AesyClaw');

export async function createSessionRuntime(config: Config): Promise<{
  sessionManager: SessionManager;
  longTermMemoryStore: LongTermMemoryStore;
  memoryService?: ReturnType<typeof createMemoryRuntime>;
  sessionRouting: SessionRoutingService;
}> {
  const sessionConfig = getSessionRuntimeConfig(config);
  const sessionManager = new SessionManager(
    join(process.cwd(), '.aesyclaw', 'sessions'),
    sessionConfig.maxSessions
  );
  await sessionManager.loadAll();
  appLog.info(`会话管理器已就绪，已加载 ${sessionManager.count()} 个会话`);

  const longTermMemoryStore = new LongTermMemoryStore(sessionManager.getDatabase());
  const memoryService = createMemoryRuntime(config, sessionManager, longTermMemoryStore);
  if (memoryService) {
    appLog.info('记忆服务已启用');
  }

  return {
    sessionManager,
    longTermMemoryStore,
    memoryService,
    sessionRouting: new SessionRoutingService(sessionManager, sessionConfig.contextMode)
  };
}
