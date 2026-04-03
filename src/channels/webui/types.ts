export interface WebSocketMessage {
  type: string;
  [key: string]: unknown;
}

export interface ChatMessagePayload {
  chatId: string;
  text: string;
}

export interface RuntimeTracePayload {
  chatId: string;
  event: 'thinking' | 'tool_call' | 'tool_result' | 'response' | 'error';
  detail?: {
    tool?: string;
    args?: string;
    result?: string;
    text?: string;
    error?: string;
  };
  timestamp: number;
}

export interface LogStreamPayload {
  level: 'trace' | 'debug' | 'info' | 'warn' | 'error';
  msg: string;
  timestamp: number;
}

export interface ChatStreamPayload {
  chatId: string;
  chunk: string;
  done: boolean;
  error?: string;
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

export interface ApiError {
  error: string;
  code: string;
  details?: unknown;
}

export interface LoginRequest {
  password: string;
}

export interface LoginResponse {
  token: string;
  expiresIn: number;
}
