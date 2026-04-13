# Import Boundaries

## Top-Level Modules

- `app`: composition root and runtime wiring.
- `agent`: execution runtime, session orchestration, and subagent runtime.
- `features`: business capabilities that do not import each other directly.
- `channels`: channel runtime integration.
- `middlewares`: pipeline middleware orchestration.
- `contracts`: shared interfaces and cross-layer value types.
- `platform`: lower-level infrastructure.
- `sdk`: approved plugin-facing surface.

## Dependency Direction

- `app` may import any module.
- `agent`, `channels`, and `middlewares` may import approved `features`, `contracts`, and `platform` modules as needed by runtime composition.
- `features` may import only themselves, `contracts`, and `platform`.
- `platform` must not import `features`, `agent`, or `channels`.
- `plugins` must import core contracts through `@/sdk/*` only.

## Import Style

- Use relative imports inside the same module subtree.
- Use `@/` alias imports when crossing top-level module boundaries.
- Do not use deep traversal such as `../../../platform/...` for cross-module imports.
- Do not import one feature from another feature.
- Do not route module-internal code back through its own `index.ts` barrel.

## Barrel Rules

- `index.ts` files are public entry points.
- A barrel may export only files owned by its own module or directory.
- A barrel must not re-export lower-layer implementation files it does not own.

## Runtime Composition

- Cross-feature orchestration belongs in `app` or runtime-owned code, not in a feature.
- Plugin runtime receives command/config seams from composition code.
- System commands that coordinate multiple capabilities are runtime-owned.
