const plugin: any = {
  name: 'plugin_websearch',
  version: '1.0.0',
  description: '使用 Tavily 进行网页搜索',

  log: console,
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

  async fetchTavily(endpoint, body, apiKey) {
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

  async onLoad(context) {
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
      this.log.info('Websearch plugin loaded');
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
      async execute(params) {
        const { query, max_results, search_depth } = params;

        plugin.log.debug(`websearch execute: query="${query}", max_results=${max_results}, search_depth=${search_depth}`);

        if (!query || typeof query !== 'string') {
          throw new Error('query 参数缺失或格式错误');
        }

        if (!plugin.config.apiKey) {
          throw new Error('Tavily API key 未配置');
        }

        try {
          plugin.log.debug(`Calling Tavily API with query: ${query}`);
          const data = await plugin.fetchTavily('search', {
            query,
            max_results: max_results || plugin.config.maxResults,
            search_depth: search_depth || plugin.config.searchDepth,
            include_raw_content: false
          }, plugin.config.apiKey);

          const results = data.results?.map((r) => ({
            title: r.title,
            url: r.url,
            content: r.content?.substring(0, 500) || '',
            score: r.score
          })) || [];

          plugin.log.info(`Search completed: ${query}, ${results.length} results`);
          return JSON.stringify(results);
        } catch (error) {
          plugin.log.error('Search failed:', error.message);
          throw new Error(`搜索失败: ${error.message}`, { cause: error });
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
      async execute(params) {
        let { urls, query, extract_depth, format } = params;

        plugin.log.debug(`web_extract execute: urls=${JSON.stringify(urls)}, format=${format}`);

        if (!plugin.config.apiKey) {
          throw new Error('Tavily API key 未配置');
        }

        // 参数验证和修正：处理 urls 可能是字符串化的数组的情况
        if (!urls) {
          throw new Error('urls 参数缺失');
        }

        // 如果 urls 是字符串，尝试解析
        if (typeof urls === 'string') {
          plugin.log.debug(`urls is string, attempting to parse: ${urls.substring(0, 100)}`);
          try {
            // 尝试解析 JSON 字符串（如 "[\"url1\",\"url2\"]"）
            const parsed = JSON.parse(urls);
            if (Array.isArray(parsed)) {
              urls = parsed;
              plugin.log.debug(`Successfully parsed urls to array, length: ${urls.length}`);
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
        urls = urls.filter(url => url && typeof url === 'string' && url.trim());

        if (urls.length === 0) {
          throw new Error('没有有效的 URL');
        }

        plugin.log.debug(`Calling Tavily extract API with ${urls.length} URLs`);

        try {
          const data = await plugin.fetchTavily('extract', {
            urls: urls,
            query: query || undefined,
            extract_depth: extract_depth || 'basic',
            format: format || 'markdown'
          }, plugin.config.apiKey);

          const results = data.results?.map((r) => ({
            url: r.url,
            content: r.raw_content?.substring(0, 5000) || ''
          })) || [];

          return JSON.stringify(results);
        } catch (error) {
          plugin.log.error('Extract failed:', error.message);
          throw new Error(`提取失败: ${error.message}`, { cause: error });
        }
      }
    }
  ]
};

export default plugin;
