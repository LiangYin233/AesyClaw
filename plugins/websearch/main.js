let log = console;

const plugin = {
  name: 'websearch',
  version: '1.0.0',
  description: '使用 Tavily 进行网页搜索',

  config: {
    apiKey: '',
    maxResults: 5,
    includeAnswer: true,
    searchDepth: 'basic'
  },

  async onLoad(context) {
    if (context.logger) {
      log = context.logger.child({ prefix: 'websearch' });
    }
    
    const options = context.options || {};
    this.config = {
      apiKey: options.apiKey || process.env.TAVILY_API_KEY || '',
      maxResults: options.maxResults || 5,
      includeAnswer: options.includeAnswer ?? true,
      searchDepth: options.searchDepth || 'basic'
    };
    
    if (!this.config.apiKey) {
      log.warn('Tavily API key not configured. Set via options.apiKey or TAVILY_API_KEY env');
    } else {
      log.info('Websearch plugin loaded');
    }
  },

  tools: [
    {
      name: 'websearch',
      description: '使用 Tavily 搜索网页，获取相关信息',
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
          },
          include_answer: {
            type: 'boolean',
            description: '是否包含AI生成的答案'
          }
        },
        required: ['query']
      },
      execute: async (params) => {
        const { query, max_results, search_depth, include_answer } = params;
        
        if (!this.config.apiKey) {
          return JSON.stringify({
            success: false,
            error: 'Tavily API key 未配置'
          });
        }
        
        try {
          const response = await fetch('https://api.tavily.com/search', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              query,
              max_results: max_results || this.config.maxResults,
              search_depth: search_depth || this.config.searchDepth,
              include_answer: include_answer ?? this.config.includeAnswer,
              include_raw_content: false
            })
          });
          
          if (!response.ok) {
            const error = await response.json();
            return JSON.stringify({
              success: false,
              error: `API error: ${error.detail?.error || response.statusText}`
            });
          }
          
          const data = await response.json();
          
          const results = data.results?.map((r) => ({
            title: r.title,
            url: r.url,
            content: r.content?.substring(0, 500) || '',
            score: r.score
          })) || [];
          
          const answer = data.answer ? `\n\n## AI 答案\n${data.answer}` : '';
          
          const formatted = `## 搜索结果: ${query}${answer}

${results.map((r, i) => `${i + 1}. [${r.title}](${r.url})
${r.content}
`).join('\n')}`;
          
          log.info(`Search completed: ${query}, ${results.length} results`);
          
          return formatted;
        } catch (error) {
          log.error('Search failed:', error.message);
          return `搜索失败: ${error.message}`;
        }
      }
    },
    {
      name: 'web_extract',
      description: '从指定URL提取网页内容',
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
        
        if (!this.config.apiKey) {
          return JSON.stringify({
            success: false,
            error: 'Tavily API key 未配置'
          });
        }
        
        try {
          const urlList = Array.isArray(urls) ? urls : [urls];
          
          const response = await fetch('https://api.tavily.com/extract', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              urls: urlList,
              query: query || undefined,
              extract_depth: extract_depth || 'basic',
              format: format || 'markdown'
            })
          });
          
          if (!response.ok) {
            const error = await response.json();
            return JSON.stringify({
              success: false,
              error: `API error: ${error.detail?.error || response.statusText}`
            });
          }
          
          const data = await response.json();
          
          const results = data.results || [];
          const failed = data.failed_results || [];
          
          let output = '## 网页内容提取结果\n\n';
          
          for (const result of results) {
            const content = result.raw_content?.substring(0, 3000) || '无内容';
            output += `### ${result.url}\n\n${content}\n\n---\n\n`;
          }
          
          if (failed.length > 0) {
            output += '### 提取失败的URL\n\n';
            for (const f of failed) {
              output += `- ${f.url}: ${f.error}\n`;
            }
          }
          
          log.info(`Extract completed: ${urlList.length} URLs, ${failed.length} failed`);
          
          return output.trim();
        } catch (error) {
          log.error('Extract failed:', error.message);
          return `提取失败: ${error.message}`;
        }
      }
    }
  ]
};

export default plugin;
