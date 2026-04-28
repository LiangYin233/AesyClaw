import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { marked } from 'marked';
import { describe, expect, it, vi } from 'vitest';
import {
  convertMarkdownToImage,
  handleMd2ImgSend,
  PlaywrightMarkdownRenderer,
  sanitizeRenderedMarkdownHtml,
} from '../../../extensions/plugin_md2img/index';

function createLogger() {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

function createFakeBrowserHarness() {
  let disconnectedHandler: (() => void) | undefined;
  let connected = true;
  const screenshot = vi.fn(async () => Uint8Array.from(Buffer.from('png-bytes')));
  const waitFor = vi.fn(async () => undefined);
  const locator = vi.fn(() => ({ waitFor, screenshot }));
  const route = vi.fn(async () => undefined);
  const setContent = vi.fn(async () => undefined);
  const evaluate = vi.fn(async () => undefined);
  const fulfill = vi.fn(async () => undefined);
  const closePage = vi.fn(async () => undefined);
  const page = {
    route,
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
      if (event === 'disconnected') {
        disconnectedHandler = handler;
      }
      return browser;
    }),
  };

  return {
    browser,
    newPage,
    closeBrowser,
    route,
    setContent,
    evaluate,
    fulfill,
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

const testFontPath = resolve('extensions/plugin_md2img/fonts/SourceHanSerif-VF.otf.woff2');
const testFontUrl = 'https://md2img.local/fonts/SourceHanSerif-VF.otf.woff2';
const testFonts = [
  {
    name: 'TestFont',
    path: testFontPath,
    weight: '200 900',
    cssFormat: 'woff2' as const,
    contentType: 'font/woff2' as const,
  },
];

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

  it('preserves normal rendered markdown html while stripping dangerous tags and handlers', () => {
    const html =
      '<h1 onclick="alert(1)">Title</h1><p><strong>bold</strong></p><script>alert(1)</script><style>p{}</style><iframe src="https://example.com"></iframe>';

    expect(sanitizeRenderedMarkdownHtml(html)).toBe('<h1>Title</h1><p><strong>bold</strong></p>');
  });

  it('strips unsupported emoji glyphs before browser rendering', () => {
    expect(
      sanitizeRenderedMarkdownHtml('<h1>🗾 旅行计划</h1><p>推荐：✅ 🇯🇵 👨‍👩‍👧 👍🏽 1️⃣ 东京</p>'),
    ).toBe('<h1> 旅行计划</h1><p>推荐：     东京</p>');
  });

  it('uses a fixed-width wrapping template rooted for screenshot capture', async () => {
    const template = await readFile(resolve('extensions/plugin_md2img/template.html'), 'utf-8');

    expect(template).toContain('id="md2img-root"');
    expect(template).toContain('width:680px');
    expect(template).toContain('word-break:break-word');
    expect(template).toContain('overflow-wrap:anywhere');
  });

  it('skips conversion when the template is unavailable', async () => {
    const logger = createLogger();

    const result = await handleMd2ImgSend(
      {
        message: { content: '# Render me' },
        sessionKey: { channel: 'onebot', type: 'private', chatId: '123' },
      },
      {
        fonts: testFonts,
        htmlTemplate: '',
        logger,
        pluginConfig: { enabledChannels: ['*'] },
      },
    );

    expect(result).toEqual({ action: 'continue' });
    expect(logger.debug).not.toHaveBeenCalled();
  });

  it('skips non-markdown messages without debug diagnostics', async () => {
    const logger = createLogger();

    const result = await handleMd2ImgSend(
      {
        message: { content: 'plain text that should not be logged' },
        sessionKey: { channel: 'onebot', type: 'private', chatId: '123' },
      },
      {
        fonts: testFonts,
        htmlTemplate: '<div id="md2img-root">{{content}}</div>',
        logger,
        pluginConfig: { enabledChannels: ['*'] },
      },
    );

    expect(result).toEqual({ action: 'continue' });
    expect(logger.debug).not.toHaveBeenCalled();
  });

  it('skips channel-gated markdown messages without debug diagnostics', async () => {
    const logger = createLogger();

    const result = await handleMd2ImgSend(
      {
        message: { content: '# Render me' },
        sessionKey: { channel: 'discord', type: 'private', chatId: '123' },
      },
      {
        fonts: testFonts,
        htmlTemplate: '<div id="md2img-root">{{content}}</div>',
        logger,
        pluginConfig: { enabledChannels: ['onebot'] },
      },
    );

    expect(result).toEqual({ action: 'continue' });
    expect(logger.debug).not.toHaveBeenCalled();
  });

  it('converts markdown into an image attachment without debug diagnostics', async () => {
    const logger = createLogger();
    const pngBuffer = Buffer.from('png-bytes');

    const result = await handleMd2ImgSend(
      {
        message: { content: '# Render me' },
        sessionKey: { channel: 'onebot', type: 'private', chatId: '123' },
      },
      {
        fonts: testFonts,
        htmlTemplate: '<div id="md2img-root">{{content}}</div>',
        logger,
        pluginConfig: { enabledChannels: ['onebot'] },
        convert: vi.fn(async () => pngBuffer),
      },
    );

    expect(result).toEqual({
      action: 'respond',
      content: '',
      attachments: [
        {
          type: 'image',
          base64: pngBuffer.toString('base64'),
          mimeType: 'image/png',
        },
      ],
    });
    expect(logger.debug).not.toHaveBeenCalled();
  });

  it('logs conversion failures with summary context and error', async () => {
    const logger = createLogger();
    const error = new Error('render failed');

    const result = await handleMd2ImgSend(
      {
        message: { content: '# Render me' },
        sessionKey: { channel: 'onebot', type: 'private', chatId: '123' },
      },
      {
        fonts: testFonts,
        htmlTemplate: '<div id="md2img-root">{{content}}</div>',
        logger,
        pluginConfig: { enabledChannels: ['onebot'] },
        convert: vi.fn(async () => {
          throw error;
        }),
      },
    );

    expect(result).toEqual({ action: 'continue' });
    expect(logger.debug).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(
      'md2img markdown conversion failed',
      {
        sessionChannel: 'onebot',
        contentLength: '# Render me'.length,
        enabledChannels: ['onebot'],
      },
      error,
    );
  });

  it('passes sanitized html into the Playwright render seam', async () => {
    const logger = createLogger();
    const renderHtmlToPng = vi.fn(async (htmlDocument: string) => {
      expect(htmlDocument).toContain('md2img-root');
      expect(htmlDocument).toContain('<h1>Hello</h1>');
      expect(htmlDocument).not.toContain('<script');
      expect(htmlDocument).not.toContain('<img');
      expect(htmlDocument).toContain('[diagram: https://example.com/a.png]');
      expect(htmlDocument).toContain(`src:url(${JSON.stringify(testFontUrl)})`);
      expect(htmlDocument.match(/src:url\(/g)).toHaveLength(1);
      expect(htmlDocument).toContain('format("woff2")');
      expect(htmlDocument).toContain('font-weight:200 900');
      expect(htmlDocument).not.toContain('data:font/otf;base64');
      expect(htmlDocument).not.toContain('format("opentype")');
      expect(htmlDocument).not.toContain('SourceHanSerifSC-');
      expect(htmlDocument).not.toContain('T1RUTw');
      return Buffer.from('png-bytes');
    });

    const png = await convertMarkdownToImage(
      '# Hello\n\n![diagram](https://example.com/a.png)\n\n<script>alert(1)</script>',
      testFonts,
      '<div id="md2img-root" style="font-family:{{fontFamily}}">{{content}}</div>',
      {
        logger,
        logContext: { sessionChannel: 'onebot', contentLength: 12 },
        renderHtmlToPng,
      },
    );

    expect(png).toEqual(Buffer.from('png-bytes'));
    expect(renderHtmlToPng).toHaveBeenCalledOnce();
    expect(logger.debug).not.toHaveBeenCalled();
  });

  it('logs stage failures without timeout metadata for non-timeout errors', async () => {
    const logger = createLogger();
    const error = new Error('render failed');

    await expect(
      convertMarkdownToImage('# Render me', testFonts, '<div id="md2img-root">{{content}}</div>', {
        logger,
        logContext: { sessionChannel: 'onebot', contentLength: '# Render me'.length },
        renderHtmlToPng: vi.fn(async () => {
          throw error;
        }),
      }),
    ).rejects.toThrow('render failed');

    expect(logger.error).toHaveBeenCalledWith(
      'md2img conversion stage failed',
      {
        sessionChannel: 'onebot',
        contentLength: '# Render me'.length,
        stage: 'page-render',
      },
      error,
    );
  });

  it('logs browser launch timeout failures with timeout metadata', async () => {
    const logger = createLogger();
    const renderer = new PlaywrightMarkdownRenderer({
      launchBrowser: () => new Promise(() => undefined),
    });

    await expect(
      convertMarkdownToImage('# Render me', testFonts, '<div id="md2img-root">{{content}}</div>', {
        logger,
        logContext: { sessionChannel: 'onebot', contentLength: '# Render me'.length },
        renderHtmlToPng: (htmlDocument, timeoutMs) => renderer.renderHtmlToPng(htmlDocument, timeoutMs),
        stageTimeoutMs: 1,
      }),
    ).rejects.toThrow(/timed out/);

    expect(logger.error).toHaveBeenCalledWith(
      'md2img conversion stage failed',
      {
        sessionChannel: 'onebot',
        contentLength: '# Render me'.length,
        stage: 'browser-launch-timeout',
        timeoutMs: 1,
      },
      expect.objectContaining({ message: expect.stringContaining('timed out after 1ms') }),
    );
  });

  it('does not emit a duplicate hook-level error when conversion already logged stage failure', async () => {
    const logger = createLogger();

    const result = await handleMd2ImgSend(
      {
        message: { content: '# Render me' },
        sessionKey: { channel: 'onebot', type: 'private', chatId: '123' },
      },
      {
        fonts: testFonts,
        htmlTemplate: '<div id="md2img-root">{{content}}</div>',
        logger,
        pluginConfig: { enabledChannels: ['onebot'] },
        convert: (markdown, fonts, htmlTemplate, deps) =>
          convertMarkdownToImage(markdown, fonts, htmlTemplate, {
            ...deps,
            renderHtmlToPng: vi.fn(async () => {
              throw new Error('render failed');
            }),
          }),
      },
    );

    expect(result).toEqual({ action: 'continue' });
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledWith(
      'md2img conversion stage failed',
      {
        sessionChannel: 'onebot',
        contentLength: '# Render me'.length,
        enabledChannels: ['onebot'],
        stage: 'page-render',
      },
      expect.objectContaining({ message: 'render failed' }),
    );
  });

  it('closes a late browser launch after timeout to avoid leaks', async () => {
    let resolveBrowser: ((browser: never) => void) | undefined;
    const close = vi.fn(async () => undefined);
    const browser = {
      close,
      isConnected: vi.fn(() => true),
      once: vi.fn(() => browser),
    };
    const renderer = new PlaywrightMarkdownRenderer({
      launchBrowser: () =>
        new Promise((resolve) => {
          resolveBrowser = resolve as typeof resolveBrowser;
        }),
    });

    await expect(renderer.renderHtmlToPng('<div id="md2img-root">one</div>', 1)).rejects.toThrow(/timed out/);

    resolveBrowser?.(browser as never);
    await Promise.resolve();
    await Promise.resolve();

    expect(close).toHaveBeenCalledTimes(1);
  });

  it('retries browser launch after an initial launch failure', async () => {
    const harness = createFakeBrowserHarness();
    const launchBrowser = vi
      .fn()
      .mockRejectedValueOnce(new Error('launch exploded'))
      .mockResolvedValueOnce(harness.browser as never);
    const renderer = new PlaywrightMarkdownRenderer({ launchBrowser });

    await expect(renderer.renderHtmlToPng('<div id="md2img-root">one</div>')).rejects.toThrow(
      'launch exploded',
    );

    await expect(renderer.renderHtmlToPng('<div id="md2img-root">two</div>')).resolves.toEqual(
      Buffer.from('png-bytes'),
    );

    expect(launchBrowser).toHaveBeenCalledTimes(2);
    expect(harness.newPage).toHaveBeenCalledTimes(1);
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
    expect(harness.route).toHaveBeenCalledWith('**/*', expect.any(Function));

    const routeHandler = harness.route.mock.calls[0]?.[1] as
      | ((route: {
          request(): { url(): string };
          fulfill(input: { body: Buffer; contentType: string }): Promise<void>;
          continue(): Promise<void>;
          abort(): Promise<void>;
        }) => Promise<void>)
      | undefined;
    expect(routeHandler).toBeTypeOf('function');

    const fulfillRoute = {
      request: () => ({ url: () => testFontUrl }),
      fulfill: vi.fn(async () => undefined),
      continue: vi.fn(async () => undefined),
      abort: vi.fn(async () => undefined),
    };
    await routeHandler?.(fulfillRoute);
    expect(fulfillRoute.fulfill).toHaveBeenCalledOnce();
    const fulfillArgs = fulfillRoute.fulfill.mock.calls[0]?.[0] as
      | {
          status?: number;
          body?: Buffer;
          contentType?: string;
          headers?: Record<string, string>;
        }
      | undefined;
    expect(fulfillArgs?.status).toBe(200);
    expect(fulfillArgs?.contentType).toBe('font/woff2');
    expect(fulfillArgs?.headers).toEqual({ 'access-control-allow-origin': '*' });
    expect(fulfillArgs?.body).toBeInstanceOf(Buffer);
    expect(fulfillArgs?.body?.byteLength).toBeGreaterThan(0);
    expect(fulfillRoute.continue).not.toHaveBeenCalled();
    expect(fulfillRoute.abort).not.toHaveBeenCalled();

    const continueRoute = {
      request: () => ({ url: () => 'data:text/plain;base64,SGVsbG8=' }),
      fulfill: vi.fn(async () => undefined),
      continue: vi.fn(async () => undefined),
      abort: vi.fn(async () => undefined),
    };
    await routeHandler?.(continueRoute);
    expect(continueRoute.continue).toHaveBeenCalledOnce();
    expect(continueRoute.fulfill).not.toHaveBeenCalled();
    expect(continueRoute.abort).not.toHaveBeenCalled();

    const abortRoute = {
      request: () => ({ url: () => 'https://example.com/font.otf' }),
      fulfill: vi.fn(async () => undefined),
      continue: vi.fn(async () => undefined),
      abort: vi.fn(async () => undefined),
    };
    await routeHandler?.(abortRoute);
    expect(abortRoute.abort).toHaveBeenCalledOnce();
    expect(abortRoute.fulfill).not.toHaveBeenCalled();
    expect(abortRoute.continue).not.toHaveBeenCalled();

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
});
