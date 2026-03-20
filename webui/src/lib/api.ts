import { buildTokenQuery } from './auth';

export interface ApiResult<T> {
  data: T | null;
  error: string | null;
}

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';

const API_BASE = import.meta.env.VITE_API_BASE_URL || '';

async function request<T>(
  method: HttpMethod,
  path: string,
  token: string | null,
  body?: unknown,
  query?: Record<string, string | number | boolean | undefined>
): Promise<ApiResult<T>> {
  try {
    const url = new URL(`${API_BASE}${path}`, window.location.origin);
    const nextQuery = buildTokenQuery(undefined, token);

    Object.entries(query || {}).forEach(([key, value]) => {
      if (value !== undefined) {
        nextQuery[key] = String(value);
      }
    });

    Object.entries(nextQuery).forEach(([key, value]) => {
      if (typeof value === 'string') {
        url.searchParams.set(key, value);
      }
    });

    const response = await fetch(url.toString(), {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });

    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      const error = payload?.error?.message || payload?.error || payload?.message || `请求失败 (${response.status})`;
      return { data: null, error };
    }

    return { data: payload as T, error: null };
  } catch (error) {
    return {
      data: null,
      error: error instanceof Error ? error.message : '网络请求失败',
    };
  }
}

export function apiGet<T>(path: string, token: string | null, query?: Record<string, string | number | boolean | undefined>) {
  return request<T>('GET', path, token, undefined, query);
}

export function apiPost<T>(path: string, token: string | null, body?: unknown) {
  return request<T>('POST', path, token, body);
}

export function apiPut<T>(path: string, token: string | null, body?: unknown) {
  return request<T>('PUT', path, token, body);
}

export function apiDelete<T>(path: string, token: string | null) {
  return request<T>('DELETE', path, token);
}
