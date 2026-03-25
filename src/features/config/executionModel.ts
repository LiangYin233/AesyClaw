import { tryParseModelRef } from './modelRef.js';

export function resolveExecutionModel(modelRef: string): string {
  const trimmed = modelRef.trim();
  return tryParseModelRef(trimmed)?.modelName ?? trimmed;
}
