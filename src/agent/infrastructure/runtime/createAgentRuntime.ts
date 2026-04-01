import { RuntimeCoordinator, type RuntimeCoordinatorOptions } from './RuntimeCoordinator.js';

export { type RuntimeCoordinatorOptions };

export async function createConfiguredAgentRuntime(
  runtimeOptions: RuntimeCoordinatorOptions
): Promise<RuntimeCoordinator> {
  return new RuntimeCoordinator(runtimeOptions);
}
