# Agent Module Rearchitecture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current `src/agent` module with a cleaner implementation built in `src/agent-next`, migrate all callers to it, then delete the old module and rename the new folder to `src/agent`.

**Architecture:** Build a thin runtime facade over explicit application use cases and focused infrastructure services. Keep composition in a dedicated assembly layer so bootstrap and API depend on a narrow public surface instead of agent internals.

**Tech Stack:** TypeScript, Node.js built-in test runner, `tsx`, existing provider/session/tool/plugin infrastructure

---

### Task 1: Establish the Test Harness and New Module Skeleton

**Files:**
- Modify: `package.json`
- Create: `tests/agent-next/facade/AgentRuntime.test.ts`
- Create: `tests/agent-next/session/SessionHandle.test.ts`
- Create: `tests/agent-next/support/fakes.ts`
- Create: `src/agent-next/index.ts`
- Create: `src/agent-next/facade/index.ts`
- Create: `src/agent-next/facade/AgentRuntime.ts`
- Create: `src/agent-next/facade/SessionHandle.ts`
- Create: `src/agent-next/facade/OutboundGateway.ts`
- Create: `src/agent-next/domain/runtime.ts`
- Create: `src/agent-next/domain/session.ts`
- Create: `src/agent-next/domain/execution.ts`
- Create: `src/agent-next/domain/messages.ts`
- Create: `src/agent-next/domain/ports.ts`
- Create: `src/agent-next/domain/errors.ts`

- [ ] **Step 1: Write the failing facade tests**

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { AgentRuntime, SessionHandle } from '../../../src/agent-next/index.js';
import { buildRuntimeDeps } from '../support/fakes.js';

test('AgentRuntime delegates direct handling to the configured use case', async () => {
  const deps = buildRuntimeDeps();
  const runtime = new AgentRuntime(deps);

  const result = await runtime.handleDirect('hello', {
    sessionKey: 'webui:test',
    channel: 'webui',
    chatId: 'webui:test',
    messageType: 'private'
  });

  assert.equal(result, 'direct:hello');
  assert.equal(deps.calls.handleDirect, 1);
});

