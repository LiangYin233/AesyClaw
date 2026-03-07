/**
 * Formatting Utilities
 *
 * Consolidated formatting functions used across the application.
 */

import type { ToolDefinition, ToolCall, LLMMessage } from '../types.js';

/**
 * Format tools for OpenAI API
 */
export function formatTools(tools?: ToolDefinition[]): Array<{
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: any;
  };
}> | undefined {
  if (!tools?.length) return undefined;

  return tools.map(tool => ({
    type: 'function' as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters
    }
  }));
}

/**
 * Format messages for OpenAI API
 */
export function formatMessages(messages: LLMMessage[]): Array<{
  role: string;
  content?: string | any[];
  tool_call_id?: string;
  tool_calls?: any[];
}> {
  return messages.map(msg => {
    const formatted: any = {
      role: msg.role
    };

    if (msg.role === 'tool') {
      formatted.tool_call_id = msg.toolCallId;
      formatted.content = msg.content;
    } else if (msg.toolCalls && msg.toolCalls.length > 0) {
      formatted.tool_calls = msg.toolCalls.map((tc: ToolCall) => {
        let args: string;
        if (typeof tc.arguments === 'string') {
          args = tc.arguments;
        } else if (tc.arguments && Object.keys(tc.arguments).length > 0) {
          args = JSON.stringify(tc.arguments);
        } else {
          args = '{}';
        }

        return {
          id: tc.id || '',
          type: 'function',
          function: {
            name: tc.name || '',
            arguments: args
          }
        };
      });
      if (msg.content) {
        formatted.content = msg.content;
      }
    } else {
      formatted.content = msg.content;
    }

    return formatted;
  });
}

/**
 * Format message content with base64-encoded images for OneBot
 */
export function formatMessageWithBase64(
  content: string,
  media: string[] | undefined,
  imageToBase64: (path: string) => string | null,
  maxLength: number
): any[] {
  const segments: any[] = [];
  let remaining = content;

  while (remaining.length > 0) {
    const imageMatch = remaining.match(/\[图片\]\(([^)]+)\)/);
    if (imageMatch) {
      const before = remaining.substring(0, imageMatch.index);
      if (before) {
        segments.push({ type: 'text', data: { text: before } });
      }
      const base64 = imageToBase64(imageMatch[1]);
      if (base64) {
        segments.push({ type: 'image', data: { file: `base64://${base64}` } });
      }
      remaining = remaining.substring(imageMatch.index! + imageMatch[0].length);
      continue;
    }

    const atMatch = remaining.match(/@(\d+)/);
    if (atMatch) {
      const before = remaining.substring(0, atMatch.index);
      if (before) {
        segments.push({ type: 'text', data: { text: before } });
      }
      segments.push({ type: 'at', data: { qq: atMatch[1] } });
      remaining = remaining.substring(atMatch.index! + atMatch[0].length);
      continue;
    }

    const chunkLength = Math.min(remaining.length, maxLength);
    segments.push({ type: 'text', data: { text: remaining.substring(0, chunkLength) } });
    break;
  }

  if (media && media.length > 0) {
    for (const mediaPath of media) {
      const base64 = imageToBase64(mediaPath);
      if (base64) {
        segments.push({ type: 'image', data: { file: `base64://${base64}` } });
      }
    }
  }

  return segments.length > 0 ? segments : [{ type: 'text', data: { text: content } }];
}
