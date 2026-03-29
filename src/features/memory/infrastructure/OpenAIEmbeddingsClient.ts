import { logger, preview } from '../../../platform/observability/index.js';

const DEFAULT_API_BASE = 'https://api.openai.com/v1';

interface OpenAIEmbeddingsClientConfig {
  apiKey?: string;
  apiBase?: string;
  headers?: Record<string, string>;
}

interface OpenAIEmbeddingsResponse {
  data?: Array<{
    embedding?: number[];
  }>;
  error?: {
    message?: string;
  };
}

function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, '')}${path.startsWith('/') ? path : `/${path}`}`;
}

export class OpenAIEmbeddingsClient {
  private log = logger.child('OpenAIEmbeddings');

  constructor(private config: OpenAIEmbeddingsClientConfig) {}

  async embed(input: string, model: string, signal?: AbortSignal): Promise<number[]> {
    const [embedding] = await this.embedMany([input], model, signal);
    if (!embedding) {
      throw new Error('OpenAI Embeddings API returned an empty embedding list');
    }
    return embedding;
  }

  async embedMany(inputs: string[], model: string, signal?: AbortSignal): Promise<number[][]> {
    const trimmedInputs = inputs
      .map((input) => input.trim())
      .filter((input) => input.length > 0);

    if (trimmedInputs.length === 0) {
      throw new Error('Embedding inputs must not be empty');
    }
    if (!model.trim()) {
      throw new Error('Embedding model is required');
    }

    const data = await this.requestEmbeddings(trimmedInputs, model, signal);
    const embeddings = (data.data || []).map((item) => item.embedding);
    if (embeddings.length !== trimmedInputs.length) {
      throw new Error('OpenAI Embeddings API returned an unexpected number of embeddings');
    }

    return embeddings.map((embedding, _index) => {
      if (!Array.isArray(embedding) || embedding.some((value) => typeof value !== 'number')) {
        throw new Error('OpenAI Embeddings API returned an invalid embedding payload');
      }
      return embedding;
    });
  }

  private async requestEmbeddings(
    input: string | string[],
    model: string,
    signal?: AbortSignal
  ): Promise<OpenAIEmbeddingsResponse> {
    const url = joinUrl(this.config.apiBase || DEFAULT_API_BASE, '/embeddings');
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.config.apiKey || ''}`,
        ...(this.config.headers || {})
      },
      body: JSON.stringify({
        model,
        input
      }),
      signal
    });

    const rawText = await response.text();
    let data: OpenAIEmbeddingsResponse | undefined;

    try {
      data = JSON.parse(rawText) as OpenAIEmbeddingsResponse;
    } catch {
      throw new Error(
        `OpenAI Embeddings API returned invalid JSON: status=${response.status}, body=${preview(rawText)}`
      );
    }

    if (!response.ok) {
      throw new Error(data?.error?.message || `OpenAI Embeddings API error: ${response.status} ${response.statusText}`);
    }

    return data;
  }
}
