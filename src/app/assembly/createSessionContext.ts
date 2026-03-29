import { Database } from '../../platform/db/index.js';
import { SessionManager } from '../../agent/infrastructure/session/SessionManager.js';
import { LongTermMemoryStore } from '../../features/memory/infrastructure/LongTermMemoryStore.js';
import { SessionRoutingService } from '../../features/sessions/infrastructure/SessionRoutingService.js';
import type { SessionContext } from '../../platform/context/index.js';
import type { Config } from '../../types.js';
import { join } from 'path';

export async function createSessionContext(config: Config): Promise<SessionContext & {
  sessionManager: SessionManager;
  longTermMemoryStore: LongTermMemoryStore;
}> {
  const dbPath = join(process.cwd(), '.aesyclaw', 'sessions', 'sessions.db');
  const db = new Database(dbPath);
  
  const sessionManager = new SessionManager(db);
  await sessionManager.loadAll();
  
  const longTermMemoryStore = new LongTermMemoryStore(db);
  
  const sessionRouting = new SessionRoutingService(sessionManager, config.agent.defaults.contextMode);
  
  return { db, sessionManager, longTermMemoryStore, sessionRouting };
}
