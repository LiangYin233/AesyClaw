import { marked } from 'marked';
import { chromium } from 'playwright';
import type { Browser } from 'playwright';
import { access, readFile } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { MediaAttachment, PipelineResult } from '../../src/core/types';
import type { PluginContext, PluginDefinition } from '../../src/plugin/plugin-types';
import type { OnSendContext } from '../../src/pipeline/middleware/types';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FONTS_DIR = resolve(__dirname, 'fonts');
const TEMPLATE_PATH = resolve(__dirname, 'template.html');
const MD2IMG_ASYNC_STAGE_TIMEOUT_MS = 10_000;
const SCREENSHOT_ROOT_SELECTOR = '#md2img-root';
const MD2IMG_VIRTUAL_FONT_URL_PREFIX = 'https://md2img.local/fonts/';
const MD2IMG_ERROR_ALREADY_LOGGED = Symbol('md2img-error-already-logged');
const VARIABLE_FONT_FILE = 'SourceHanSerif-VF.otf.woff2';
const VARIABLE_FONT_PATH = resolve(FONTS_DIR, VARIABLE_FONT_FILE);
const md2imgVirtualFontRegistry = new Map<string, Md2ImgFont>();

function getMd2ImgVirtualFontUrl(fontPath: string): string {
  return `${MD2IMG_VIRTUAL_FONT_URL_PREFIX}${encodeURIComponent(basename(fontPath))}`;
}

function registerMd2ImgVirtualFont(font: Md2ImgFont): string {
  const url = getMd2ImgVirtualFontUrl(font.path);
  md2imgVirtualFontRegistry.set(url, font);
  return url;
}

function getMd2ImgVirtualFont(url: string): Md2ImgFont | undefined {
  return md2imgVirtualFontRegistry.get(url);
}

function isMd2ImgVirtualFontUrl(url: string): boolean {
  return url.startsWith(MD2IMG_VIRTUAL_FONT_URL_PREFIX);
}

export function isAllowedMd2ImgRequestUrl(url: string): boolean {
  return (
    url.startsWith('data:') ||
    url.startsWith('about:') ||
    url.startsWith('blob:')
  );
}

// ─── Markdown detection ─────────────────────────────────────────

const MARKDOWN_RE =
  /(?:^|\n)(?:\s*(?:#{1,6}|[*\-+]|\d+\.|```|>|---|\|))|[*_~]{2}|`{1,2}|\[.+?\]\(.+?\)|(?<!\*)\*[^*\n]+\*(?!\*)|(?<!_)_[^_\n]+_(?!_)/;

function isMarkdown(text: string): boolean {
  return MARKDOWN_RE.test(text);
}

function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function decodeHtmlAttribute(text: string): string {
  return text.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|#39);/gi, (entity, value) => {
    const normalized = String(value).toLowerCase();
    if (normalized.startsWith('#x')) {
      return decodeCodePoint(Number.parseInt(normalized.slice(2), 16), entity);
    }
    if (normalized.startsWith('#')) {
      return decodeCodePoint(Number.parseInt(normalized.slice(1), 10), entity);
    }

    switch (normalized) {
      case 'amp':
        return '&';
      case 'lt':
        return '<';
      case 'gt':
        return '>';
      case 'quot':
        return '"';
      case 'apos':
      case '#39':
        return "'";
      default:
        return entity;
    }
  });
}

function decodeCodePoint(codePoint: number, fallback: string): string {
  if (!Number.isInteger(codePoint) || codePoint < 0 || codePoint > 0x10ffff) {
    return fallback;
  }

  return String.fromCodePoint(codePoint);
}

