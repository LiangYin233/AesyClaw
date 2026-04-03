const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

export interface ApiError {
  error: string;
  code: string;
  details?: unknown;
}

export class ApiException extends Error {
  constructor(
    public status: number,
    public body: ApiError | null
  ) {
    super(body?.error || `API error ${status}`);
    this.name = 'ApiException';
  }
}

function getToken(): string | null {
  return localStorage.getItem('auth_token');
}

function setToken(token: string): void {
  localStorage.setItem('auth_token', token);
}

function clearToken(): void {
  localStorage.removeItem('auth_token');
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> || {}),
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const url = path.startsWith('http') ? path : `${API_BASE_URL}${path}`;

  const response = await fetch(url, {
    ...options,
    headers,
  });

  if (response.status === 401) {
    clearToken();
    window.location.href = '/login';
    throw new ApiException(401, { error: 'Unauthorized', code: 'UNAUTHORIZED' });
  }

  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new ApiException(response.status, body);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json();
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, data?: unknown) =>
    request<T>(path, { method: 'POST', body: data ? JSON.stringify(data) : undefined }),
  put: <T>(path: string, data?: unknown) =>
    request<T>(path, { method: 'PUT', body: data ? JSON.stringify(data) : undefined }),
  patch: <T>(path: string, data?: unknown) =>
    request<T>(path, { method: 'PATCH', body: data ? JSON.stringify(data) : undefined }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
};

export interface LoginResponse {
  token: string;
  expiresIn: number;
}

export async function login(password: string): Promise<LoginResponse> {
  const response = await fetch(`${API_BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  });

  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new ApiException(response.status, body);
  }

  const data = await response.json();
  setToken(data.token);
  return data;
}

export function logout(): void {
  clearToken();
}

export async function verifyToken(): Promise<{ valid: boolean }> {
  const token = getToken();
  if (!token) {
    return { valid: false };
  }

  try {
    return await api.get<{ valid: boolean }>('/api/auth/verify');
  } catch {
    return { valid: false };
  }
}

export interface SessionInfo {
  chatId: string;
  title: string;
  updatedAt: string;
  messageCount: number;
  tokenUsage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  memoryStats?: {
    currentTokens: number;
    maxTokens: number;
    isCompressing: boolean;
    compressionPhase?: string;
  };
}

export interface CronJobInfo {
  id: string;
  name: string;
  expression: string;
  enabled: boolean;
  lastRun?: string;
  nextRun?: string;
  runCount: number;
  payload: Record<string, unknown>;
}

export interface ToolInfo {
  name: string;
  description: string;
  parameters: {
    type: string;
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export interface MCPStatus {
  server: string;
  status: 'connected' | 'disconnected' | 'error';
  lastChecked?: string;
  error?: string;
}

export interface AgentStats {
  activeCount: number;
  chatIds: string[];
  agents: Array<{
    chatId: string;
    instanceId: string;
    memoryStats: {
      totalMessages: number;
      totalTokens: number;
      currentPhase: string;
    };
    tokenBudget: {
      currentTokens: number;
      maxTokens: number;
      usagePercentage: number;
    };
  }>;
}

export interface MemoryInfo {
  chatId: string;
  stats: {
    totalMessages: number;
    totalTokens: number;
    sacredMessages: number;
    compressibleMessages: number;
    compressionCount: number;
    currentPhase: string;
  };
  budget: {
    currentTokens: number;
    maxTokens: number;
    usagePercentage: number;
    needsCompression: boolean;
  };
  messageCount: number;
  messages: Array<{
    role: string;
    content: string;
    toolCallId?: string;
  }>;
}

export const sessionsApi = {
  list: () => api.get<{ sessions: SessionInfo[] }>('/api/sessions'),
  delete: (chatId: string) => api.delete<{ success: boolean; chatId: string }>(`/api/sessions/${chatId}`),
  clear: (chatId: string) => api.post<{ success: boolean; chatId: string }>(`/api/sessions/${chatId}/clear`),
  getMemory: (chatId: string) => api.get<MemoryInfo>(`/api/sessions/${chatId}/memory`),
};

export const cronApi = {
  list: () => api.get<{ jobs: CronJobInfo[] }>('/api/cron'),
  create: (data: { id: string; name?: string; expression: string; payload?: Record<string, unknown> }) =>
    api.post<{ job: CronJobInfo }>('/api/cron', data),
  delete: (id: string) => api.delete<{ success: boolean; id: string }>(`/api/cron/${id}`),
  toggle: (id: string) => api.patch<{ success: boolean; id: string; enabled: boolean }>(`/api/cron/${id}/toggle`),
};

export const registryApi = {
  listTools: () => api.get<{ tools: ToolInfo[] }>('/api/registry/tools'),
  getMCPStatus: () => api.get<{ servers: MCPStatus[] }>('/api/registry/mcp'),
};

export const configApi = {
  get: () => api.get<{ config: unknown }>('/api/config'),
  update: (config: unknown) => api.post<{ success: boolean }>('/api/config', config),
};

export const agentsApi = {
  getStats: () => api.get<AgentStats>('/api/agents/stats'),
};

export function isAuthenticated(): boolean {
  return !!getToken();
}

export function getAuthToken(): string | null {
  return getToken();
}
