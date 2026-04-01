import { Database } from '../../platform/db/index.js';
import { SessionManager } from '../../agent/index.js';
import { LongTermMemoryStore } from '../../features/memory/infrastructure/LongTermMemoryStore.js';
import { SessionRoutingService } from '../../features/sessions/infrastructure/SessionRoutingService.js';
import type { SessionContext } from '../../platform/context/index.js';
import type { Config } from '../../types.js';
import { filePaths } from '../../platform/utils/paths.js';

export async function createSessionContext(config: Config): Promise<SessionContext & {
  sessionManager: SessionManager;
  longTermMemoryStore: LongTermMemoryStore;
}> {
  const db = new Database(filePaths.sessionsDb());
  
  const sessionManager = new SessionManager(db);
  await sessionManager.loadAll();
  
  const longTermMemoryStore = new LongTermMemoryStore(db);
  
  const sessionRouting = new SessionRoutingService(sessionManager, config.agent.defaults.contextMode);
  
  return { db, sessionManager, longTermMemoryStore, sessionRouting };
}