test('SessionHandle binds its reference before delegating inbound handling', async () => {
  const deps = buildRuntimeDeps();
  const runtime = new AgentRuntime(deps);
  const handle = new SessionHandle(runtime, 'session-1');

  await handle.handleMessage({
    sessionKey: '',
    channel: 'webui',
    chatId: 'chat-1',
    senderId: 'user-1',
    messageType: 'private',
    content: 'ping',
    timestamp: Date.now()
  });

  assert.equal(deps.calls.handleInbound, 1);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --import tsx --test tests/agent-next/facade/AgentRuntime.test.ts tests/agent-next/session/SessionHandle.test.ts`
Expected: FAIL with module-not-found or missing-export errors for `src/agent-next/*`

- [ ] **Step 3: Add the test script and minimal facade/domain scaffolding**

```json
{
  "scripts": {
    "test": "node --import tsx --test"
  }
}
```

```ts
// src/agent-next/facade/AgentRuntime.ts
export class AgentRuntime {
  constructor(private readonly deps: AgentRuntimeDeps) {}

  async handleDirect(content: string, reference: SessionReference): Promise<string> {
    return this.deps.handleDirect(content, reference);
  }
}
```

- [ ] **Step 4: Run the new tests to verify they pass**

Run: `npm test -- tests/agent-next/facade/AgentRuntime.test.ts tests/agent-next/session/SessionHandle.test.ts`
Expected: PASS with 2 passing tests

- [ ] **Step 5: Commit**

```bash
git add package.json tests/agent-next src/agent-next
git commit -m "test: scaffold agent-next facade and test harness"
```

### Task 2: Build Application Use Cases and Stable Contracts

**Files:**
- Create: `src/agent-next/application/inbound/handleInboundMessage.ts`
- Create: `src/agent-next/application/inbound/handleDirectMessage.ts`
- Create: `src/agent-next/application/turn/runAgentTurn.ts`
- Create: `src/agent-next/application/turn/runSubAgentTasks.ts`
- Create: `src/agent-next/application/session/assignSessionAgent.ts`
- Create: `src/agent-next/application/runtime/reloadRuntimeConfig.ts`
- Create: `tests/agent-next/application/handleInboundMessage.test.ts`
- Create: `tests/agent-next/application/handleDirectMessage.test.ts`
- Create: `tests/agent-next/application/runSubAgentTasks.test.ts`
- Create: `tests/agent-next/application/assignSessionAgent.test.ts`

- [ ] **Step 1: Write failing tests for the application flows**

```ts
test('handleInboundMessage returns handled when preprocessing fully consumes the message', async () => {
  const result = await handleInboundMessage(deps, input);
  assert.deepEqual(result, { status: 'handled' });
});

test('handleDirectMessage binds the provided reference before calling inbound flow', async () => {
  const result = await handleDirectMessage(deps, {
    content: 'hello',
    reference: 'session-1',
    toolContextBase: { workspace: '/tmp/workspace' }
  });

  assert.equal(result, 'reply');
});

test('runSubAgentTasks preserves per-task success and error results', async () => {
  const result = await runSubAgentTasks(deps, input);
  assert.equal(result[1]?.success, false);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- tests/agent-next/application/*.test.ts`
Expected: FAIL with missing use case modules

- [ ] **Step 3: Implement the minimal use-case modules**

```ts
export async function handleInboundMessage(
  deps: HandleInboundMessageDeps,
  input: HandleInboundMessageInput
): Promise<HandleInboundMessageResult> {
  deps.logInbound(input.message);
  const preprocessed = await deps.processInbound({
    message: input.message,
    suppressOutbound: input.suppressOutbound
  });

  if (preprocessed.type === 'handled') return { status: 'handled' };
  if (preprocessed.type === 'reply') return { status: 'replied', content: preprocessed.content };

  const context = await deps.resolveTurnContext({
    message: preprocessed.message,
    suppressOutbound: input.suppressOutbound,
    toolContextBase: input.toolContextBase
  });

  return {
    status: 'executed',
    content: await deps.runTurn(context)
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- tests/agent-next/application/*.test.ts`
Expected: PASS with all application tests green

- [ ] **Step 5: Commit**

```bash
git add src/agent-next/application tests/agent-next/application src/agent-next/domain
git commit -m "feat: add agent-next application use cases"
```

### Task 3: Implement Session and Execution Infrastructure

**Files:**
- Create: `src/agent-next/infrastructure/session/SessionResolver.ts`
- Create: `src/agent-next/infrastructure/session/SessionRouter.ts`
- Create: `src/agent-next/infrastructure/execution/ExecutionRegistry.ts`
- Create: `src/agent-next/infrastructure/execution/TurnExecutor.ts`
- Create: `src/agent-next/infrastructure/execution/ToolCallLoop.ts`
- Create: `src/agent-next/infrastructure/execution/BackgroundTaskCoordinator.ts`
- Create: `src/agent-next/infrastructure/pipeline/InboundPipeline.ts`
- Create: `src/agent-next/infrastructure/memory/SessionMemoryRuntime.ts`
- Create: `src/agent-next/infrastructure/memory/LongTermMemoryRuntime.ts`
- Create: `src/agent-next/infrastructure/roles/AgentRoleRuntime.ts`
- Create: `tests/agent-next/infrastructure/ExecutionRegistry.test.ts`
- Create: `tests/agent-next/infrastructure/SessionResolver.test.ts`
- Create: `tests/agent-next/infrastructure/TurnExecutor.test.ts`

- [ ] **Step 1: Write failing tests around registry, resolution, and turn execution**

```ts
test('ExecutionRegistry tracks and aborts a running session', () => {
  const registry = new ExecutionRegistry();
  registry.start('session-1', controller.signal);

  assert.equal(registry.getStatus('session-1')?.active, true);
  assert.equal(registry.abortBySessionKey('session-1'), true);
});

test('SessionResolver builds tool context from inbound message metadata', async () => {
  const context = await resolver.resolve(message, options);
  assert.equal(context.toolContext.chatId, 'chat-1');
});

test('TurnExecutor delegates iterative tool work through ToolCallLoop', async () => {
  const result = await executor.execute(context);
  assert.equal(result, 'assistant reply');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- tests/agent-next/infrastructure/*.test.ts`
Expected: FAIL with missing classes

- [ ] **Step 3: Implement the minimal infrastructure services**

```ts
export class ExecutionRegistry {
  private readonly active = new Map<string, ExecutionStatus>();

  start(sessionKey: string, signal: AbortSignal): void {
    this.active.set(sessionKey, { active: true, signal });
  }

  abortBySessionKey(sessionKey: string): boolean {
    const status = this.active.get(sessionKey);
    if (!status) return false;
    status.controller?.abort();
    return true;
  }
}
```

```ts
export class TurnExecutor {
  constructor(private readonly deps: TurnExecutorDeps) {}

  async execute(context: AgentTurnContext): Promise<string | undefined> {
    return this.deps.toolCallLoop.run(context);
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- tests/agent-next/infrastructure/*.test.ts`
Expected: PASS with all infrastructure tests green

- [ ] **Step 5: Commit**

```bash
git add src/agent-next/infrastructure tests/agent-next/infrastructure
git commit -m "feat: add agent-next execution and session infrastructure"
```

### Task 4: Assemble the New Runtime and Compatibility Facade

**Files:**
- Create: `src/agent-next/assembly/createAgentRuntime.ts`
- Create: `src/agent-next/assembly/createAgentServices.ts`
- Modify: `src/agent-next/facade/AgentRuntime.ts`
- Modify: `src/agent-next/facade/SessionHandle.ts`
- Modify: `src/agent-next/facade/index.ts`
- Modify: `src/agent-next/index.ts`
- Create: `tests/agent-next/assembly/createAgentRuntime.test.ts`
- Modify: `tests/agent-next/support/fakes.ts`

- [ ] **Step 1: Write failing tests for assembled runtime behavior**

```ts
test('createAgentRuntime wires the facade to inbound, direct, status, and abort use cases', async () => {
  const runtime = createAgentRuntime(buildAssemblyDeps());

  await runtime.handleDirect('ping', {
    sessionKey: 'webui:test',
    channel: 'webui',
    chatId: 'webui:test',
    messageType: 'private'
  });

  assert.equal(runtime.isRunning(), false);
  runtime.start();
  assert.equal(runtime.isRunning(), true);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- tests/agent-next/assembly/createAgentRuntime.test.ts`
Expected: FAIL with missing assembly exports

- [ ] **Step 3: Implement runtime assembly and compatibility-facing methods**

```ts
export function createAgentRuntime(deps: CreateAgentRuntimeDeps): AgentRuntime {
  const services = createAgentServices(deps);
  return new AgentRuntime({
    ...services.facadeDeps,
    abortByReference: services.abortByReference,
    getStatusByReference: services.getStatusByReference
  });
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- tests/agent-next/assembly/createAgentRuntime.test.ts tests/agent-next/facade/AgentRuntime.test.ts tests/agent-next/session/SessionHandle.test.ts`
Expected: PASS with all facade and assembly tests green

- [ ] **Step 5: Commit**

```bash
git add src/agent-next/assembly src/agent-next/facade src/agent-next/index.ts tests/agent-next
git commit -m "feat: assemble agent-next runtime facade"
```

### Task 5: Migrate Bootstrap, API, and Cron to the New Runtime

**Files:**
- Modify: `src/bootstrap/factory/ServiceFactory.ts`
- Modify: `src/bootstrap/app/cronDispatch.ts`
- Modify: `src/api/routes/core.ts`
- Modify: `src/api/server.ts`
- Modify: `src/index.ts`
- Modify: any remaining files returned by `rg -n "agent/runtime|agent/session|agent/usecases|agent/roles" src`
- Create: `tests/bootstrap/ServiceFactory.agent-runtime.test.ts`
- Create: `tests/api/core-routes.agent-runtime.test.ts`

- [ ] **Step 1: Write failing integration-focused tests for the switched callers**

```ts
test('ServiceFactory creates the runtime through the agent-next assembly entrypoint', async () => {
  const services = await createServices(options);
  assert.ok(services.agentRuntime);
});

test('core chat route only depends on the facade direct-message contract', async () => {
  const response = await createChatResponse({
    message: 'hello',
    channel: 'webui'
  });

  assert.equal(response.success, true);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- tests/bootstrap/ServiceFactory.agent-runtime.test.ts tests/api/core-routes.agent-runtime.test.ts`
Expected: FAIL because callers still import old runtime internals

- [ ] **Step 3: Switch the callers to the new assembly and facade**

```ts
import { createAgentRuntime } from '../../agent-next/index.js';

const runtimeBundle = await createAgentRuntime({
  provider,
  toolRegistry,
  sessionManager,
  sessionRouting,
  memoryService,
  outboundGateway,
  workspace
});
```

- [ ] **Step 4: Run the targeted migration tests and build**

Run: `npm test -- tests/bootstrap/ServiceFactory.agent-runtime.test.ts tests/api/core-routes.agent-runtime.test.ts`
Expected: PASS with both integration tests green

Run: `npm run build`
Expected: PASS with TypeScript compilation succeeding for app and plugins

- [ ] **Step 5: Commit**

```bash
git add src/bootstrap src/api src/index.ts tests/bootstrap tests/api
git commit -m "refactor: switch runtime consumers to agent-next"
```

### Task 6: Delete the Old Module and Rename `agent-next` to `agent`

**Files:**
- Delete: `src/agent/**`
- Move: `src/agent-next/**` -> `src/agent/**`
- Modify: all imports referencing `src/agent-next`
- Modify: `src/index.ts`
- Modify: any file returned by `rg -n "agent-next" src tests`

- [ ] **Step 1: Write a failing smoke test that imports only the final public surface**

```ts
test('top-level agent exports resolve from src/agent after the rename', async () => {
  const mod = await import('../../src/agent/index.js');
  assert.ok(mod.AgentRuntime);
});
```

- [ ] **Step 2: Run the smoke test to verify it fails before the rename**

Run: `npm test -- tests/agent-public-surface.test.ts`
Expected: FAIL because the new implementation still lives under `src/agent-next`

- [ ] **Step 3: Remove old code, rename the directory, and rewrite imports**

```bash
rm -rf src/agent
mv src/agent-next src/agent
rg -l "agent-next" src tests | xargs sed -i 's/agent-next/agent/g'
```

- [ ] **Step 4: Run the smoke test and full build to verify the rename**

Run: `npm test -- tests/agent-public-surface.test.ts`
Expected: PASS with the final public surface resolved from `src/agent`

Run: `npm run build`
Expected: PASS with no `agent-next` import paths remaining

- [ ] **Step 5: Commit**

```bash
git add src tests
git commit -m "refactor: replace legacy agent module"
```

### Task 7: Final Verification and Cleanup

**Files:**
- Modify: any files required to resolve final lint/type/test issues
- Verify: `docs/superpowers/specs/2026-03-20-agent-rearchitecture-design.md`
- Verify: `docs/superpowers/plans/2026-03-20-agent-rearchitecture.md`

- [ ] **Step 1: Run the full verification suite**

Run: `npm test`
Expected: PASS with all added runtime, application, infrastructure, bootstrap, and API tests green

Run: `npm run build`
Expected: PASS with clean TypeScript output

Run: `npm run lint`
Expected: PASS with no ESLint errors in `src/**/*.ts` and `plugins/**/*.ts`

- [ ] **Step 2: Confirm the old module is gone and imports are clean**

Run: `find src/agent -maxdepth 3 -type f | sort`
Expected: PASS showing only the new structure

Run: `rg -n "agent-next|runtime/AgentRuntime|execution/ExecutionRuntime|usecases/runAgentTurn" src tests`
Expected: no matches for removed transitional paths

- [ ] **Step 3: Review the resulting public surface**

```ts
export { AgentRuntime, SessionHandle } from './agent/index.js';
```

Verify that:
- bootstrap no longer assembles deep agent internals
- API depends on narrow facade behavior
- cron dispatch uses the facade contract
- large runtime responsibilities are split across focused files

- [ ] **Step 4: Commit any final cleanup**

```bash
git add src tests docs
git commit -m "chore: finalize agent rearchitecture cleanup"
```