function readHtmlAttribute(tag: string, name: string): string | null {
  const match = new RegExp(`${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag);
  const value = match?.[1] ?? match?.[2] ?? match?.[3];
  return value === undefined ? null : decodeHtmlAttribute(value);
}

const UNSUPPORTED_EMOJI_RE =
  /(?:[\p{Regional_Indicator}]{2}|[\p{Extended_Pictographic}\p{Emoji_Presentation}](?:[\uFE0E\uFE0F]|\p{Emoji_Modifier})?(?:\u200D[\p{Extended_Pictographic}\p{Emoji_Presentation}](?:[\uFE0E\uFE0F]|\p{Emoji_Modifier})?)*|[#*0-9]\uFE0F?\u20E3|\uFE0F)/gu;

function stripUnsupportedEmoji(text: string): string {
  return text.replace(UNSUPPORTED_EMOJI_RE, '');
}

export function sanitizeRenderedMarkdownHtml(unsafeHtml: string): string {
  return stripUnsupportedEmoji(unsafeHtml)
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<(?:iframe|object|embed|link|meta)\b[^>]*>(?:[\s\S]*?<\/(?:iframe|object|embed)>)?/gi, '')
    .replace(/\son\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/<img\b[^>]*>/gi, (tag) => {
      const alt = readHtmlAttribute(tag, 'alt');
      const src = readHtmlAttribute(tag, 'src');
      const label = alt && alt.length > 0 ? alt : 'image';
      const suffix = src && src.length > 0 ? `: ${src}` : '';
      return `<span>[${escapeHtml(label)}${escapeHtml(suffix)}]</span>`;
    });
}

// ─── Font loading ───────────────────────────────────────────────

const FONT_NAME = 'SourceHanSerifSC';
const DEFAULT_FONT_STACK = `"${FONT_NAME}", "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif`;

type Md2ImgFont = {
  name: string;
  path: string;
  weight: number | string;
  cssFormat: 'opentype' | 'woff2';
  contentType: 'font/otf' | 'font/woff2';
};

async function loadFonts(): Promise<Md2ImgFont[]> {
  try {
    await access(VARIABLE_FONT_PATH);
  } catch {
    return [];
  }

  return [
    {
      name: FONT_NAME,
      path: VARIABLE_FONT_PATH,
      weight: '200 900',
      cssFormat: 'woff2',
      contentType: 'font/woff2',
    },
  ];
}

function buildFontFaceCss(rawFonts: Md2ImgFont[]): string {
  return rawFonts
    .map(
      (font) =>
        `@font-face{font-family:${JSON.stringify(font.name)};src:url(${JSON.stringify(registerMd2ImgVirtualFont(font))}) format(${JSON.stringify(font.cssFormat)});font-weight:${font.weight};font-style:normal;font-display:block;}`,
    )
    .join('');
}

export function buildMarkdownDocument(
  sanitizedHtml: string,
  rawFonts: Md2ImgFont[],
  htmlTemplate: string,
): string {
  const htmlContent = htmlTemplate
    .replace('{{fontFamily}}', DEFAULT_FONT_STACK)
    .replace('{{content}}', sanitizedHtml);

  return [
    '<!DOCTYPE html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    '<style>',
    'html,body{margin:0;padding:0;background:#f5f7fb;}',
    'body{padding:24px;display:flex;justify-content:center;align-items:flex-start;}',
    buildFontFaceCss(rawFonts),
    '</style>',
    '</head>',
    '<body>',
    htmlContent,
    '</body>',
    '</html>',
  ].join('');
}

// ─── Markdown → Image pipeline ─────────────────────────────────

type Md2ImgStage = 'browser-launch' | 'page-render' | 'png-screenshot';

class Md2ImgStageError extends Error {
  constructor(
    public readonly stage: Md2ImgStage,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'Md2ImgStageError';
  }
}

class Md2ImgStageTimeoutError extends Error {
  constructor(
    public readonly stage: Md2ImgStage,
    public readonly timeoutMs: number,
  ) {
    super(`md2img ${stage} timed out after ${timeoutMs}ms`);
    this.name = 'Md2ImgStageTimeoutError';
  }
}

function wrapMd2ImgStageError(stage: Md2ImgStage, err: unknown): Error {
  if (err instanceof Md2ImgStageError || err instanceof Md2ImgStageTimeoutError) {
    return err;
  }

  const message = err instanceof Error ? err.message : String(err);
  return new Md2ImgStageError(stage, `md2img ${stage} failed: ${message}`, { cause: err });
}

function summarizeMd2ImgStageFailure(
  stage:
    | Md2ImgStage
    | 'browser-launch-timeout'
    | 'page-render-timeout'
    | 'png-screenshot-timeout',
  logContext: Record<string, unknown>,
  timeoutMs: number,
  extraContext: Record<string, unknown> = {},
) {
  return {
    ...logContext,
    stage,
    ...extraContext,
    ...(stage.endsWith('-timeout') ? { timeoutMs } : {}),
  };
}

function getMd2ImgFailureStage(
  err: unknown,
): Md2ImgStage | 'browser-launch-timeout' | 'page-render-timeout' | 'png-screenshot-timeout' {
  if (err instanceof Md2ImgStageTimeoutError) {
    switch (err.stage) {
      case 'browser-launch':
        return 'browser-launch-timeout';
      case 'page-render':
        return 'page-render-timeout';
      case 'png-screenshot':
        return 'png-screenshot-timeout';
    }
  }

  if (err instanceof Md2ImgStageError) {
    return err.stage;
  }

  return 'page-render';
}

function isMd2ImgBrowserClosedError(err: unknown): boolean {
  if (!(err instanceof Error)) {
    return false;
  }

  return /target page, context or browser has been closed|browser has been closed|browser has disconnected/i.test(
    err.message,
  );
}

function markMd2ImgErrorLogged(err: unknown): void {
  if (err && typeof err === 'object') {
    Reflect.set(err, MD2IMG_ERROR_ALREADY_LOGGED, true);
  }
}

function wasMd2ImgErrorLogged(err: unknown): boolean {
  return !!(err && typeof err === 'object' && Reflect.get(err, MD2IMG_ERROR_ALREADY_LOGGED) === true);
}

export async function withMd2ImgStageTimeout<T>(
  stage: Md2ImgStage,
  operation: Promise<T>,
  timeoutMs = MD2IMG_ASYNC_STAGE_TIMEOUT_MS,
): Promise<T> {
  let timeoutHandle: NodeJS.Timeout | undefined;

  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timeoutHandle = setTimeout(() => {
          reject(new Md2ImgStageTimeoutError(stage, timeoutMs));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
}

export interface Md2ImgHtmlRenderer {
  renderHtmlToPng(htmlDocument: string, timeoutMs?: number): Promise<Buffer>;
  destroy?(): Promise<void>;
}

interface PlaywrightMarkdownRendererDependencies {
  launchBrowser?: () => Promise<Browser>;
}

export class PlaywrightMarkdownRenderer implements Md2ImgHtmlRenderer {
  private browserPromise: Promise<Browser> | null = null;

  constructor(private readonly deps: PlaywrightMarkdownRendererDependencies = {}) {}

  async renderHtmlToPng(
    htmlDocument: string,
    timeoutMs = MD2IMG_ASYNC_STAGE_TIMEOUT_MS,
  ): Promise<Buffer> {
    const browser = await this.ensureBrowser(timeoutMs);
    let page: Awaited<ReturnType<Browser['newPage']>> | null = null;

    try {
      page = await this.runStage('page-render', browser.newPage({ deviceScaleFactor: 2 }), timeoutMs);
      await this.runStage(
        'page-render',
        page.route('**/*', async (route) => {
          const url = route.request().url();
          const font = getMd2ImgVirtualFont(url);
          if (font) {
            await route.fulfill({
              status: 200,
              body: await readFile(font.path),
              contentType: font.contentType,
              headers: { 'access-control-allow-origin': '*' },
            });
            return;
          }

          if (isMd2ImgVirtualFontUrl(url)) {
            await route.abort();
            return;
          }

          if (isAllowedMd2ImgRequestUrl(url)) {
            await route.continue();
            return;
          }

          await route.abort();
        }),
        timeoutMs,
      );
      await this.runStage(
        'page-render',
        page.setContent(htmlDocument, { waitUntil: 'domcontentloaded' }),
        timeoutMs,
      );

      const root = page.locator(SCREENSHOT_ROOT_SELECTOR);
      await this.runStage('page-render', root.waitFor({ state: 'visible' }), timeoutMs);
      await this.runStage(
        'page-render',
        page.evaluate(async () => {
          if (!('fonts' in document) || !document.fonts) {
            return;
          }

          await document.fonts.ready;
          await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        }),
        timeoutMs,
      );

      const png = await this.runStage('png-screenshot', root.screenshot({ type: 'png' }), timeoutMs);
      return Buffer.from(png);
    } catch (err) {
      if (this.shouldResetBrowser(browser, err)) {
        this.browserPromise = null;
        await browser.close().catch(() => undefined);
      }
      throw err;
    } finally {
      await page?.close().catch(() => undefined);
    }
  }

  async destroy(): Promise<void> {
    const browserPromise = this.browserPromise;
    this.browserPromise = null;

    if (!browserPromise) {
      return;
    }

    const browser = await browserPromise.catch(() => null);
    await browser?.close().catch(() => undefined);
  }

  private async ensureBrowser(timeoutMs: number): Promise<Browser> {
    if (this.browserPromise) {
      const existingBrowser = await this.browserPromise.catch((err) => {
        this.browserPromise = null;
        throw err;
      });

      if (this.isBrowserUsable(existingBrowser)) {
        return existingBrowser;
      }

      this.browserPromise = null;
      await existingBrowser.close().catch(() => undefined);
    }

    const browserOperation = (this.deps.launchBrowser ?? (() => chromium.launch({ headless: true })))();
    const launchPromise = this.runStage('browser-launch', browserOperation, timeoutMs)
      .then((browser) => {
        browser.once('disconnected', () => {
          if (this.browserPromise === launchPromise) {
            this.browserPromise = null;
          }
        });

        if (!this.isBrowserUsable(browser)) {
          this.browserPromise = null;
          throw new Md2ImgStageError(
            'browser-launch',
            'md2img browser-launch failed: browser disconnected before first use',
          );
        }

        return browser;
      })
      .catch((err) => {
        if (this.browserPromise === launchPromise) {
          this.browserPromise = null;
        }
        throw err;
      });

    void browserOperation
      .then((browser) => {
        if (this.browserPromise !== launchPromise) {
          void browser.close().catch(() => undefined);
        }
      })
      .catch(() => undefined);

    this.browserPromise = launchPromise;

    return this.browserPromise;
  }

  private isBrowserUsable(browser: Browser): boolean {
    return typeof browser.isConnected !== 'function' || browser.isConnected();
  }

  private shouldResetBrowser(browser: Browser, err: unknown): boolean {
    return !this.isBrowserUsable(browser) || isMd2ImgBrowserClosedError(err);
  }

  private async runStage<T>(stage: Md2ImgStage, operation: Promise<T>, timeoutMs: number): Promise<T> {
    try {
      return await withMd2ImgStageTimeout(stage, operation, timeoutMs);
    } catch (err) {
      throw wrapMd2ImgStageError(stage, err);
    }
  }
}

interface Md2ImgConversionDependencies {
  logger?: PluginContext['logger'];
  logContext?: Record<string, unknown>;
  renderHtmlToPng?: (htmlDocument: string, timeoutMs?: number) => Promise<Buffer>;
  stageTimeoutMs?: number;
}

function getMd2ImgRenderer(): Md2ImgHtmlRenderer {
  md2imgRenderer ??= new PlaywrightMarkdownRenderer();
  return md2imgRenderer;
}

export async function convertMarkdownToImage(
  markdown: string,
  rawFonts: Md2ImgFont[],
  htmlTemplate: string,
  deps: Md2ImgConversionDependencies = {},
): Promise<Buffer> {
  const { logger: currentLogger, logContext = {}, renderHtmlToPng, stageTimeoutMs } = deps;

  const unsafeHtml = marked.parse(markdown, { async: false }) as string;
  const sanitized = sanitizeRenderedMarkdownHtml(unsafeHtml);
  const htmlDocument = buildMarkdownDocument(sanitized, rawFonts, htmlTemplate);

  let png: Buffer;
  try {
    const renderHtml =
      renderHtmlToPng ?? ((html: string, timeoutMs?: number) => getMd2ImgRenderer().renderHtmlToPng(html, timeoutMs));
    png = await renderHtml(htmlDocument, stageTimeoutMs);
  } catch (err) {
    currentLogger?.error(
      'md2img conversion stage failed',
      summarizeMd2ImgStageFailure(
        getMd2ImgFailureStage(err),
        logContext,
        err instanceof Md2ImgStageTimeoutError
          ? err.timeoutMs
          : stageTimeoutMs ?? MD2IMG_ASYNC_STAGE_TIMEOUT_MS,
      ),
      err,
    );
    markMd2ImgErrorLogged(err);
    throw err;
  }

  return png;
}

interface Md2ImgSendHookDependencies {
  fonts: Md2ImgFont[];
  htmlTemplate: string;
  logger: PluginContext['logger'];
  pluginConfig: Record<string, unknown>;
  convert?: typeof convertMarkdownToImage;
}

function resolveEnabledChannels(config: Record<string, unknown>): string[] {
  const enabledChannels = config.enabledChannels;
  if (Array.isArray(enabledChannels) && enabledChannels.every((value) => typeof value === 'string')) {
    return enabledChannels;
  }

  return ['*'];
}

function summarizeMd2ImgContext(context: OnSendContext, enabledChannels?: string[]) {
  return {
    sessionChannel: context.sessionKey?.channel ?? null,
    contentLength: context.message.content.length,
    ...(enabledChannels ? { enabledChannels } : {}),
  };
}

export async function handleMd2ImgSend(
  context: OnSendContext,
  deps: Md2ImgSendHookDependencies,
): Promise<PipelineResult> {
  const { message, sessionKey } = context;
  const { fonts: availableFonts, htmlTemplate: template, logger: currentLogger, pluginConfig: config } =
    deps;

  if (!template) {
    return { action: 'continue' };
  }

  if (!isMarkdown(message.content)) {
    return { action: 'continue' };
  }

  const channels = resolveEnabledChannels(config);
  if (!sessionKey || (!channels.includes('*') && !channels.includes(sessionKey.channel))) {
    return { action: 'continue' };
  }

  try {
    const convert = deps.convert ?? convertMarkdownToImage;
    const conversionContext = summarizeMd2ImgContext(context, channels);
    const pngBuffer = await convert(message.content, availableFonts, template, {
      logger: currentLogger,
      logContext: conversionContext,
    });

    const attachment: MediaAttachment = {
      type: 'image',
      base64: pngBuffer.toString('base64'),
      mimeType: 'image/png',
    };

    return { action: 'respond', content: '', attachments: [attachment] };
  } catch (err) {
    if (!wasMd2ImgErrorLogged(err)) {
      currentLogger.error('md2img markdown conversion failed', summarizeMd2ImgContext(context, channels), err);
    }
    return { action: 'continue' };
  }
}

// ─── Plugin definition ──────────────────────────────────────────

const plugin: PluginDefinition = {
  name: 'md2img',
  version: '0.1.0',
  description: 'Detects Markdown in LLM output and sends it as a rendered image instead of raw text.',
  defaultConfig: {
    enabledChannels: ['*'],
  },
  hooks: {
    async onSend({ message, sessionKey }) {
      return handleMd2ImgSend(
        { message, sessionKey },
        { fonts, htmlTemplate, logger: logger!, pluginConfig },
      );
    },
  },
  async init(ctx) {
    logger = ctx.logger;
    pluginConfig = ctx.config as Record<string, unknown>;

    try {
      htmlTemplate = await readFile(TEMPLATE_PATH, 'utf-8');
    } catch {
      logger.warn('Failed to load template.html. md2img plugin will be inactive.');
      return;
    }

    fonts = await loadFonts();

    if (fonts.length === 0) {
      logger.info('md2img initialized without bundled fonts; browser fallback fonts will be used');
      return;
    }

    logger.info(
      `md2img initialized with ${fonts.length} bundled font(s): ${fonts.map((font) => `${font.name}(${font.weight})`).join(', ')}`,
    );
  },
  async destroy() {
    const activeRenderer = md2imgRenderer;
    md2imgRenderer = null;
    await activeRenderer?.destroy?.();
    fonts = [];
    htmlTemplate = '';
    logger = undefined;
  },
};

// ─── Module state ───────────────────────────────────────────────

let htmlTemplate = '';
let fonts: Md2ImgFont[] = [];
let logger: PluginContext['logger'] | undefined;
let pluginConfig: Record<string, unknown> = {};
let md2imgRenderer: Md2ImgHtmlRenderer | null = null;

export default plugin;
