# Feature-First Architecture Migration Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate Session, Config, Plugins, Channels, and Skills modules from root-level directories (`src/session/`, `src/config/`, etc.) to `features/` structure following Feature-First organization and Three-Layer Architecture.

**Architecture:** 
- Destroying migration: create new structure, update all imports, delete old directories
- Each module follows: application/ (services) → domain/ (entities/types) → infrastructure/ (repositories/stores)

**Tech Stack:** TypeScript, Dependency Injection

---

## Module 1: Session Migration

### Overview
Current: `src/session/` contains real implementation, `features/sessions/` has thin wrapper
Target: All code in `features/sessions/`, `src/session/` deleted

### Files to Create/Modify

**Create:**
- `src/features/sessions/domain/types.ts` - Session types extracted from SessionManager
- `src/features/sessions/domain/errors.ts` - Errors from src/session/errors.ts
- `src/features/sessions/infrastructure/SessionStore.ts` - Move from src/session/SessionStore.ts
- `src/features/sessions/infrastructure/LongTermMemoryStore.ts` - Move from src/session/LongTermMemoryStore.ts
- `src/features/sessions/application/SessionManager.ts` - Move from src/session/SessionManager.ts

**Modify:**
- `src/features/sessions/index.ts` - Update exports
- `src/features/sessions/infrastructure/SessionsRepository.ts` - Update imports to new locations
- `src/features/sessions/application/SessionService.ts` - Update imports to new locations

**Delete:**
- `src/session/` (entire directory)

**Import Updates (59 files reference src/session/):**
Key files needing updates:
- `src/index.ts`
- `src/app/bootstrap/factory/ServiceFactory.ts`
- `src/features/memory/MemoryRepository.ts`
- `src/features/memory/MemoryApiService.ts`
- `src/features/memory/createMemoryRuntime.ts`
- `src/app/api/errors.ts`
- `src/agent/infrastructure/memory/SessionMemoryService.ts`
- `src/agent/infrastructure/memory/LongTermMemoryService.ts`
- etc.

### Tasks

#### Task 1: Create Session Domain Layer

- [ ] **Step 1: Create domain types file**

Create `src/features/sessions/domain/types.ts`:
```typescript
export interface SessionMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp?: string;
}

export interface ConversationMessage extends SessionMessage {
  id: number;
  sessionKey: string;
  sessionId: number;
}

export interface ConversationMemory {
  channel: string;
  chatId: string;
  summary: string;
  summarizedUntilMessageId: number;
  updatedAt?: string;
}

export interface Session {
  key: string;
  id?: number;
  channel: string;
  chatId: string;
  uuid?: string;
  summary: string;
  summarizedMessageCount: number;
  messages: SessionMessage[];
  createdAt: Date;
  updatedAt: Date;
}

export function parseSessionKey(key: string): { channel: string; chatId: string; uuid?: string } {
  const parts = key.split(':');
  const channel = parts[0]?.trim();
  const chatId = parts[1]?.trim();

  if (!channel || !chatId) {
    throw new SessionValidationError('session key must use format "channel:chatId[:uuid]"', {
      field: 'key',
      key
    });
  }

  if (parts.length >= 3) {
    const uuid = parts.slice(2).join(':').trim();
    return { channel, chatId, ...(uuid ? { uuid } : {}) };
  }

  return { channel, chatId };
}
```

- [ ] **Step 2: Create domain errors file**

Create `src/features/sessions/domain/errors.ts`:
```typescript
export class SessionValidationError extends Error {
  constructor(
    message: string,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = 'SessionValidationError';
  }
}

export class SessionNotFoundError extends Error {
  constructor(sessionKey: string) {
    super(`Session with id "${sessionKey}" not found`);
    this.name = 'SessionNotFoundError';
  }
}

export function normalizeSessionError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  if (error && typeof error === 'object' && 'message' in error) {
    return String(error.message);
  }
  return String(error);
}
```

- [ ] **Step 3: Commit**
```bash
git add src/features/sessions/domain/types.ts src/features/sessions/domain/errors.ts
git commit -m "feat(sessions): add domain layer with types and errors"
```

#### Task 2: Create Session Infrastructure Layer

- [ ] **Step 1: Copy SessionStore to infrastructure**

Create `src/features/sessions/infrastructure/SessionStore.ts` (copy from `src/session/SessionStore.ts` and update imports):
```typescript
import type { Database, DBConversationMemory, DBMessage, DBSession, DBSessionMemory } from '../../../../platform/db/index.js';

export class SessionStore {
  constructor(private readonly db: Database) {}

  async ready(): Promise<void> {
    await this.db.ready();
  }
  // ... rest of SessionStore methods, updating imports to use new paths
}
```

- [ ] **Step 2: Copy LongTermMemoryStore to infrastructure**

Create `src/features/sessions/infrastructure/LongTermMemoryStore.ts` (copy from `src/session/LongTermMemoryStore.ts` and update imports)

- [ ] **Step 3: Commit**
```bash
git add src/features/sessions/infrastructure/SessionStore.ts src/features/sessions/infrastructure/LongTermMemoryStore.ts
git commit -m "feat(sessions): add infrastructure layer with stores"
```

#### Task 3: Create Session Application Layer

- [ ] **Step 1: Create SessionManager in application layer**

