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
