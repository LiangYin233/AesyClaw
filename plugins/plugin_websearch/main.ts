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

interface WebsearchOptions {
  apiKey: string;
  maxResults: number;
  searchDepth: TavilySearchDepth;
}

async function fetchTavily(endpoint: string, body: Record<string, any>, apiKey: string): Promise<TavilyResponse> {
  const response = await fetch(`https://api.tavily.com/${endpoint}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`API error ${response.status}: ${errorBody.substring(0, 200)}`, { cause: response });
  }

  return response.json() as Promise<TavilyResponse>;
}

export default {
  name: 'plugin_websearch',
  version: '1.0.0',
  author: 'aesyclaw_official',
  description: '使用 Tavily 进行网页搜索',
  defaultEnabled: false,
  defaultSettings: {
    apiKey: '',
    maxResults: 5,
    searchDepth: 'basic'
  },
   
  setup(ctx: any) {
    // 获取配置的工具函数
    const getConfig = (): WebsearchOptions => {
      const opts = ctx.settings;
      return {
        apiKey: opts.apiKey || process.env.TAVILY_API_KEY || '',
        maxResults: opts.maxResults || 5,
        searchDepth: opts.searchDepth || 'basic'
      };
    };

    ctx.tools.register({
      name: 'web_search',
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
        const config = getConfig();
        const { query, max_results, search_depth } = params;

        if (!query || typeof query !== 'string') {
          throw new Error('query 参数缺失或格式错误');
        }

        if (!config.apiKey) {
          throw new Error('Tavily API key 未配置');
        }

        try {
          const data = await fetchTavily('search', {
            query,
            max_results: max_results || config.maxResults,
            search_depth: search_depth || config.searchDepth,
            include_raw_content: false
          }, config.apiKey);

          const results = data.results?.map((result) => ({
            title: 'title' in result ? result.title : undefined,
            url: result.url,
            content: 'content' in result ? result.content?.substring(0, 500) || '' : '',
            score: 'score' in result ? result.score : undefined
          })) || [];
          return JSON.stringify(results);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          throw new Error(`搜索失败: ${message}`, { cause: error });
        }
      }
    });

    ctx.tools.register({
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
        const config = getConfig();
        let { urls, query, extract_depth, format } = params;

        if (!config.apiKey) {
          throw new Error('Tavily API key 未配置');
        }

        if (!urls) {
          throw new Error('urls 参数缺失');
        }

        if (typeof urls === 'string') {
          try {
            const parsed = JSON.parse(urls);
            urls = Array.isArray(parsed) ? parsed : [urls];
          } catch {
            urls = [urls];
          }
        } else if (!Array.isArray(urls)) {
          urls = [String(urls)];
        }

        urls = urls.filter((url: unknown): url is string => typeof url === 'string' && !!url.trim());

        if (urls.length === 0) {
          throw new Error('没有有效的 URL');
        }

        try {
          const data = await fetchTavily('extract', {
            urls,
            query,
            extract_depth: extract_depth || 'advanced',
            format: format || 'markdown'
          }, config.apiKey);

          const results = data.results?.map((result) => ({
            url: result.url,
            content: 'raw_content' in result ? result.raw_content || '' : ''
          })) || [];
          return JSON.stringify(results);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          throw new Error(`提取失败: ${message}`, { cause: error });
        }
      }
    });
  }
};
