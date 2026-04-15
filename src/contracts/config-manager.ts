import type { FullConfig } from '@/features/config/schema.js';
import type { ConfigDefaultsScope } from './commands.js';

export interface IConfigManager {
  readonly config: FullConfig;
  registerDefaults(scope: ConfigDefaultsScope, name: string, defaults: Record<string, unknown>): void;
  isInitialized(): boolean;
  initialize(): Promise<void>;
}
