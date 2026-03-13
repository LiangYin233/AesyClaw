import type { PluginContext } from '../../src/plugins/PluginManager.ts';

interface LoggerLike {
  debug: (message: string, ...args: any[]) => void;
  info: (message: string, ...args: any[]) => void;
  warn: (message: string, ...args: any[]) => void;
  error: (message: string, ...args: any[]) => void;
  preview: (value: unknown, limit?: number) => string;
}

const defaultLogger: LoggerLike = {
  debug: console.debug.bind(console),
  info: console.info.bind(console),
  warn: console.warn.bind(console),
  error: console.error.bind(console),
  preview: (value: unknown, limit: number = 120) => String(value ?? '').slice(0, limit)
};

type TavilySearchDepth = 'basic' | 'advanced' | 'fast' | 'ultra-fast';

interface TavilySearchResult {
  title?: string;
  url?: string;
  content?: string;
  score?: number;
}

interface TavilyExtractResult {
  url?: string;
  raw_content?: string;
}

interface TavilyResponse {
  results?: Array<TavilySearchResult | TavilyExtractResult>;
}

interface WebsearchConfig {
  apiKey: string;
  maxResults: number;
  searchDepth: TavilySearchDepth;
}

const plugin: {
  name: string;
  version: string;
  description: string;
  log: LoggerLike;
  config: WebsearchConfig;
  defaultConfig: {
    enabled: boolean;
    options: WebsearchConfig;
  };
  fetchTavily(endpoint: string, body: Record<string, any>, apiKey: string): Promise<TavilyResponse>;
  onLoad(context: PluginContext): Promise<void>;
  tools: Array<{
    name: string;
    description: string;
    parameters: Record<string, any>;
    execute(params: Record<string, any>): Promise<string>;
  }>;
} = {
  name: 'plugin_websearch',
  version: '1.0.0',
  description: '使用 Tavily 进行网页搜索',

  log: defaultLogger,
  config: {
    apiKey: '',
    maxResults: 5,
    searchDepth: 'basic'
  },

  defaultConfig: {
    enabled: false,
    options: {
      apiKey: '',
      maxResults: 5,
      searchDepth: 'basic'
    }
  },

  async fetchTavily(endpoint: string, body: Record<string, any>, apiKey: string): Promise<TavilyResponse> {
    const response = await fetch(`https://api.tavily.com/${endpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`API error ${response.status}: ${errorBody.substring(0, 200)}`, { cause: response });
    }

    return response.json();
  },

  async onLoad(context: PluginContext) {
    if (context.logger) {
      this.log = context.logger.child({ prefix: 'websearch' });
    }

    const options = context.options || {};
    this.config = {
      apiKey: options.apiKey || process.env.TAVILY_API_KEY || '',
      maxResults: options.maxResults || 5,
      searchDepth: options.searchDepth || 'basic'
    };

    if (!this.config.apiKey) {
      this.log.warn('Tavily API key not configured. Set via options.apiKey or TAVILY_API_KEY env');
    } else {
      this.log.info('Websearch plugin loaded', {
        maxResults: this.config.maxResults,
        searchDepth: this.config.searchDepth
      });
    }
  },

  tools: [
    {
      name: 'websearch',
      description: '搜索网页信息；适合时效性问题。',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: '搜索词。'
          },
          max_results: {
            type: 'number',
            description: '结果数；默认 5。'
          },
          search_depth: {
            type: 'string',
            enum: ['basic', 'advanced', 'fast', 'ultra-fast'],
            description: '搜索深度。'
          }
        },
        required: ['query']
      },
      async execute(params: Record<string, any>) {
        const { query, max_results, search_depth } = params;

        if (!query || typeof query !== 'string') {
          throw new Error('query 参数缺失或格式错误');
        }

        if (!plugin.config.apiKey) {
          throw new Error('Tavily API key 未配置');
        }

        try {
          plugin.log.info('Web search started', {
            query: plugin.log.preview(query),
            maxResults: max_results || plugin.config.maxResults,
            searchDepth: search_depth || plugin.config.searchDepth
          });
          const data = await plugin.fetchTavily('search', {
            query,
            max_results: max_results || plugin.config.maxResults,
            search_depth: search_depth || plugin.config.searchDepth,
            include_raw_content: false
          }, plugin.config.apiKey);

          const results = data.results?.map((r: TavilySearchResult | TavilyExtractResult) => ({
            title: 'title' in r ? r.title : undefined,
            url: r.url,
            content: 'content' in r ? r.content?.substring(0, 500) || '' : '',
            score: 'score' in r ? r.score : undefined
          })) || [];

          plugin.log.info('Web search completed', {
            query: plugin.log.preview(query),
            resultCount: results.length
          });
          return JSON.stringify(results);
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : String(error);
          plugin.log.error('Web search failed', {
            query: plugin.log.preview(query),
            error: message
          });
          throw new Error(`搜索失败: ${message}`, { cause: error });
        }
      }
    },
    {
      name: 'web_extract',
      description: '提取网页正文。',
      parameters: {
        type: 'object',
        properties: {
          urls: {
            oneOf: [
              { type: 'string' },
              { type: 'array', items: { type: 'string' } }
            ],
            description: 'URL 或 URL 数组。'
          },
          query: {
            type: 'string',
            description: '可选；用于重排结果。'
          },
          extract_depth: {
            type: 'string',
            enum: ['basic', 'advanced'],
            description: '提取深度。'
          },
          format: {
            type: 'string',
            enum: ['markdown', 'text'],
            description: '返回格式。'
          }
        },
        required: ['urls']
      },
      async execute(params: Record<string, any>) {
        let { urls, query, extract_depth, format } = params;

        if (!plugin.config.apiKey) {
          throw new Error('Tavily API key 未配置');
        }

        // 参数验证和修正：处理 urls 可能是字符串化的数组的情况
        if (!urls) {
          throw new Error('urls 参数缺失');
        }

        // 如果 urls 是字符串，尝试解析
        if (typeof urls === 'string') {
          try {
            // 尝试解析 JSON 字符串（如 "[\"url1\",\"url2\"]"）
            const parsed = JSON.parse(urls);
            if (Array.isArray(parsed)) {
              urls = parsed;
            } else {
              // 如果解析后不是数组，就当作单个 URL
              urls = [urls];
            }
          } catch {
            // 解析失败，当作单个 URL
            urls = [urls];
          }
        } else if (!Array.isArray(urls)) {
          // 如果不是字符串也不是数组，转换为数组
          urls = [String(urls)];
        }

        // 过滤掉无效的 URL
        urls = urls.filter((url: unknown): url is string => typeof url === 'string' && !!url.trim());

        if (urls.length === 0) {
          throw new Error('没有有效的 URL');
        }

        try {
          plugin.log.info('Web extract started', {
            urlCount: urls.length,
            extractDepth: extract_depth || 'basic',
            format: format || 'markdown'
          });
          const data = await plugin.fetchTavily('extract', {
            urls: urls,
            query: query || undefined,
            extract_depth: extract_depth || 'basic',
            format: format || 'markdown'
          }, plugin.config.apiKey);

          const results = data.results?.map((r: TavilySearchResult | TavilyExtractResult) => ({
            url: r.url,
            content: 'raw_content' in r ? r.raw_content?.substring(0, 5000) || '' : ''
          })) || [];

          plugin.log.info('Web extract completed', {
            urlCount: urls.length,
            resultCount: results.length,
            query: typeof query === 'string' ? plugin.log.preview(query) : undefined
          });
          return JSON.stringify(results);
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : String(error);
          plugin.log.error('Web extract failed', { urlCount: urls.length, error: message });
          throw new Error(`提取失败: ${message}`, { cause: error });
        }
      }
    }
  ]
};

export default plugin;
