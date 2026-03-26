export interface ParsedModelRef {
  providerName: string;
  modelName: string;
}

export function formatModelRef(providerName: string, modelName: string): string {
  return `${providerName.trim()}/${modelName.trim()}`;
}

export function isModelRef(value: unknown): value is string {
  return typeof value === 'string' && value.includes('/');
}

export function parseModelRef(value: string, fieldName = 'model'): ParsedModelRef {
  const trimmed = value.trim();
  const slashIndex = trimmed.indexOf('/');

  if (slashIndex <= 0 || slashIndex === trimmed.length - 1) {
    throw new Error(`${fieldName} must use the format "provider/model"`);
  }

  const providerName = trimmed.slice(0, slashIndex).trim();
  const modelName = trimmed.slice(slashIndex + 1).trim();

  if (!providerName || !modelName) {
    throw new Error(`${fieldName} must use the format "provider/model"`);
  }

  return { providerName, modelName };
}

export function tryParseModelRef(value?: string | null): ParsedModelRef | undefined {
  if (!value?.trim()) {
    return undefined;
  }

  return parseModelRef(value);
}

export function resolveExecutionModel(modelRef: string): string {
  const trimmed = modelRef.trim();
  return tryParseModelRef(trimmed)?.modelName ?? trimmed;
}
