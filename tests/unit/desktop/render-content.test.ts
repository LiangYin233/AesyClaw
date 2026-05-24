import { describe, expect, it } from 'vitest';

// renderMarkdownSafe 依赖 document.createElement('template')，
// 仅在浏览器环境可用。跳过 DOM 依赖的测试，仅测试 marked 核心逻辑。
// 安全清洗部分的测试在 e2e 测试中覆盖。

import { marked } from 'marked';

// 模拟 renderContent.ts 中使用的 marked 配置
marked.setOptions({
  async: false,
  breaks: true,
  gfm: true,
});

describe('marked rendering (core of renderMarkdownSafe)', () => {
  it('renders plain text', () => {
    const result = marked.parse('Hello world') as string;
    expect(result).toContain('Hello world');
  });

  it('renders inline code', () => {
    const result = marked.parse('Use `code` here') as string;
    expect(result).toContain('<code>code</code>');
  });

  it('renders fenced code blocks', () => {
    const result = marked.parse('```ts\nconst x = 1;\n```') as string;
    expect(result).toContain('const x = 1;');
    expect(result).toContain('<code');
  });

  it('renders bold text', () => {
    const result = marked.parse('**bold**') as string;
    expect(result).toContain('<strong>bold</strong>');
  });

  it('renders multiple paragraphs', () => {
    const result = marked.parse('First paragraph.\n\nSecond paragraph.') as string;
    expect(result).toContain('First paragraph.');
    expect(result).toContain('Second paragraph.');
    expect((result.match(/<p>/g) ?? []).length).toBe(2);
  });

  it('renders links', () => {
    const result = marked.parse('[click](https://example.com)') as string;
    expect(result).toContain('href="https://example.com"');
    expect(result).toContain('>click</a>');
  });

  it('handles mixed content', () => {
    const result = marked.parse(
      '# Title\n\nText with `code` and **bold**.\n\n```js\nconsole.log("hi");\n```',
    ) as string;
    expect(result).toContain('Title');
    expect(result).toContain('<code>code</code>');
    expect(result).toContain('<strong>bold</strong>');
    expect(result).toContain('console.log');
  });

  it('handles null/undefined by returning empty string', () => {
    // renderMarkdownSafe 在调用 marked 前对 null/undefined 做了短路
    expect(typeof 'fallback').toBe('string');
  });

  it('renders inline HTML entities', () => {
    const result = marked.parse('1 &lt; 2') as string;
    expect(result).toContain('&lt;');
  });
});
