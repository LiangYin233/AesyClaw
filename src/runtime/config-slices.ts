import { hasCanonicalValueChanged } from '@/platform/utils/canonical-stringify.js';
import type { ConfigManagerService } from '@/contracts/runtime-services.js';

export function getConfigSlice<T>(
  configManager: ConfigManagerService,
  selector: (_config: ConfigManagerService['config']) => T | undefined,
  fallback: T
): T {
  if (!configManager.isInitialized()) {
    return fallback;
  }

  return selector(configManager.config) ?? fallback;
}

export function onConfigSliceChange<T>(
  configManager: ConfigManagerService,
  selector: (_config: ConfigManagerService['config']) => T | undefined,
  fallback: T,
  listener: (_next: T, _prev: T) => Promise<void>
): () => void {
  return configManager.onConfigChange(async (nextConfig, previousConfig) => {
    const nextValue = selector(nextConfig) ?? fallback;
    const previousValue = selector(previousConfig) ?? fallback;
    if (!hasCanonicalValueChanged(previousValue, nextValue)) {
      return;
    }

    await listener(nextValue, previousValue);
  });
}
