import type { Api, Model, SimpleStreamOptions } from '@mariozechner/pi-ai';
import { ApiType } from './agent-types';

type CompatRecord = Record<string, unknown> & {
  sendSessionAffinityHeaders?: boolean;
  sendSessionIdHeader?: boolean;
};

export function withDefaultPromptCacheModel<T extends Model<Api>>(model: T): T {
  if (model.api === ApiType.OPENAI_COMPLETIONS) {
    const compat = model.compat as CompatRecord | undefined;
    return {
      ...model,
      compat: {
        ...compat,
        sendSessionAffinityHeaders: compat?.sendSessionAffinityHeaders ?? true,
      },
    } as T;
  }

  if (model.api === ApiType.OPENAI_RESPONSES) {
    const compat = model.compat as CompatRecord | undefined;
    return {
      ...model,
      compat: {
        ...compat,
        sendSessionIdHeader: compat?.sendSessionIdHeader ?? true,
      },
    } as T;
  }

  return model;
}

export function withDefaultPromptCacheOptions(
  model: Model<Api>,
  options: SimpleStreamOptions,
): SimpleStreamOptions {
  if (model.api !== ApiType.OPENAI_COMPLETIONS && model.api !== ApiType.OPENAI_RESPONSES) {
    return options;
  }

  return {
    cacheRetention: 'long',
    ...options,
  };
}
