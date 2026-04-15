export interface ModelIdentifier {
  providerName: string;
  modelAlias: string;
}

export function parseModelIdentifier(identifier: string): ModelIdentifier {
  const parts = identifier.split('/');

  if (parts.length < 2) {
    throw new Error(
      `模型标识符格式错误: '${identifier}'。必须遵循 'provider_name/model_alias' 格式。`
    );
  }

  const providerName = parts[0];
  const modelAlias = parts.slice(1).join('/');

  return { providerName, modelAlias };
}

