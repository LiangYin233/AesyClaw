import { join } from 'path';
import { SessionRoutingService } from '../../../agent/infrastructure/session/SessionRoutingService.js';
import { getSessionRuntimeConfig } from '../../../features/config/index.js';
import { Database } from '../../../platform/db/index.js';
import { logger } from '../../../platform/observability/index.js';
import { LongTermMemoryStore, SessionManager } from '../index.js';
import type { Config } from '../../../types.js';
import { createMemoryRuntime } from '../../memory/createMemoryRuntime.js';

const appLog = logger.child('AesyClaw');

export async function createSessionRuntime(config: Config): Promise<{
  db: Database;
  sessionManager: SessionManager;
  longTermMemoryStore: LongTermMemoryStore;
  memoryService?: ReturnType<typeof createMemoryRuntime>;
  sessionRouting: SessionRoutingService;
}> {
  const sessionConfig = getSessionRuntimeConfig(config);
  const dbPath = join(process.cwd(), '.aesyclaw', 'sessions', 'sessions.db');
  const db = new Database(dbPath);
  appLog.info(`SQLite 已初始化: ${dbPath}`);

  const sessionManager = new SessionManager(db, sessionConfig.maxSessions);
  await sessionManager.loadAll();
  appLog.info(`会话管理器已就绪，已加载 ${sessionManager.count()} 个会话`);

  const longTermMemoryStore = new LongTermMemoryStore(db);
  const memoryService = createMemoryRuntime(config, sessionManager, longTermMemoryStore);
  if (memoryService) {
    appLog.info('记忆服务已启用');
  }

  return {
    db,
    sessionManager,
    longTermMemoryStore,
    memoryService,
    sessionRouting: new SessionRoutingService(sessionManager, sessionConfig.contextMode)
  };
}
