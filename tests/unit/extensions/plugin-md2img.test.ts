import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  convertHtmlToImage,
  convertMarkdownToImage,
  handleMd2ImgSend,
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
    expect(result).toEqual({ action: 'continue' });
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
    expect(result).toEqual({ action: 'continue' });
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
    expect(result).toEqual({ action: 'continue' });
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
      components: [{ type: 'Image', base64: pngBuffer.toString('base64'), mimeType: 'image/png' }],
    });
    expect(logger.debug).not.toHaveBeenCalled();
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
    expect(result).toEqual({ action: 'continue' });
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
        convertHtml: vi.fn(async () => pngBuffer),
      },
    );
    expect(result).toEqual({
      action: 'respond',
      components: [{ type: 'Image', base64: pngBuffer.toString('base64'), mimeType: 'image/png' }],
    });
    expect(logger.debug).not.toHaveBeenCalled();
  });

  it('handles mixed HTML and Markdown by using the Markdown path', async () => {
    const logger = createLogger();
    const pngBuffer = Buffer.from('png-combined-bytes');
    const convertMd = vi.fn(async () => pngBuffer);
    const convertHtml = vi.fn(async () => pngBuffer);
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
        convert: convertMd,
        convertHtml,
      },
    );
    expect(convertMd).toHaveBeenCalledOnce();
    expect(convertHtml).not.toHaveBeenCalled();
    expect(result).toEqual({
      action: 'respond',
      components: [{ type: 'Image', base64: pngBuffer.toString('base64'), mimeType: 'image/png' }],
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
});
