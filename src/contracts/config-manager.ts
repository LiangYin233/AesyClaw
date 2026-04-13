import type { FullConfig } from '@/features/config/schema.js';

export interface IConfigManager {
  readonly config: FullConfig;
  getConfig(): FullConfig;
  registerChannelDefaults(channelName: string, defaults: Record<string, unknown>): void;
  isInitialized(): boolean;
  initialize(): Promise<void>;
}
