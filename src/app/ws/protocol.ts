import { RequestValidationError } from '../../platform/errors/boundary.js';

export interface WebSocketApiError {
  code: string;
  message: string;
  details?: unknown;
  field?: string;
}

export interface RpcRequestMessage {
  id: string | number;
  type: 'rpc';
  method: string;
  params?: unknown;
}

export interface SubscribeRequestMessage {
  id: string | number;
  type: 'subscribe';
  topic: string;
  params?: unknown;
}

export interface UnsubscribeRequestMessage {
  id: string | number;
  type: 'unsubscribe';
  subscriptionId: string;
}

export type IncomingClientMessage =
  | RpcRequestMessage
  | SubscribeRequestMessage
  | UnsubscribeRequestMessage;

export interface SuccessResponseMessage {
  id: string | number | null;
  ok: true;
  result: unknown;
}

export interface ErrorResponseMessage {
  id: string | number | null;
  ok: false;
  error: WebSocketApiError;
}

export interface EventMessage {
  type: 'event';
  subscriptionId: string;
  topic: string;
  data: unknown;
}

export type OutgoingServerMessage =
  | SuccessResponseMessage
  | ErrorResponseMessage
  | EventMessage;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseRequestId(value: unknown): string | number {
  if (typeof value === 'string' || typeof value === 'number') {
    return value;
  }

  throw new RequestValidationError('id must be a string or number', 'id');
}

export function parseIncomingClientMessage(raw: unknown): IncomingClientMessage {
  if (!isRecord(raw)) {
    throw new RequestValidationError('WebSocket message must be an object');
  }

  const id = parseRequestId(raw.id);
  const type = raw.type;

  if (type === 'rpc') {
    if (typeof raw.method !== 'string' || !raw.method.trim()) {
      throw new RequestValidationError('rpc method is required', 'method');
    }

    return {
      id,
      type,
      method: raw.method,
      params: raw.params
    };
  }

  if (type === 'subscribe') {
    if (typeof raw.topic !== 'string' || !raw.topic.trim()) {
      throw new RequestValidationError('subscription topic is required', 'topic');
    }

    return {
      id,
      type,
      topic: raw.topic,
      params: raw.params
    };
  }

  if (type === 'unsubscribe') {
    if (typeof raw.subscriptionId !== 'string' || !raw.subscriptionId.trim()) {
      throw new RequestValidationError('subscriptionId is required', 'subscriptionId');
    }

    return {
      id,
      type,
      subscriptionId: raw.subscriptionId
    };
  }

  throw new RequestValidationError('type must be rpc, subscribe, or unsubscribe', 'type');
}
