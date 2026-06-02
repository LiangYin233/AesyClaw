import type { AgentToolResult } from '@aesyclaw/contracts/llm';
import type { HookRegistration, Middleware, HookCtx, HookResult } from '@aesyclaw/hook';
import { isRecord } from '@aesyclaw/core/utils';

export const TOOL_RESULT_TRUNCATION_HOOK_ID = 'core:tool-result-truncation';

const TRUNCATION_HEAD_RATIO = 0.7;
const TRUNCATION_SEPARATOR = '\n\n...[中间内容已截断]...\n\n';

export function limitToolResultContent<T extends AgentToolResult>(
  result: T,
  budget: { maxToolResultTokens: number; maxToolResultChars: number },
): T {
  const originalText = result.content.map((block) => block.text).join('\n');
  const originalContentLength = originalText.length;
  if (originalContentLength <= budget.maxToolResultChars) return result;

  const truncated = truncateTextWithNotice(originalText, budget.maxToolResultChars);

  return {
    ...result,
    content: [{ type: 'text', text: truncated.text }],
    details: {
      ...(isRecord(result.details) ? result.details : {}),
      truncated: true,
      originalContentLength,
      retainedContentLength: truncated.retainedContentLength,
      truncatedContentLength: truncated.text.length,
      maxToolResultTokens: budget.maxToolResultTokens,
    },
  };
}

export function createToolResultTruncationHook(): HookRegistration {
  return {
    id: TOOL_RESULT_TRUNCATION_HOOK_ID,
    chain: 'agent:afterToolCall',
    priority: 100,
    enabled: true,
    handler: createToolResultTruncationMiddleware(),
  };
}

function createToolResultTruncationMiddleware(): Middleware {
  return async (ctx: HookCtx, next?: () => Promise<HookResult>): Promise<HookResult> => {
    if (ctx.agentToolResult && ctx.toolResultBudget) {
      ctx.agentToolResult = limitToolResultContent(ctx.agentToolResult, ctx.toolResultBudget);
    }
    return next !== undefined ? await next() : { action: 'next' };
  };
}

function truncateTextWithNotice(
  text: string,
  maxContentChars: number,
): { text: string; retainedContentLength: number } {
  const retainedContentLength = Math.max(0, Math.floor(maxContentChars));
  const notice = createTruncationNotice(text.length, retainedContentLength);
  if (retainedContentLength <= 0) {
    return { text: notice, retainedContentLength: 0 };
  }

  const headLength = Math.ceil(retainedContentLength * TRUNCATION_HEAD_RATIO);
  const tailLength = retainedContentLength - headLength;
  const head = text.slice(0, headLength);
  const tail = tailLength > 0 ? text.slice(-tailLength) : '';
  return {
    text: `${head}${TRUNCATION_SEPARATOR}${tail}\n\n${notice}`,
    retainedContentLength,
  };
}

function createTruncationNotice(originalContentLength: number, retainedContentLength: number): string {
  return `[工具结果已截断：原始 ${originalContentLength} 字符，保留 ${retainedContentLength} 字符。]`;
}
