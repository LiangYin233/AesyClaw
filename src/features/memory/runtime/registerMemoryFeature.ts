import { registerMemoryController } from '../api/memory.controller.js';
import { MemoryService } from '../application/MemoryService.js';
import { MemoryRepository } from '../infrastructure/MemoryRepository.js';
import type { ApiFeatureControllerDeps } from '../../featureDeps.js';

export function registerMemoryFeature(deps: ApiFeatureControllerDeps): void {
  registerMemoryController(
    deps.app,
    new MemoryService(new MemoryRepository(deps.sessionManager, deps.longTermMemoryStore, deps.db))
  );
}
