# Agent Module Rearchitecture Design

## Context

The current `src/agent` module has grown into a mixed-responsibility area that is difficult to read and change safely.

Key symptoms in the current codebase:

- `src/agent/runtime/AgentRuntime.ts` is a large facade that also performs dependency assembly, runtime orchestration, logging, session binding, sub-agent dispatch, and state mutation.
- `src/bootstrap/factory/ServiceFactory.ts` contains substantial agent-specific assembly logic, so bootstrap code understands too much about internal agent implementation.
- Execution, runtime, session routing, memory, and API-facing behavior are spread across multiple layers with inconsistent boundaries.
- External callers often depend on deep internal paths such as runtime, session, and role submodules instead of a narrow public surface.

The requested change is a full rewrite of the current agent module by first implementing a new version in a separate folder, then removing the old implementation and renaming the new folder to `agent`.

## Goals

- Replace the current agent internals with a clearer architecture.
- Maximize readability and maintainability over clever abstraction.
- Keep the public runtime behavior functionally compatible where it matters.
- Allow bootstrap, API, and cron integration points to change if that produces cleaner boundaries.
- Perform the migration in a controlled way: new implementation first, switch callers second, delete old code last.

## Non-Goals

- No unrelated refactors outside the agent integration path.
- No permanent dual-runtime architecture.
- No broad rewrite of channels, providers, plugins, or tools unless required by the new agent boundary.

## Design Principles

- One file should have one obvious reason to change.
- Use explicit names that reflect behavior and responsibility.
- Keep facades thin and orchestration logic visible.
- Hide infrastructure details behind focused ports and adapters.
- Prefer composition in a dedicated assembly layer over large constructor-heavy classes.
- Keep import direction predictable so readers can infer architecture from paths.

## Proposed Architecture

The new implementation will be built in `src/agent-next` first and later renamed to `src/agent`.

### Directory Layout

```text
src/agent-next/
  facade/
    AgentRuntime.ts
    SessionHandle.ts
    OutboundGateway.ts
    index.ts
  application/
    inbound/
      handleInboundMessage.ts
      handleDirectMessage.ts
    turn/
      runAgentTurn.ts
      runSubAgentTasks.ts
    session/
      assignSessionAgent.ts
    runtime/
      reloadRuntimeConfig.ts
  domain/
    execution.ts
    messages.ts
    ports.ts
    runtime.ts
    session.ts
    errors.ts
  infrastructure/
    execution/
      TurnExecutor.ts
      ToolCallLoop.ts
      BackgroundTaskCoordinator.ts
      ExecutionRegistry.ts
    pipeline/
      InboundPipeline.ts
    memory/
      SessionMemoryRuntime.ts
      LongTermMemoryRuntime.ts
    roles/
      AgentRoleRuntime.ts
    session/
      SessionResolver.ts
      SessionRouter.ts
  assembly/
    createAgentRuntime.ts
    createAgentServices.ts
  index.ts
```

### Layer Responsibilities

#### `facade`

This is the only layer that bootstrap, API, cron dispatch, and top-level exports should use directly.

Responsibilities:

- expose the runtime entrypoints
- expose a session-scoped handle
- expose outbound dispatch configuration
- provide status and lifecycle methods

Non-responsibilities:

- constructing deep execution dependencies inline
- embedding tool loop details
- knowing storage/provider/plugin internals

#### `application`

This layer holds the use cases. Each file should describe a readable business flow.

Responsibilities:

- inbound message flow
- direct message flow
- turn execution flow
- sub-agent task execution flow
- session agent assignment
- runtime config reload

Non-responsibilities:

- direct provider API integration
- plugin dispatch details
- persistence implementation details

#### `domain`

This layer contains stable concepts and contracts.

Responsibilities:

- shared runtime and session types
- execution request/result types
- error types with clear semantics
- interfaces/ports for collaborators used by application services

This layer should stay free of concrete infrastructure dependencies.

#### `infrastructure`

This layer contains concrete technical implementations.

Responsibilities:

- session resolution from inbound messages
- turn execution against providers/tools
- tool loop execution and execution status tracking
- background task coordination and event emission
- memory integration
- role resolution integration
- inbound preprocessing pipeline integration

The infrastructure layer may depend on providers, tools, plugins, session manager, and event bus implementations, but those dependencies should remain localized here.

#### `assembly`

This is the only place where object graph construction is allowed to be dense.

Responsibilities:

- create the runtime facade
- wire application services to infrastructure implementations
- expose a small setup API for bootstrap

This replaces the current pattern where large runtime classes and bootstrap both construct internal details.

## Runtime Model

The new runtime is centered around a small set of focused objects:

- `AgentRuntime` facade
  - lifecycle entrypoint
  - inbound/direct entrypoint
  - session handle factory
  - abort/status query entrypoint
- `SessionResolver`
  - transforms inbound messages into execution-ready turn context
- `TurnExecutor`
  - executes a single agent turn
- `ToolCallLoop`
  - manages iterative tool calling inside a turn
- `ExecutionRegistry`
  - tracks active executions, abort signals, and execution state
- `BackgroundTaskCoordinator`
  - runs background/sub-agent work and emits related events

