/**
 * LlmAdapter — resolves model identifiers, creates stream functions,
 * and provides LLM-based summarization for memory compaction.
 *
 * The real implementation will use Pi-mono's Agent and stream API.
 * For now, all LLM calls are stubbed — resolveModel is fully functional,
 * while createStreamFn and summarize return simulated responses.
 *
 * @see project.md §5.8
 */

import type { ConfigManager } from '../core/config/config-manager';
import type { ProviderConfig } from '../core/config/schema';
import type { ResolvedModel, StreamFn, AgentMessage } from './agent-types';
import { createScopedLogger } from '../core/logger';

const logger = createScopedLogger('llm-adapter');

// ─── LlmAdapter ──────────────────────────────────────────────────

/**
 * Dependencies injected into LlmAdapter on initialization.
 */
export interface LlmAdapterDependencies {
  configManager: ConfigManager;
}

export class LlmAdapter {
  private configManager: ConfigManager | null = null;
  private initialized = false;

  // ─── Lifecycle ────────────────────────────────────────────────

  /**
   * Initialize the adapter with config manager dependency.
   */
  initialize(deps: LlmAdapterDependencies): void {
    if (this.initialized) {
      logger.warn('LlmAdapter already initialized — skipping');
      return;
    }
    this.configManager = deps.configManager;
    this.initialized = true;
    logger.info('LlmAdapter initialized');
  }

  // ─── Model resolution ─────────────────────────────────────────

  /**
   * Resolve a "provider/model" identifier into a full ResolvedModel.
   *
   * Format: "provider/modelId" (e.g. "openai/gpt-4o", "anthropic/claude-3-opus")
   * - Splits on the first "/" to extract provider and model parts
   * - Looks up the provider config for API key, base URL, API type
   * - Merges model preset overrides (realModelName, contextWindow, enableThinking)
   * - Returns a ResolvedModel ready for use by AgentEngine
   *
   * @throws Error if the provider is not found in config
   */
  resolveModel(modelIdentifier: string): ResolvedModel {
    if (!this.configManager) {
      throw new Error('LlmAdapter not initialized');
    }

    const slashIndex = modelIdentifier.indexOf('/');
    if (slashIndex === -1) {
      throw new Error(
        `Invalid model identifier format: "${modelIdentifier}". Expected "provider/modelId".`,
      );
    }

    const provider = modelIdentifier.substring(0, slashIndex);
    const modelId = modelIdentifier.substring(slashIndex + 1);

    const providers = this.configManager.get('providers');
    const providerConfig: ProviderConfig | undefined = providers[provider];

    if (!providerConfig) {
      throw new Error(
        `Provider "${provider}" not found in config. Available providers: ${Object.keys(providers).join(', ')}`,
      );
    }

    // Merge model preset if exists
    const preset = providerConfig.models?.[modelId];

    const resolved: ResolvedModel = {
      provider,
      modelId,
      realModelName: preset?.realModelName,
      contextWindow: preset?.contextWindow ?? 128000,
      enableThinking: preset?.enableThinking ?? false,
      apiKey: preset?.apiKey ?? providerConfig.apiKey,
      baseUrl: providerConfig.baseUrl,
      apiType: providerConfig.apiType,
    };

    return resolved;
  }

  // ─── Stream function factory ──────────────────────────────────

  /**
   * Create a stream function for the given model identifier.
   *
   * The real implementation will use Pi-mono's stream API.
   * For now, returns a stub async generator that yields a simple response.
   *
   * @param _modelIdentifier - The "provider/model" identifier (unused in stub)
   */
  createStreamFn(_modelIdentifier: string): StreamFn {
    // Stub implementation — returns a simulated stream function
    return async function* (
      _model: unknown,
      _messages: unknown[],
      _options?: unknown,
    ): AsyncIterable<unknown> {
      // Simulate an LLM response with a single chunk
      yield { type: 'text', text: '[Simulated LLM response]' };
    };
  }

  // ─── API key resolution ────────────────────────────────────────

  /**
   * Create a function that resolves API keys from config for a given provider.
   *
   * Used by the agent system to obtain provider-specific API keys.
   *
   * @returns A function that takes a provider name and returns its API key or undefined
   */
  createGetApiKey(): (provider: string) => string | undefined {
    if (!this.configManager) {
      throw new Error('LlmAdapter not initialized');
    }

    const configManager = this.configManager;

    return (provider: string): string | undefined => {
      const providers = configManager.get('providers');
      const providerConfig = providers[provider];
      return providerConfig?.apiKey;
    };
  }

  // ─── Summarization ────────────────────────────────────────────

  /**
   * Summarize a conversation history using the LLM.
   *
   * Used by MemoryManager.compact() to compress long conversations.
   * The real implementation will call the LLM to generate a summary.
   * For now, returns a stub summary.
   *
   * @param messages - The conversation messages to summarize
   * @returns A summary string
   */
  async summarize(messages: AgentMessage[]): Promise<string> {
    // Stub implementation — will be replaced with real LLM call
    const userMessages = messages.filter((m) => m.role === 'user').length;
    const assistantMessages = messages.filter((m) => m.role === 'assistant').length;

    logger.debug(`Summarizing ${messages.length} messages (stub)`);

    return `Conversation summary: ${messages.length} messages (${userMessages} user, ${assistantMessages} assistant). This is a stub summary — real implementation will use the LLM.`;
  }
}