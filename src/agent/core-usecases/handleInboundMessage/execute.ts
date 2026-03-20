import type { HandleInboundMessageInput, HandleInboundMessageResult } from './contracts.js';
import type { HandleInboundMessageDeps } from './deps.js';

export async function handleInboundMessage(
  deps: HandleInboundMessageDeps,
  input: HandleInboundMessageInput
): Promise<HandleInboundMessageResult> {
  deps.logInbound(input.message);

  const preprocessed = await deps.processInbound({
    message: input.message,
    suppressOutbound: input.suppressOutbound
  });

  if (preprocessed.type === 'handled') {
    return { status: 'handled' };
  }

  if (preprocessed.type === 'reply') {
    return { status: 'replied', content: preprocessed.content };
  }

  const context = await deps.resolveTurnContext({
    message: preprocessed.message,
    suppressOutbound: input.suppressOutbound,
    toolContextBase: input.toolContextBase
  });

  const content = await deps.runTurn(context);
  deps.logCompletion(context);

  return {
    status: 'executed',
    content
  };
}
