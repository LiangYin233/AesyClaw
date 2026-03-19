import { z } from 'zod';

export const DEFAULT_SYSTEM_PROMPT = 'You are a helpful AI assistant.';
export const DEFAULT_PROVIDER_NAME = 'openai';
export const DEFAULT_PROVIDER_API_BASE = 'https://api.openai.com/v1';
export const DEFAULT_PROVIDER_TYPE = 'openai';
export const HTTP_URL_PROTOCOL = /^https?$/;
export const MAIN_AGENT_NAME = 'main';

export function withObjectInputDefault<T extends z.ZodRawShape>(shape: T) {
  const schema = z.object(shape);
  return schema.prefault(() => ({} as z.input<typeof schema>));
}
