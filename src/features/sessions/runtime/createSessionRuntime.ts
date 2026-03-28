import { join } from 'path';
import { SessionRoutingService } from '../infrastructure/SessionRoutingService.js';
import { getSessionRuntimeConfig } from '../../../features/config/index.js';
import { Database } from '../../../platform/db/index.js';
import { LongTermMemoryStore, SessionManager } from '../index.js';
import type { Config } from '../../../types.js';
import { createMemoryRuntime } from '../../memory/index.js';

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

  const sessionManager = new SessionManager(db);
  await sessionManager.loadAll();

  const longTermMemoryStore = new LongTermMemoryStore(db);
  const memoryService = createMemoryRuntime(config, sessionManager, longTermMemoryStore);
  if (memoryService) {
  }

  return {
    db,
    sessionManager,
    longTermMemoryStore,
    memoryService,
    sessionRouting: new SessionRoutingService(sessionManager, sessionConfig.contextMode)
  };
}