Create `src/features/sessions/application/SessionManager.ts` (copy from `src/session/SessionManager.ts` and update imports):
- Update imports to use `../../domain/errors.js` for SessionValidationError, SessionNotFoundError, normalizeSessionError
- Update imports to use `../../infrastructure/SessionStore.js` for SessionStore
- Update imports to use `../../../../platform/db/index.js` for Database types
- Update imports to use `../../../../platform/observability/index.js` for logger

- [ ] **Step 2: Update SessionService to use new SessionManager**

Modify `src/features/sessions/application/SessionService.ts`:
- Change import from `../../../session/errors.js` to `../../domain/errors.js`
- Update to use SessionManager from `./SessionManager.js` instead of via SessionsRepository

- [ ] **Step 3: Update SessionsRepository to use new SessionManager**

Modify `src/features/sessions/infrastructure/SessionsRepository.ts`:
- Change import from `../../../session/SessionManager.js` to `./SessionManager.js`
- Change import from `../../../session/errors.js` to `../../domain/errors.js`

- [ ] **Step 4: Commit**
```bash
git add src/features/sessions/application/SessionManager.ts src/features/sessions/application/SessionService.ts src/features/sessions/infrastructure/SessionsRepository.ts
git commit -m "feat(sessions): refactor application layer with new SessionManager"
```

#### Task 4: Update features/sessions exports

- [ ] **Step 1: Update index.ts**

Modify `src/features/sessions/index.ts`:
```typescript
export { registerSessionsFeature } from './runtime/registerSessionsFeature.js';
export type { SessionsFeatureDeps } from './runtime/registerSessionsFeature.js';
export { createSessionRuntime } from './runtime/createSessionRuntime.js';
export { createSessionRoutingReloadTarget } from './runtime/createSessionRoutingReloadTarget.js';
export { SessionManager } from './application/SessionManager.js';
export { LongTermMemoryStore } from './infrastructure/LongTermMemoryStore.js';
export { SessionStore } from './infrastructure/SessionStore.js';
export type { Session, SessionMessage } from './domain/types.js';
export type {
  LongTermMemoryEntry,
  LongTermMemoryOperation,
  MemoryEntryKind,
  MemoryEntryStatus,
  MemoryOperationAction,
  MemoryOperationActor,
  MemoryOperationInput,
  MemoryOperationResult
} from './infrastructure/LongTermMemoryStore.js';
export { SessionNotFoundError, SessionValidationError } from './domain/errors.js';
```

- [ ] **Step 2: Commit**
```bash
git add src/features/sessions/index.ts
git commit -m "feat(sessions): update exports in index.ts"
```

#### Task 5: Update all imports referencing src/session/

- [ ] **Step 1: Update src/index.ts**

Modify `src/index.ts`:
- Change `export { SessionManager } from './session/index.js';` to `export { SessionManager } from './features/sessions/index.js';`
- Change `export type { Session, SessionMessage } from './session/index.js';` to same pattern

- [ ] **Step 2: Update src/app/bootstrap/factory/ServiceFactory.ts**

Modify imports from `'../../../session/index.js'` to `'../../features/sessions/index.js'`

- [ ] **Step 3: Update src/features/memory/ files**

Update all files in `src/features/memory/` that import from `../../session/`

- [ ] **Step 4: Update src/app/api/errors.ts**

Change import from `'../../session/errors.js'` to `'../features/sessions/domain/errors.js'`

- [ ] **Step 5: Update agent infrastructure files**

Update all files in `src/agent/infrastructure/memory/` that import from `../../../session/`

- [ ] **Step 6: Verify build**

Run: `npm run build`
Expected: Build succeeds with no import errors

- [ ] **Step 7: Commit**
```bash
git add -A && git commit -m "refactor: update all imports to use features/sessions"
```

#### Task 6: Delete old src/session/ directory

- [ ] **Step 1: Delete src/session/**

```bash
rm -rf src/session/
```

- [ ] **Step 2: Verify build passes**

Run: `npm run build` && `npm run typecheck`
Expected: All builds pass

- [ ] **Step 3: Commit**
```bash
git add -A && git commit -m "refactor!: delete legacy src/session/ directory"
```

---

## Module 2: Config Migration

### Overview
Current: `src/config/` and `features/config/` both exist, need consolidation
Target: All code in `features/config/`, `src/config/` deleted

### Tasks (similar pattern to Session)
- Create domain layer (schema, errors, types)
- Move infrastructure to features/config/infrastructure/
- Move application services to features/config/application/
- Update all imports
- Delete src/config/

---

## Module 3: Plugins Migration

### Overview
Current: `src/plugins/` has implementation
Target: Move to `features/plugins/`, delete `src/plugins/`

---

## Module 4: Channels Migration

### Overview
Current: `src/channels/` has implementation
Target: Move to `features/channels/`, delete `src/channels/`

---

## Module 5: Skills Migration

### Overview
Current: `src/skills/` has SkillManager with mixed responsibilities
Target: Split into proper layers in `features/skills/`, delete `src/skills/`

---

## Verification Checklist (After Each Module)

- [ ] `npm run build` passes
- [ ] `npm run typecheck` passes
- [ ] No remaining imports from old paths
- [ ] All tests pass (if tests exist)
