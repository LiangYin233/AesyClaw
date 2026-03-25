# Feature-First Architecture Migration Design

## Status: Approved

## Overview

Migrate all modules from root-level directories (`src/session/`, `src/config/`, etc.) to `features/` structure following Feature-First organization and Three-Layer Architecture.

## Migration Order

1. Session → 2. Config → 3. Plugins → 4. Channels → 5. Skills

## Target Structure

```
features/
  {feature}/
    application/   ← Services, Controllers (business logic)
    domain/        ← Entities, Value Objects, Types
    infrastructure/← Repositories, Stores, External APIs
```

## Migration Details

### 1. Session Feature

**Source:** `src/session/`
**Target:** `features/sessions/`

| File | Target Location | Layer |
|------|-----------------|-------|
| SessionManager.ts | application/SessionService.ts | Application |
| SessionStore.ts | infrastructure/SessionStore.ts | Infrastructure |
| LongTermMemoryStore.ts | infrastructure/LongTermMemoryStore.ts | Infrastructure |
| errors.ts | domain/SessionError.ts | Domain |
| index.ts | domain/index.ts + application/index.ts | Export |

**Actions:**
- Rename SessionManager → SessionService (application layer)
- Extract interface ISessionRepository from SessionService
- Move SessionStore to infrastructure/
- Update all imports to new paths
- Delete src/session/

### 2. Config Feature

**Source:** `src/config/`
**Target:** `features/config/`

| File | Target Location | Layer |
|------|-----------------|-------|
| ConfigManager.ts | application/ConfigService.ts | Application |
| ConfigMutationService.ts | application/ConfigMutationService.ts | Application |
| ConfigQueryService.ts | application/ConfigQueryService.ts | Application |
| ConfigReloadCoordinator.ts | application/ConfigReloadCoordinator.ts | Application |
| ConfigFileStore.ts | infrastructure/ConfigFileStore.ts | Infrastructure |
| FsConfigWatcher.ts | infrastructure/FsConfigWatcher.ts | Infrastructure |
| TomlConfigCodec.ts | infrastructure/TomlConfigCodec.ts | Infrastructure |
| RuntimeConfigStore.ts | infrastructure/RuntimeConfigStore.ts | Infrastructure |
| schema/ | domain/schema/ | Domain |
| projections/ | domain/projections/ | Domain |
| selectors.ts | domain/selectors.ts | Domain |
| errors.ts | domain/ConfigError.ts | Domain |

**Actions:**
- Consolidate parallel structures (src/config/ + features/config/)
- Ensure clean three-layer separation
- Delete src/config/

### 3. Plugins Feature

**Source:** `src/plugins/`
**Target:** `features/plugins/`

| File | Target Location | Layer |
|------|-----------------|-------|
| manager.ts | application/PluginManager.ts | Application |
| runtime.ts | infrastructure/PluginRuntime.ts | Infrastructure |
| types.ts | domain/PluginTypes.ts | Domain |
| definePlugin.ts | domain/definePlugin.ts | Domain |

**Actions:**
- Move all files from src/plugins/ to features/plugins/
- Delete src/plugins/

### 4. Channels Feature

**Source:** `src/channels/`
**Target:** `features/channels/`

| File | Target Location | Layer |
|------|-----------------|-------|
| ChannelManager.ts | application/ChannelManager.ts | Application |
| ChannelPluginLoader.ts | infrastructure/ChannelPluginLoader.ts | Infrastructure |
| core/adapter.ts | infrastructure/ChannelAdapter.ts | Infrastructure |
| core/delivery-queue.ts | infrastructure/DeliveryQueue.ts | Infrastructure |
| core/inboundPipeline.ts | infrastructure/InboundPipeline.ts | Infrastructure |
| core/outboundPipeline.ts | infrastructure/OutboundPipeline.ts | Infrastructure |
| core/messageCompat.ts | infrastructure/MessageCompat.ts | Infrastructure |
| core/messageMappers.ts | infrastructure/MessageMappers.ts | Infrastructure |
| core/projection.ts | domain/ChannelProjection.ts | Domain |
| core/resource-store.ts | infrastructure/ResourceStore.ts | Infrastructure |
| core/runtime.ts | infrastructure/ChannelRuntime.ts | Infrastructure |
| core/types.ts | domain/ChannelTypes.ts | Domain |
| errors.ts | domain/ChannelError.ts | Domain |

**Actions:**
- Move core/ contents to appropriate layers
- Consolidate with existing features/channels/ structure
- Delete src/channels/

### 5. Skills Feature

**Source:** `src/skills/`
**Target:** `features/skills/`

| File | Target Location | Layer |
|------|-----------------|-------|
| SkillManager.ts | application/SkillManager.ts | Application |
| SkillManager.ts (config logic) | infrastructure/SkillConfigWatcher.ts | Infrastructure |
| errors.ts | domain/SkillError.ts | Domain |
| promptFormatter.ts | infrastructure/SkillPromptFormatter.ts | Infrastructure |

**Actions:**
- Extract file watching logic to infrastructure/
- Move SkillManager to application/
- Delete src/skills/

## Migration Strategy

**破坏性迁移** - Simultaneous update of all callers:
1. Create new feature structure
2. Update all imports to new paths
3. Delete old directories
4. Verify build passes

## Verification

After each module migration:
- [ ] Build passes: `npm run build`
- [ ] TypeScript check passes: `npm run typecheck`
- [ ] No import errors from old paths
