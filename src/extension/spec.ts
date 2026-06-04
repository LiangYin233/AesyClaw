import type { ToolOwner } from '@aesyclaw/core/types';
import type { BaseExtensionDefinition } from './types';

export type ExtensionRuntimeSpec<TDef extends BaseExtensionDefinition<TCtx>, TCtx> = {
  kind: string;
  configKey: string;
  dirPrefix: string;
  extensionsDir: string;
  discoverDefinition(imported: unknown): TDef | null;
  createContext(args: {
    definition: TDef;
    owner: ToolOwner;
    ref: { current: Record<string, unknown> };
    state: Record<string, unknown>;
    directory?: string;
  }): TCtx;
  validateConfig?(definition: TDef, config: Record<string, unknown>): Record<string, unknown>;
  getManagedDefaults?(definition: TDef): Record<string, unknown>;
  onAfterLoad?(definition: TDef, context: TCtx): Promise<void> | void;
  onBeforeUnload?(definition: TDef, context: TCtx): Promise<void> | void;
};
