let log = console;
let config = {
  apiKey: '',
  maxResults: 5,
  searchDepth: 'basic'
};

async function fetchTavily(endpoint, body, apiKey) {
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
    throw new Error(`API error ${response.status}: ${errorBody.substring(0, 200)}`);
  }
  
  return response.json();
}

const plugin = {
  name: 'websearch',
  version: '1.0.0',
  description: '使用 Tavily 进行网页搜索',
  defaultConfig: {
    enabled: false,
    options: {
      apiKey: '',
      maxResults: 5,
      searchDepth: 'basic'
    }
  },

  async onLoad(context) {
    if (context.logger) {
      log = context.logger.child({ prefix: 'websearch' });
    }
    
    const options = context.options || {};
    config = {
      apiKey: options.apiKey || process.env.TAVILY_API_KEY || '',
      maxResults: options.maxResults || 5,
      searchDepth: options.searchDepth || 'basic'
    };
    
    if (!config.apiKey) {
      log.warn('Tavily API key not configured. Set via options.apiKey or TAVILY_API_KEY env');
    } else {
      log.info('Websearch plugin loaded');
    }
  },

  tools: [
    {
      name: 'websearch',
      description: 'A web search tool that uses Tavily to search the web for relevant content. Ideal for gathering current information, news, and detailed web content analysis.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: '搜索查询语句'
          },
          max_results: {
            type: 'number',
            description: '最大返回结果数，默认5'
          },
          search_depth: {
            type: 'string',
            enum: ['basic', 'advanced', 'fast', 'ultra-fast'],
            description: '搜索深度：basic-平衡模式，advanced-高精度模式，fast-快速模式'
          }
        },
        required: ['query']
      },
      execute: async (params) => {
        const { query, max_results, search_depth } = params;
        
        if (!config.apiKey) {
          return '错误: Tavily API key 未配置';
        }
        
        try {
          const data = await fetchTavily('search', {
            query,
            max_results: max_results || config.maxResults,
            search_depth: search_depth || config.searchDepth,
            include_raw_content: false
          }, config.apiKey);
          
          const results = data.results?.map((r) => ({
            title: r.title,
            url: r.url,
            content: r.content?.substring(0, 500) || '',
            score: r.score
          })) || [];
          
          log.info(`Search completed: ${query}, ${results.length} results`);
          return JSON.stringify(results);
        } catch (error) {
          log.error('Search failed:', error.message);
          return `搜索失败: ${error.message}`;
        }
      }
    },
    {
      name: 'web_extract',
      description: 'Extract the content of a web page using Tavily.',
      parameters: {
        type: 'object',
        properties: {
          urls: {
            oneOf: [
              { type: 'string' },
              { type: 'array', items: { type: 'string' } }
            ],
            description: '要提取内容的URL，可以是单个URL或URL数组'
          },
          query: {
            type: 'string',
            description: '可选，用于重排序提取的内容'
          },
          extract_depth: {
            type: 'string',
            enum: ['basic', 'advanced'],
            description: '提取深度：basic-基本提取，advanced-深度提取（包含表格等）'
          },
          format: {
            type: 'string',
            enum: ['markdown', 'text'],
            description: '返回格式：markdown或text'
          }
        },
        required: ['urls']
      },
      execute: async (params) => {
        const { urls, query, extract_depth, format } = params;
        
        if (!config.apiKey) {
          return '错误: Tavily API key 未配置';
        }
        
        try {
          const data = await fetchTavily('extract', {
            urls: Array.isArray(urls) ? urls : [urls],
            query: query || undefined,
            extract_depth: extract_depth || 'basic',
            format: format || 'markdown'
          }, config.apiKey);
          
          const results = data.results?.map((r) => ({
            url: r.url,
            content: r.raw_content?.substring(0, 5000) || ''
          })) || [];
          
          return JSON.stringify(results);
        } catch (error) {
          log.error('Extract failed:', error.message);
          return `提取失败: ${error.message}`;
        }
      }
    }
  ]
};

export default plugin;
