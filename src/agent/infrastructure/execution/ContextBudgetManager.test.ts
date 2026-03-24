import test from 'node:test';
import assert from 'node:assert/strict';
import type { LLMMessage, ToolDefinition } from '../../../types.js';
import { ContextBudgetManager } from './ContextBudgetManager.js';

function createMessages(): LLMMessage[] {
  return [
    { role: 'system', content: 'system prompt' },
    { role: 'user', content: 'first user message' },
    { role: 'assistant', content: 'assistant reply' },
    { role: 'tool', content: 'X'.repeat(5000), toolCallId: 'tool-1', name: 'shell_exec' },
    { role: 'user', content: 'latest user message' }
  ];
}

const tools: ToolDefinition[] = [
  {
    name: 'shell_exec',
    description: 'executes shell commands',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string' }
      }
    }
  }
];

test('returns messages unchanged when maxContextTokens is undefined', () => {
  const manager = new ContextBudgetManager();
  const messages = createMessages();

  const nextMessages = manager.fit(messages, tools, {});

  assert.deepEqual(nextMessages, messages);
});

test('trims older tool output before dropping the latest user message', () => {
  const manager = new ContextBudgetManager();
  const messages = createMessages();

  const nextMessages = manager.fit(messages, tools, {
    maxContextTokens: 220,
    reservedOutputTokens: 32
  });

  assert.equal(nextMessages.at(-1)?.role, 'user');
  assert.equal(nextMessages.at(-1)?.content, 'latest user message');
  assert.equal(nextMessages.some((message: LLMMessage) => message.role === 'tool' && typeof message.content === 'string' && message.content.includes('[tool output truncated]')), true);
});

test('keeps system message when trimming for budget', () => {
  const manager = new ContextBudgetManager();
  const messages = createMessages();

  const nextMessages = manager.fit(messages, tools, {
    maxContextTokens: 120,
    reservedOutputTokens: 32
  });

  assert.equal(nextMessages[0]?.role, 'system');
  assert.equal(nextMessages[0]?.content, 'system prompt');
});
