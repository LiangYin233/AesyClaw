import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  buildHtmlDocument,
  convertHtmlToImage,
  convertMarkdownToImage,
  handleMd2ImgSend,
  isLatex,
  PlaywrightMarkdownRenderer,
} from '../../../extensions/plugin_md2img/index';

function createLogger() {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

async function renderMarkdownHtml(markdown: string): Promise<string> {
  let html = '';
  await convertMarkdownToImage(markdown, '<div id="md2img-root">{{content}}</div>', {
    renderHtmlToPng: async (htmlDocument) => {
      html = htmlDocument;
      return Buffer.from('png-bytes');
    },
  });
  return html;
}

function createFakeBrowserHarness() {
  let disconnectedHandler: (() => void) | undefined;
  let connected = true;
  const screenshot = vi.fn(async () => Uint8Array.from(Buffer.from('png-bytes')));
  const waitFor = vi.fn(async () => undefined);
  const locator = vi.fn(() => ({ waitFor, screenshot }));
  const setContent = vi.fn(async () => undefined);
  const evaluate = vi.fn(async () => undefined);
  const closePage = vi.fn(async () => undefined);
  const page = {
    setContent,
    evaluate,
    locator,
    close: closePage,
  };
  const newPage = vi.fn(async () => page);
  const closeBrowser = vi.fn(async () => undefined);
  const browser = {
    newPage,
    close: closeBrowser,
    isConnected: vi.fn(() => connected),
    once: vi.fn((event: string, handler: () => void) => {
      if (event === 'disconnected') disconnectedHandler = handler;
      return browser;
    }),
  };

  return {
    browser,
    newPage,
    closeBrowser,
    setContent,
    evaluate,
    locator,
    waitFor,
    screenshot,
    closePage,
    disconnect() {
      connected = false;
      disconnectedHandler?.();
    },
    setConnected(value: boolean) {
      connected = value;
    },
  };
}

describe('plugin_md2img', () => {
  it('uses a fixed-width wrapping template rooted for screenshot capture', async () => {
    const template = await readFile(resolve('extensions/plugin_md2img/template.html'), 'utf-8');
    expect(template).toContain('id="md2img-root"');
    expect(template).toMatch(/width:\s*680px/);
    expect(template).toMatch(/word-break:\s*break-word/);
    expect(template).toMatch(/overflow-wrap:\s*anywhere/);
  });

  it('skips conversion when the template is unavailable', async () => {
    const logger = createLogger();
    const result = await handleMd2ImgSend(
      {
        message: { components: [{ type: 'Plain', text: '# Render me' }] },
        sessionKey: { channel: 'onebot', type: 'private', chatId: '123' },
      },
      { htmlTemplate: '', logger, pluginConfig: { enabledChannels: ['*'] } },
    );
    expect(result).toEqual({ action: 'next' });
    expect(logger.debug).not.toHaveBeenCalled();
  });

  it('skips non-markdown messages without debug diagnostics', async () => {
    const logger = createLogger();
    const result = await handleMd2ImgSend(
      {
        message: { components: [{ type: 'Plain', text: 'plain text that should not be logged' }] },
        sessionKey: { channel: 'onebot', type: 'private', chatId: '123' },
      },
      {
        htmlTemplate: '<div id="md2img-root">{{content}}</div>',
        logger,
        pluginConfig: { enabledChannels: ['*'] },
      },
    );
    expect(result).toEqual({ action: 'next' });
    expect(logger.debug).not.toHaveBeenCalled();
  });

  it('skips channel-gated markdown messages without debug diagnostics', async () => {
    const logger = createLogger();
    const result = await handleMd2ImgSend(
      {
        message: { components: [{ type: 'Plain', text: '# Render me' }] },
        sessionKey: { channel: 'discord', type: 'private', chatId: '123' },
      },
      {
        htmlTemplate: '<div id="md2img-root">{{content}}</div>',
        logger,
        pluginConfig: { enabledChannels: ['onebot'] },
      },
    );
    expect(result).toEqual({ action: 'next' });
    expect(logger.debug).not.toHaveBeenCalled();
  });

  it('converts markdown into an image attachment without debug diagnostics', async () => {
    const logger = createLogger();
    const pngBuffer = Buffer.from('png-bytes');
    const result = await handleMd2ImgSend(
      {
        message: { components: [{ type: 'Plain', text: '# Render me' }] },
        sessionKey: { channel: 'onebot', type: 'private', chatId: '123' },
      },
      {
        htmlTemplate: '<div id="md2img-root">{{content}}</div>',
        logger,
        pluginConfig: { enabledChannels: ['onebot'] },
        convert: vi.fn(async () => pngBuffer),
      },
    );
    expect(result).toEqual({
      action: 'respond',
      message: {
        components: [
          { type: 'Image', base64: pngBuffer.toString('base64'), mimeType: 'image/png' },
        ],
      },
    });
    expect(logger.debug).not.toHaveBeenCalled();
  });

  it('preserves non-text media components when converting markdown to image', async () => {
    const logger = createLogger();
    const pngBuffer = Buffer.from('png-bytes');

    const result = await handleMd2ImgSend(
      {
        message: {
          components: [
            { type: 'Plain', text: '# Report' },
            {
              type: 'File',
              url: 'https://example.com/report.pdf',
              mimeType: 'application/pdf',
            },
          ],
        },
        sessionKey: { channel: 'onebot', type: 'private', chatId: '123' },
      },
      {
        htmlTemplate: '<div id="md2img-root">{{content}}</div>',
        logger,
        pluginConfig: { enabledChannels: ['onebot'] },
        convert: vi.fn(async () => pngBuffer),
      },
    );

    expect(result).toEqual({
      action: 'respond',
      message: {
        components: [
          { type: 'Image', base64: pngBuffer.toString('base64'), mimeType: 'image/png' },
          {
            type: 'File',
            url: 'https://example.com/report.pdf',
            mimeType: 'application/pdf',
          },
        ],
      },
    });
  });

  it('logs conversion failures with summary context and error', async () => {
    const logger = createLogger();
    const error = new Error('render failed');
    const result = await handleMd2ImgSend(
      {
        message: { components: [{ type: 'Plain', text: '# Render me' }] },
        sessionKey: { channel: 'onebot', type: 'private', chatId: '123' },
      },
      {
        htmlTemplate: '<div id="md2img-root">{{content}}</div>',
        logger,
        pluginConfig: { enabledChannels: ['onebot'] },
        convert: vi.fn(async () => {
          throw error;
        }),
      },
    );
    expect(result).toEqual({ action: 'next' });
    expect(logger.debug).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(
      'md2img conversion failed',
      { sessionChannel: 'onebot', contentLength: '# Render me'.length },
      error,
    );
  });

  it('passes markdown html into the Playwright render seam', async () => {
    const renderHtmlToPng = vi.fn(async (htmlDocument: string) => {
      expect(htmlDocument).toContain('md2img-root');
      expect(htmlDocument).toContain('<h1>Hello</h1>');
      return Buffer.from('png-bytes');
    });

    const png = await convertMarkdownToImage(
      '# Hello\n\n![diagram](https://example.com/a.png)',
      '<div id="md2img-root">{{content}}</div>',
      { renderHtmlToPng },
    );

    expect(png).toEqual(Buffer.from('png-bytes'));
    expect(renderHtmlToPng).toHaveBeenCalledOnce();
  });

  it('reuses one browser across renders and closes it on destroy', async () => {
    const harness = createFakeBrowserHarness();
    const launchBrowser = vi.fn(async () => harness.browser as never);
    const renderer = new PlaywrightMarkdownRenderer({ launchBrowser });

    const first = await renderer.renderHtmlToPng('<div id="md2img-root">one</div>');
    const second = await renderer.renderHtmlToPng('<div id="md2img-root">two</div>');

    expect(first).toEqual(Buffer.from('png-bytes'));
    expect(second).toEqual(Buffer.from('png-bytes'));
    expect(launchBrowser).toHaveBeenCalledTimes(1);
    expect(harness.newPage).toHaveBeenCalledTimes(2);

    expect(harness.setContent).toHaveBeenCalledTimes(2);
    expect(harness.locator).toHaveBeenCalledWith('#md2img-root');
    expect(harness.evaluate).toHaveBeenCalledTimes(2);

    await renderer.destroy();

    expect(harness.closePage).toHaveBeenCalledTimes(2);
    expect(harness.closeBrowser).toHaveBeenCalledTimes(1);
  });

  it('recreates the browser after a disconnect before the next render', async () => {
    const firstHarness = createFakeBrowserHarness();
    const secondHarness = createFakeBrowserHarness();
    const launchBrowser = vi
      .fn()
      .mockResolvedValueOnce(firstHarness.browser as never)
      .mockResolvedValueOnce(secondHarness.browser as never);
    const renderer = new PlaywrightMarkdownRenderer({ launchBrowser });

    await expect(renderer.renderHtmlToPng('<div id="md2img-root">one</div>')).resolves.toEqual(
      Buffer.from('png-bytes'),
    );

    firstHarness.disconnect();

    await expect(renderer.renderHtmlToPng('<div id="md2img-root">two</div>')).resolves.toEqual(
      Buffer.from('png-bytes'),
    );

    expect(launchBrowser).toHaveBeenCalledTimes(2);
    expect(firstHarness.newPage).toHaveBeenCalledTimes(1);
    expect(secondHarness.newPage).toHaveBeenCalledTimes(1);
  });

  it('waits for font readiness before taking the screenshot', async () => {
    let resolveFontsReady: (() => void) | undefined;
    const harness = createFakeBrowserHarness();
    harness.evaluate.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveFontsReady = resolve;
        }),
    );
    const renderer = new PlaywrightMarkdownRenderer({
      launchBrowser: vi.fn(async () => harness.browser as never),
    });

    const renderPromise = renderer.renderHtmlToPng('<div id="md2img-root">one</div>');

    await vi.waitFor(() => {
      expect(harness.evaluate).toHaveBeenCalledOnce();
    });
    expect(harness.screenshot).not.toHaveBeenCalled();

    resolveFontsReady?.();

    await expect(renderPromise).resolves.toEqual(Buffer.from('png-bytes'));
    expect(harness.screenshot).toHaveBeenCalledOnce();
  });

  it('converts HTML into an image without debug diagnostics', async () => {
    const logger = createLogger();
    const pngBuffer = Buffer.from('png-html-bytes');
    const result = await handleMd2ImgSend(
      {
        message: { components: [{ type: 'Plain', text: '<div><p>Hello</p></div>' }] },
        sessionKey: { channel: 'onebot', type: 'private', chatId: '123' },
      },
      {
        htmlTemplate: '<div id="md2img-root">{{content}}</div>',
        logger,
        pluginConfig: { enabledChannels: ['onebot'] },
        convert: vi.fn(async () => pngBuffer),
      },
    );
    expect(result).toEqual({
      action: 'respond',
      message: {
        components: [
          { type: 'Image', base64: pngBuffer.toString('base64'), mimeType: 'image/png' },
        ],
      },
    });
    expect(logger.debug).not.toHaveBeenCalled();
  });

  it('handles mixed HTML and Markdown by using the Markdown path', async () => {
    const logger = createLogger();
    const pngBuffer = Buffer.from('png-combined-bytes');
    const convertFn = vi.fn(async () => pngBuffer);
    const result = await handleMd2ImgSend(
      {
        message: {
          components: [
            {
              type: 'Plain',
              text: '<table><tr><td>content</td></tr></table>\n\n# 标题\n\n- 列表项',
            },
          ],
        },
        sessionKey: { channel: 'onebot', type: 'private', chatId: '123' },
      },
      {
        htmlTemplate: '<div id="md2img-root">{{content}}</div>',
        logger,
        pluginConfig: { enabledChannels: ['onebot'] },
        convert: convertFn,
      },
    );
    expect(convertFn).toHaveBeenCalledOnce();
    expect(result).toEqual({
      action: 'respond',
      message: {
        components: [
          { type: 'Image', base64: pngBuffer.toString('base64'), mimeType: 'image/png' },
        ],
      },
    });
    expect(logger.debug).not.toHaveBeenCalled();
  });

  it('passes raw HTML into the renderer without markdown parsing', async () => {
    const renderHtmlToPng = vi.fn(async (htmlDocument: string) => {
      expect(htmlDocument).toContain('md2img-root');
      expect(htmlDocument).toContain('<table>');
      expect(htmlDocument).toContain('<tr><td>hello</td></tr>');
      expect(htmlDocument).not.toContain('<p>'); // No markdown wrapping
      return Buffer.from('png-bytes');
    });

    const png = await convertHtmlToImage(
      '<table><tr><td>hello</td></tr></table>',
      '<div id="md2img-root">{{content}}</div>',
      { renderHtmlToPng },
    );

    expect(png).toEqual(Buffer.from('png-bytes'));
    expect(renderHtmlToPng).toHaveBeenCalledOnce();
  });

  // ─── LaTeX detection ───────────────────────────────────────────────

  describe('isLatex', () => {
    it('detects inline math $...$', () => {
      expect(isLatex('The formula $E=mc^2$ is famous.')).toBe(true);
    });

    it('detects display math $$...$$', () => {
      expect(isLatex('$$\\frac{1}{2}$$')).toBe(true);
    });

    it('returns false for plain text without dollar signs', () => {
      expect(isLatex('Just plain text with no math.')).toBe(false);
    });

    it('returns false for escaped dollar signs', () => {
      expect(isLatex('It costs \\$5.00 for coffee.')).toBe(false);
    });

    it('returns false for a lone dollar sign without closing pair', () => {
      expect(isLatex('The price is $5.')).toBe(false);
    });
  });

  // ─── LaTeX Markdown rendering ───────────────────────────────────────

  describe('LaTeX Markdown rendering', () => {
    it('replaces inline $...$ with KaTeX-rendered HTML', async () => {
      const result = await renderMarkdownHtml('The formula $E=mc^2$ is famous.');
      expect(result).not.toContain('$');
      expect(result).toContain('katex');
      expect(result).toContain('katex-html');
    });

    it('replaces display math $$...$$ with KaTeX display HTML', async () => {
      const result = await renderMarkdownHtml('$$\\frac{1}{2}$$');
      expect(result).not.toContain('$$');
      expect(result).toContain('katex-display');
    });

    it('handles both inline and display math in the same text', async () => {
      const result = await renderMarkdownHtml('Inline $a=b$ and display $$\\sum_{i=1}^{n} i$$.');
      expect(result).toContain('katex');
      expect(result).toContain('katex-display');
      expect(result.match(/\$/g)).toBeNull();
    });

    it('does not render math delimiters inside code spans', async () => {
      const result = await renderMarkdownHtml('Use `$not_math$` and $x$.');
      expect(result).toContain('<code>$not_math$</code>');
      expect(result).toContain('katex');
    });

    it('does not crash on bad LaTeX', async () => {
      const result = await renderMarkdownHtml('Bad: $\\invalid$$');
      expect(typeof result).toBe('string');
    });
  });

  // ─── buildHtmlDocument with baseHref ────────────────────────────────

  describe('buildHtmlDocument', () => {
    it('injects <base> tag when baseHref is provided', () => {
      const doc = buildHtmlDocument(
        '<p>test</p>',
        '<html><head></head><body>{{content}}</body></html>',
        'file:///some/dir/',
      );
      expect(doc).toContain('<base');
      expect(doc).toContain('file:///some/dir/');
    });

    it('does not inject <base> tag without baseHref', () => {
      const doc = buildHtmlDocument(
        '<p>test</p>',
        '<html><head></head><body>{{content}}</body></html>',
      );
      expect(doc).not.toContain('<base');
    });
  });

  // ─── HandleMd2ImgSend with LaTeX ───────────────────────────────────

  describe('handleMd2ImgSend LaTeX', () => {
    it('triggers conversion on LaTeX-only content ($...$ without markdown)', async () => {
      const logger = createLogger();
      const pngBuffer = Buffer.from('png-bytes');
      const convert = vi.fn(async () => pngBuffer);

      const result = await handleMd2ImgSend(
        {
          message: { components: [{ type: 'Plain', text: 'The formula $E=mc^2$ is famous.' }] },
          sessionKey: { channel: 'onebot', type: 'private', chatId: '123' },
        },
        {
          htmlTemplate: '<div id="md2img-root">{{content}}</div>',
          logger,
          pluginConfig: { enabledChannels: ['*'] },
          convert,
        },
      );

      expect(result.action).toBe('respond');
      expect(convert).toHaveBeenCalledOnce();
    });

    it('skips plain text without LaTeX, markdown or HTML', async () => {
      const logger = createLogger();
      const convert = vi.fn(async () => Buffer.from('png'));

      const result = await handleMd2ImgSend(
        {
          message: { components: [{ type: 'Plain', text: 'Just a friendly greeting.' }] },
          sessionKey: { channel: 'onebot', type: 'private', chatId: '123' },
        },
        {
          htmlTemplate: '<div id="md2img-root">{{content}}</div>',
          logger,
          pluginConfig: { enabledChannels: ['*'] },
          convert,
        },
      );

      expect(result).toEqual({ action: 'next' });
      expect(convert).not.toHaveBeenCalled();
    });

    it('processes $$...$$ display math as markdown path', async () => {
      const logger = createLogger();
      const pngBuffer = Buffer.from('png-bytes');
      const convert = vi.fn(async () => pngBuffer);

      const result = await handleMd2ImgSend(
        {
          message: { components: [{ type: 'Plain', text: '$$\\int_{0}^{1} x^2 \\, dx$$' }] },
          sessionKey: { channel: 'onebot', type: 'private', chatId: '123' },
        },
        {
          htmlTemplate: '<div id="md2img-root">{{content}}</div>',
          logger,
          pluginConfig: { enabledChannels: ['*'] },
          convert,
        },
      );

      expect(result.action).toBe('respond');
      expect(convert).toHaveBeenCalledOnce();
    });
  });
});
