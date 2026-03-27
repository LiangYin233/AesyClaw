import { createProvider } from '../../../platform/providers/index.js';
import type { LLMProvider } from '../../../platform/providers/base.js';
import type { Config, VisionSettings } from '../../../types.js';

export function createVisionProviderFromSettings(
  config: Config,
  visionSettings: VisionSettings,
  options?: {
    onMissingProvider?: (providerName: string) => void;
  }
): LLMProvider | undefined {
  if (
    visionSettings.enabled === false
    || !visionSettings.fallbackProviderName
    || !visionSettings.fallbackModelName
  ) {
    return undefined;
  }

  const providerConfig = config.providers[visionSettings.fallbackProviderName];
  if (!providerConfig) {
    options?.onMissingProvider?.(visionSettings.fallbackProviderName);
    return undefined;
  }

  return createProvider(visionSettings.fallbackProviderName, providerConfig);
}
