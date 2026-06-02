import type { MessageUsage } from '@aesyclaw/core/types';
import { extractMessageText, type AgentMessage } from '@aesyclaw/contracts/llm';

export type SessionToolCallDto = {
  id: string;
  name: string;
  arguments?: Record<string, unknown>;
};

export type SessionToolResultDto = {
  toolCallId: string;
  toolName: string;
  isError: boolean;
  details?: unknown;
};

export type SessionMessageDto = {
  role: string;
  content: string;
  timestamp?: string;
  usage?: MessageUsage;
  toolCalls?: SessionToolCallDto[];
  toolResult?: SessionToolResultDto;
};

export function toSessionMessageDto(messages: readonly AgentMessage[]): SessionMessageDto[] {
  return messages.map((message) => {
    const timestamp =
      typeof message.timestamp === 'number' ? new Date(message.timestamp).toISOString() : undefined;

    if (message.role === 'toolResult') {
      const toolResult = message as AgentMessage & {
        toolCallId?: string;
        toolName?: string;
        isError?: boolean;
        details?: unknown;
      };

      return {
        role: message.role,
        content: extractMessageText(message),
        ...(timestamp !== undefined ? { timestamp } : {}),
        toolResult: {
          toolCallId: toolResult.toolCallId ?? '',
          toolName: toolResult.toolName ?? '',
          isError: toolResult.isError ?? false,
          ...(toolResult.details !== undefined ? { details: toolResult.details } : {}),
        },
      };
    }

    const usage = 'usage' in message ? message.usage : undefined;
    const toolCalls = extractToolCalls(message);
    return {
      role: message.role,
      content: extractMessageText(message),
      ...(timestamp !== undefined ? { timestamp } : {}),
      ...(usage !== undefined ? { usage } : {}),
      ...(toolCalls.length > 0 ? { toolCalls } : {}),
    };
  });
}

function extractToolCalls(message: AgentMessage): SessionToolCallDto[] {
  if (message.role !== 'assistant' || !Array.isArray(message.content)) return [];
  return message.content
    .filter(
      (
        block,
      ): block is {
        type: 'toolCall';
        id: string;
        name: string;
        arguments: Record<string, unknown>;
      } => typeof block === 'object' && block !== null && block.type === 'toolCall',
    )
    .map((block) => ({
      id: block.id,
      name: block.name,
      ...(block.arguments !== undefined ? { arguments: block.arguments } : {}),
    }));
}
