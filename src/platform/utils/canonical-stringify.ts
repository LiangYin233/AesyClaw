export function canonicalStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map(canonicalStringify).join(',')}]`;
  }

  const keys = Object.keys(value as Record<string, unknown>).sort();
  const body = keys
    .map(key => `${JSON.stringify(key)}:${canonicalStringify((value as Record<string, unknown>)[key])}`)
    .join(',');

  return `{${body}}`;
}

export function hasCanonicalValueChanged(previousValue: unknown, nextValue: unknown): boolean {
  return canonicalStringify(previousValue) !== canonicalStringify(nextValue);
}
