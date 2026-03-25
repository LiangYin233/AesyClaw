function cloneChannelConfig(config?: Record<string, unknown>): Record<string, unknown> {
  return config ? structuredClone(config) : {};
}

export function mergeChannelConfigWithDefaults(
  defaultConfig: Record<string, unknown>,
  currentConfig?: Record<string, unknown>
): Record<string, unknown> {
  const merged = {
    ...cloneChannelConfig(defaultConfig),
    ...cloneChannelConfig(currentConfig)
  };

  merged.enabled = typeof currentConfig?.enabled === 'boolean'
    ? currentConfig.enabled
    : false;

  return merged;
}

export function stripChannelEnabled(config?: Record<string, unknown>): Record<string, unknown> {
  const next = cloneChannelConfig(config);
  delete next.enabled;
  return next;
}
