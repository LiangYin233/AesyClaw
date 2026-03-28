import { WebSocketApiClient } from './wsClient';

export interface RpcResult<T> {
  data: T | null;
  error: string | null;
}

let activeClient: WebSocketApiClient | null = null;
let activeToken: string | null = null;

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return typeof error === 'string' ? error : '网络请求失败';
}

function getClient(token: string | null): WebSocketApiClient {
  if (!token) {
    throw new Error('缺少访问 token');
  }

  if (!activeClient || activeToken !== token) {
    activeClient?.shutdown();
    activeClient = new WebSocketApiClient(token);
    activeToken = token;
  }

  return activeClient;
}

export async function rpcCall<T>(method: string, token: string | null, params?: unknown): Promise<RpcResult<T>> {
  try {
    const client = getClient(token);
    const data = await client.call<T>(method, params);
    return { data, error: null };
  } catch (error) {
    return {
      data: null,
      error: toErrorMessage(error)
    };
  }
}

export function rpcSubscribe<T>(
  topic: string,
  token: string | null,
  params: unknown,
  handler: (data: T) => void,
  options?: { onError?: (message: string) => void }
): () => void {
  try {
    const client = getClient(token);
    return client.subscribe<T>(topic, params, handler, options);
  } catch (error) {
    options?.onError?.(toErrorMessage(error));
    return () => undefined;
  }
}
