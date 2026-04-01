import type { MemoryContext, SessionManager, LongTermMemoryStore } from '../../platform/context/index.js';
import type { Config } from '../../types.js';
import { createMemoryRuntime } from '../../features/memory/runtime/createMemoryRuntime.js';

export function createMemoryContext(
  config: Config,
  sessionManager: SessionManager,
  longTermMemoryStore: LongTermMemoryStore
): MemoryContext {
  const memoryService = createMemoryRuntime(config, sessionManager, longTermMemoryStore);
  return { memoryService: memoryService as unknown as MemoryContext['memoryService'] };
}
