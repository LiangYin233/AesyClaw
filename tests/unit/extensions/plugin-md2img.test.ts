import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { marked } from 'marked';
import { sanitizeRenderedMarkdownHtml } from '../../../extensions/plugin_md2img/index';

describe('plugin_md2img', () => {
  it('replaces markdown image tags with text placeholders before rendering', () => {
    const html = '<p><img src="https://example.com/a.png" alt="diagram"></p>';

    expect(sanitizeRenderedMarkdownHtml(html)).toBe(
      '<p><span>[diagram: https://example.com/a.png]</span></p>',
    );
  });

  it('escapes image placeholder values', () => {
    const html = '<p><img src="https://example.com/?q=&lt;bad&gt;" alt="a & b"></p>';

    expect(sanitizeRenderedMarkdownHtml(html)).toBe(
      '<p><span>[a &amp; b: https://example.com/?q=&lt;bad&gt;]</span></p>',
    );
  });

  it('removes img tags produced by markdown image syntax', () => {
    const rendered = marked.parse('![a & b](https://example.com/a.png?x=1&y=2)', {
      async: false,
    }) as string;

    const sanitized = sanitizeRenderedMarkdownHtml(rendered);

    expect(sanitized).not.toContain('<img');
    expect(sanitized).toBe(
      '<p><span>[a &amp; b: https://example.com/a.png?x=1&amp;y=2]</span></p>\n',
    );
  });

  it('preserves normal rendered markdown html while stripping scripts and styles', () => {
    const html =
      '<h1>Title</h1><p><strong>bold</strong></p><script>alert(1)</script><style>p{}</style>';

    expect(sanitizeRenderedMarkdownHtml(html)).toBe('<h1>Title</h1><p><strong>bold</strong></p>');
  });

  it('strips unsupported emoji glyphs before satori rendering', () => {
    expect(
      sanitizeRenderedMarkdownHtml('<h1>🗾 旅行计划</h1><p>推荐：✅ 🇯🇵 👨‍👩‍👧 👍🏽 1️⃣ 东京</p>'),
    ).toBe('<h1> 旅行计划</h1><p>推荐：     东京</p>');
  });

  it('uses a fixed-width wrapping template', async () => {
    const template = await readFile(resolve('extensions/plugin_md2img/template.html'), 'utf-8');

    expect(template).toContain('width:680px');
    expect(template).toContain('word-break:break-word');
    expect(template).toContain('overflow-wrap:anywhere');
  });
});
