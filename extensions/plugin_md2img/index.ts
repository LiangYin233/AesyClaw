import { marked } from 'marked';
import { chromium } from 'playwright';
import type { Browser } from 'playwright';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import katex from 'katex';
import { validateWithSchema, getMessageText } from '@aesyclaw/sdk';
import type { PluginContext, PluginDefinition } from '@aesyclaw/sdk';
import type { HookCtx, HookResult } from '@aesyclaw/sdk';
import { Md2ImgPluginConfigSchema, type Md2ImgPluginConfig } from './config-schema';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATE_PATH = resolve(__dirname, 'template.html');
const FONT_PATH = resolve(__dirname, 'SourceHanSerif-VF.otf.woff2');
const require = createRequire(import.meta.url);

// ─── Content detection ──────────────────────────────────────────

const MARKDOWN_RE =
  /(?:^|\n)(?:\s*(?:#{1,6}|[*\-+]|\d+\.|```|>|---|\|))|[*_~]{2}|`{1,2}|\[.+?\]\(.+?\)|(?<!\*)\*[^*\n]+\*(?!\*)|(?<!_)_[^_\n]+_(?!_)/;

function isMarkdown(text: string): boolean {
  return MARKDOWN_RE.test(text);
}

const HTML_RE =
  /<\s*(?:html|head|body|div|p|span|h[1-6]|table|ul|ol|li|a|img|br|hr|pre|code|blockquote)\b/i;

function isHtml(text: string): boolean {
  return HTML_RE.test(text);
}

const LATEX_RE = /(?<!\\)\$\$[\s\S]*?\$\$|(?<!\\)\$[\s\S]*?\$/;

function isLatex(text: string): boolean {
  return LATEX_RE.test(text);
}

// ─── LaTeX pre-processor ────────────────────────────────────────

/**
 * Pre-process markdown text to replace $...$ and $$...$$ delimiters
 * with KaTeX-rendered HTML before marked.parse().
 *
 * Display math ($$...$$) is processed first to avoid greedy matching
 * by the inline math ($...$) pass.
 */
function preprocessLatex(markdown: string): string {
  // Display math first
  let result = markdown.replace(
    /(?<!\\)\$\$([\s\S]*?)\$\$/g,
    (_match: string, tex: string) => {
      try {
        return katex.renderToString(tex.trim(), { displayMode: true, throwOnError: false });
      } catch {
        return `$${tex}$$`;
      }
    },
  );
  // Inline math
  result = result.replace(
    /(?<!\\)\$([\s\S]*?)\$/g,
    (_match: string, tex: string) => {
      try {
        return katex.renderToString(tex.trim(), { throwOnError: false });
      } catch {
        return `$${tex}$`;
      }
    },
  );
  return result;
}

// ─── Document builder ───────────────────────────────────────────

/**
 * 将渲染后的 HTML 内容填充到模板中，生成完整的 HTML 文档。
 *
 * @param htmlContent - 渲染后的 HTML 内容（由 marked 生成）
 * @param htmlTemplate - HTML 模板字符串，需包含 {{content}} 占位符
 * @returns 完整的 HTML 文档字符串
 */
export function buildHtmlDocument(htmlContent: string, htmlTemplate: string, baseHref?: string): string {
  let doc = htmlTemplate.replace('{{content}}', htmlContent);
  if (baseHref) {
    doc = doc.replace('<head>', `<head><base href="${baseHref}">`);
  }
  return doc;
}

// ─── Playwright renderer ───────────────────────────────────────

/** HTML 到 PNG 渲染器接口 */
export type Md2ImgHtmlRenderer = {
  renderHtmlToPng(htmlDocument: string): Promise<Buffer>;
  destroy?(): Promise<void>;
};

type PlaywrightMarkdownRendererOptions = {
  launchBrowser?: () => Promise<Browser>;
};

/** 基于 Playwright 无头浏览器的 HTML 到 PNG 渲染器 */
export class PlaywrightMarkdownRenderer implements Md2ImgHtmlRenderer {
  private browser: Browser | null = null;
  private readonly launchBrowserFn: () => Promise<Browser>;

  constructor(options: PlaywrightMarkdownRendererOptions = {}) {
    this.launchBrowserFn = options.launchBrowser ?? (() => chromium.launch({ headless: true }));
  }

  async renderHtmlToPng(htmlDocument: string): Promise<Buffer> {
    const browser = await this.getOrCreateBrowser();
    const page = await browser.newPage({ deviceScaleFactor: 2 });

    try {
      await page.setContent(htmlDocument, { waitUntil: 'domcontentloaded' });

      const root = page.locator('#md2img-root');
      await root.waitFor({ state: 'visible' });

      await page.evaluate(async () => {
        if ('fonts' in document && document.fonts !== undefined) {
          await document.fonts.ready;
          await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        }
      });

      const png = await root.screenshot({ type: 'png' });
      return Buffer.from(png);
    } finally {
      await page.close().catch(() => undefined);
    }
  }

  private async getOrCreateBrowser(): Promise<Browser> {
    if (this.browser?.isConnected()) {
      return this.browser;
    }

    await this.browser?.close().catch(() => undefined);
    this.browser = await this.launchBrowserFn();
    this.browser.once('disconnected', () => {
      this.browser = null;
    });

    return this.browser;
  }

  async destroy(): Promise<void> {
    await this.browser?.close().catch(() => undefined);
    this.browser = null;
  }
}

// ─── Conversion pipeline ────────────────────────────────────────

/** 将文本渲染为 PNG。若 asMarkdown 为 true 则先通过 marked 解析（含 LaTeX 预处理）。 */
async function renderToPng(
  content: string,
  htmlTemplate: string,
  options?: { asMarkdown?: boolean; renderHtmlToPng?: (doc: string) => Promise<Buffer> },
): Promise<Buffer> {
  let html: string;
  if (options?.asMarkdown) {
    const processed = preprocessLatex(content);
    html = marked.parse(processed, { async: false }) as string;
  } else {
    html = content;
  }
  const baseHref = katexDistDir
    ? `file:///${katexDistDir.replace(/\\/g, '/')}/`
    : undefined;
  const htmlDocument = buildHtmlDocument(html, htmlTemplate, baseHref);
  const render = options?.renderHtmlToPng ?? ((doc: string) => getRenderer().renderHtmlToPng(doc));
  return await render(htmlDocument);
}

export async function convertMarkdownToImage(
  markdown: string,
  htmlTemplate: string,
  deps?: { renderHtmlToPng?: (htmlDocument: string) => Promise<Buffer> },
): Promise<Buffer> {
  return await renderToPng(markdown, htmlTemplate, { asMarkdown: true, ...deps });
}

export async function convertHtmlToImage(
  htmlContent: string,
  htmlTemplate: string,
  deps?: { renderHtmlToPng?: (htmlDocument: string) => Promise<Buffer> },
): Promise<Buffer> {
  return await renderToPng(htmlContent, htmlTemplate, deps);
}

// ─── Hook handler ───────────────────────────────────────────────

function resolveEnabledChannels(config: Record<string, unknown>): string[] {
  const enabled = config['enabledChannels'];
  if (Array.isArray(enabled) && enabled.every((v) => typeof v === 'string')) {
    return enabled;
  }
  return ['*'];
}

/**
 * onSend 钩子处理函数。检测 Markdown / HTML / LaTeX 内容并渲染为图片后替换原消息。
 *
 * @param context - 发送上下文
 * @param deps - 依赖项（模板、日志、插件配置、转换函数）
 * @returns 管线结果
 */
export async function handleMd2ImgSend(
  ctx: HookCtx,
  deps: {
    htmlTemplate: string;
    logger: PluginContext['logger'];
    pluginConfig: Record<string, unknown>;
    convert?: (content: string, template: string) => Promise<Buffer>;
  },
): Promise<HookResult> {
  const { message, sessionKey } = ctx;
  const { htmlTemplate: template, logger, pluginConfig: config } = deps;

  const text = getMessageText(message);
  if (!template) {
    return { action: 'next' };
  }

  const isHtmlContent = isHtml(text);
  const isMarkdownContent = isMarkdown(text);
  const hasLatex = isLatex(text);
  if (!isHtmlContent && !isMarkdownContent && !hasLatex) {
    return { action: 'next' };
  }

  const channels = resolveEnabledChannels(config);
  if (!sessionKey?.channel || (!channels.includes('*') && !channels.includes(sessionKey.channel))) {
    return { action: 'next' };
  }

  // LaTeX-only content (no markdown, no HTML) still needs marked.parse()
  // so the preprocessed KaTeX HTML is properly wrapped in a paragraph.
  const shouldRenderAsMarkdown = isMarkdownContent || hasLatex;

  try {
    const convert =
      deps.convert ??
      ((c: string, t: string) => renderToPng(c, t, { asMarkdown: shouldRenderAsMarkdown }));
    const pngBuffer = await convert(text, template);

    const nonTextComponents = message.components.filter((c) => c.type !== 'Plain');

    return {
      action: 'respond',
      message: {
        components: [
          { type: 'Image', base64: pngBuffer.toString('base64'), mimeType: 'image/png' },
          ...nonTextComponents,
        ],
      },
    };
  } catch (err) {
    logger.error(
      'md2img conversion failed',
      { sessionChannel: sessionKey?.channel ?? null, contentLength: text.length },
      err,
    );
    return { action: 'next' };
  }
}

// ─── Plugin definition ──────────────────────────────────────────

const plugin: PluginDefinition = {
  name: 'md2img',
  version: '0.1.0',
  description:
    'Detects Markdown / HTML / LaTeX in LLM output and sends it as a rendered image instead of raw text.',
  defaultConfig: { enabledChannels: ['*'] },
  middlewares: [
    {
      id: 'md2img-send',
      chain: 'pipeline:send',
      priority: 100,
      enabled: true,
      handler: async (ctx, next) => {
        const result = await handleMd2ImgSend(ctx, {
          htmlTemplate,
          // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- initialized in init() before handler runs
          logger: logger!,
          pluginConfig,
        });

        if (result.action !== 'next') return result;
        return await (next?.() ?? { action: 'next' });
      },
    },
  ],
  async init(ctx) {
    const validated = validateWithSchema<Md2ImgPluginConfig>(
      Md2ImgPluginConfigSchema,
      ctx.config,
      `插件配置(md2img)`,
    );
    logger = ctx.logger;
    pluginConfig = validated as unknown as Record<string, unknown>;

    try {
      htmlTemplate = await readFile(TEMPLATE_PATH, 'utf-8');
    } catch {
      logger.warn('Failed to load template.html. md2img plugin will be inactive.');
      return;
    }

    try {
      const fontBase64 = (await readFile(FONT_PATH)).toString('base64');
      htmlTemplate = htmlTemplate.replace('{{fontBase64}}', fontBase64);
      logger.info('md2img initialized with bundled font');
    } catch {
      logger.info('md2img initialized without bundled fonts; browser fallback fonts will be used');
    }

    // ── KaTeX CSS ──────────────────────────────────────────────
    try {
      const katexCssPath = require.resolve('katex/dist/katex.min.css');
      katexDistDir = dirname(katexCssPath);
      const katexCss = await readFile(katexCssPath, 'utf-8');
      htmlTemplate = htmlTemplate.replace('{{katexCss}}', `<style>${katexCss}</style>`);
      logger.info('md2img initialized with KaTeX CSS');
    } catch {
      htmlTemplate = htmlTemplate.replace('{{katexCss}}', '');
      logger.info('md2img initialized without KaTeX CSS; LaTeX may not render correctly');
    }
  },
  async destroy() {
    await getRenderer().destroy();
    htmlTemplate = '';
    logger = undefined;
    pluginConfig = {};
    katexDistDir = undefined;
  },
};

// ─── Module state ───────────────────────────────────────────────

let htmlTemplate = '';
let logger: PluginContext['logger'] | undefined;
let pluginConfig: Record<string, unknown> = {};
let katexDistDir: string | undefined;
let renderer: PlaywrightMarkdownRenderer | null = null;

function getRenderer(): PlaywrightMarkdownRenderer {
  renderer ??= new PlaywrightMarkdownRenderer();
  return renderer;
}

export default plugin;
