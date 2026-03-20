import { AgentRuntime } from '../facade/AgentRuntime.js';
import { createAgentServices, type RuntimeDelegate } from './createAgentServices.js';

export interface CreateAgentRuntimeInput {
  delegate: RuntimeDelegate;
}

export function createAgentRuntime(input: CreateAgentRuntimeInput): AgentRuntime {
  const services = createAgentServices(input.delegate);
  const runtime = new AgentRuntime(services.facadeDeps);

  runtime.start = services.delegate.start.bind(services.delegate);
  runtime.stop = services.delegate.stop.bind(services.delegate);
  runtime.isRunning = services.delegate.isRunning.bind(services.delegate);

  return runtime;
}

export async function createConfiguredAgentRuntime(
  runtimeOptions: unknown
): Promise<AgentRuntime> {
  const runtimeModule = await import('../infrastructure/runtime/RuntimeCoordinator.js');
  const delegate = new runtimeModule.RuntimeCoordinator(
    runtimeOptions as ConstructorParameters<typeof runtimeModule.RuntimeCoordinator>[0]
  );

  return createAgentRuntime({ delegate });
}
