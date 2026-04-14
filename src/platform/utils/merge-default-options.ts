function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && !(value instanceof Date);
}

export function mergeDefaultOptions(
  defaultOptions: Record<string, unknown> = {},
  userOptions?: Record<string, unknown>
): Record<string, unknown> {
  const merged = { ...defaultOptions };

  if (!userOptions) {
    return merged;
  }

  for (const key in userOptions) {
    if (Object.hasOwn(userOptions, key)) {
      const userValue = userOptions[key];
      const defaultValue = defaultOptions[key];

      if (isPlainObject(userValue) && isPlainObject(defaultValue)) {
        merged[key] = { ...defaultValue, ...userValue };
      } else {
        merged[key] = userValue;
      }
    }
  }

  return merged;
}
