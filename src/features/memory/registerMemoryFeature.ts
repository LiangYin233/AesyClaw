import { MemoryApiService } from './MemoryApiService.js';
import { MemoryRepository } from './MemoryRepository.js';
import { registerMemoryController } from './memory.controller.js';
import type { ApiFeatureControllerDeps } from '../featureDeps.js';

export function registerMemoryFeature(deps: ApiFeatureControllerDeps): void {
  registerMemoryController(
    deps.app,
    new MemoryApiService(new MemoryRepository(deps.sessionManager, deps.longTermMemoryStore, deps.db))
  );
}