This keeps mutable runtime state localized instead of scattering it across facade and engine classes.

## Public Surface Strategy

The migration will use a "new kernel + compatibility adapter" approach.

### Temporary compatibility goal

During migration, the new facade should still support the high-value behaviors currently consumed by callers:

- handling inbound messages
- handling direct messages
- running sub-agent tasks
- querying execution status
- aborting active work
- creating session-scoped handles

### Final public surface goal

After the migration, external code should depend only on:

- `src/agent/index.ts`
- `src/agent/facade/*` exports used by top-level composition

Deep imports into internal runtime, execution, session, and role internals should be removed where practical.

## Caller Migration

These integration points are expected to move to the new facade/assembly entrypoints:

- `src/bootstrap/factory/ServiceFactory.ts`
- `src/bootstrap/app/cronDispatch.ts`
- `src/api/routes/core.ts`
- any remaining code importing `src/agent/...` internals directly

### Bootstrap impact

`ServiceFactory` should stop assembling agent internals itself. Instead, it should call a dedicated agent assembly entrypoint and receive back a compact runtime bundle.

Expected result:

- less agent-specific knowledge in bootstrap
- easier future replacement of agent internals
- simpler startup code paths

### API impact

API routes should depend on narrow runtime capabilities rather than concrete runtime internals. `core.ts` already mostly uses a small subset of runtime behavior, which fits the new facade model well.

### Cron impact

Cron dispatch should continue to use a direct-message-style entrypoint, but through the new facade contract rather than old runtime internals.

## Error Handling

Error handling will be explicit by layer.

### Domain errors

`domain/errors.ts` will hold semantic errors such as:

- invalid session reference
- runtime not started
- unknown agent role
- invalid execution state transition

### Infrastructure errors

Technical errors from provider/tool/plugin/memory integrations will be normalized at infrastructure boundaries before surfacing upward.

### Facade behavior

The facade should not silently swallow failures. It may add context and logging, but should preserve actionable failure information for API/bootstrap layers.

## Readability Rules

These are hard constraints for the rewrite:

- avoid "god classes"
- avoid generic names like `Helper`, `Manager`, and `Utils` unless the responsibility is truly broad and still coherent
- prefer a few small explicit parameters over large opaque bags when it improves comprehension
- keep the import graph directional: facade -> application -> domain/ports and assembly -> everything
- split files once they become hard to scan in one sitting
- keep comments rare and explanatory, not decorative

## Migration Plan

The migration will happen in four phases.

### Phase 1: Build the new implementation in `src/agent-next`

- create the new directory structure
- implement domain types and ports
- implement application use cases
- implement infrastructure executors/resolvers/coordinators
- implement facade and assembly entrypoints

At the end of this phase, the new implementation should be runnable in isolation but not yet the default path.

### Phase 2: Add compatibility coverage

- ensure the new facade can satisfy current high-value runtime operations
- add tests around behavior that existing callers rely on
- preserve session/direct/sub-agent/abort/status semantics where feasible

This is the safety net before rerouting callers.

### Phase 3: Switch external callers

- update bootstrap assembly to use the new agent assembly entrypoint
- update API and cron callers to depend on the new facade
- remove deep imports to old internals

At the end of this phase, old `src/agent` code should no longer be on the active execution path.

### Phase 4: Remove old implementation and rename

- delete the old `src/agent`
- rename `src/agent-next` to `src/agent`
- rewrite import paths
- run final verification

This phase should leave a single clean implementation with no transitional dual-runtime code.

## Testing Strategy

The rewrite should be driven by tests for critical behavior.

### Priority behaviors

- direct message handling
- inbound message handling
- turn execution wiring
- sub-agent task execution
- session agent assignment
- abort behavior
- execution status queries
- runtime config reload behavior

### Test layering

- application tests for orchestration decisions
- infrastructure tests for execution registry and turn execution behavior
- facade tests for compatibility-facing runtime behavior
- targeted integration/regression tests for bootstrap and API boundaries that switch to the new runtime

## Risks

### Risk: behavior drift during rewrite

Mitigation:

- preserve compatibility coverage around current entrypoints before final cutover
- migrate callers only after the new facade is exercised by tests

### Risk: over-abstraction

Mitigation:

- prefer explicit orchestration functions over generic frameworks
- reject abstractions that do not reduce real coupling or file size

### Risk: bootstrap and runtime assembly remain too intertwined

Mitigation:

- keep assembly logic inside `src/agent-next/assembly`
- treat bootstrap as a consumer, not an internal constructor

### Risk: large files reappear under new names

Mitigation:

- split runtime state, turn execution, background coordination, and session resolution into separate files from the start

## Acceptance Criteria

The redesign is complete when all of the following are true:

- there is no old `src/agent` implementation left in use
- the new implementation lives in `src/agent`
- bootstrap creates the runtime through a dedicated agent assembly API
- API and cron paths use the new facade instead of old internals
- the runtime surface is narrower and easier to read than the current implementation
- verification passes for the agreed test/build checks

## Implementation Handoff

The next step after spec approval is to produce a detailed implementation plan that executes the rewrite incrementally with TDD, including:

- file creation/modification list
- task-by-task migration sequence
- exact verification commands
- rollback-safe checkpoints
