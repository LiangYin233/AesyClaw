import { marked } from 'marked';
import { chromium } from 'playwright';
import type { Browser } from 'playwright';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { MediaAttachment, PipelineResult } from '../../src/core/types';
import type { PluginContext, PluginDefinition } from '../../src/plugin/plugin-types';
import type { OnSendContext } from '../../src/pipeline/middleware/types';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATE_PATH = resolve(__dirname, 'template.html');
const FONT_PATH = resolve(__dirname, 'SourceHanSerif-VF.otf.woff2');

// ─── Markdown detection ─────────────────────────────────────────

const MARKDOWN_RE =
  /(?:^|\n)(?:\s*(?:#{1,6}|[*\-+]|\d+\.|```|>|---|\|))|[*_~]{2}|`{1,2}|\[.+?\]\(.+?\)|(?<!\*)\*[^*\n]+\*(?!\*)|(?<!_)_[^_\n]+_(?!_)/;

function isMarkdown(text: string): boolean {
  return MARKDOWN_RE.test(text);
}

// ─── Document builder ───────────────────────────────────────────

export function buildMarkdownDocument(htmlContent: string, htmlTemplate: string): string {
  return htmlTemplate.replace('{{content}}', htmlContent);
}

// ─── Playwright renderer ───────────────────────────────────────

export interface Md2ImgHtmlRenderer {
  renderHtmlToPng(htmlDocument: string): Promise<Buffer>;
  destroy?(): Promise<void>;
}

interface PlaywrightMarkdownRendererOptions {
  launchBrowser?: () => Promise<Browser>;
}

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
        if ('fonts' in document && document.fonts) {
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

export async function convertMarkdownToImage(
  markdown: string,
  htmlTemplate: string,
  deps?: { renderHtmlToPng?: (htmlDocument: string) => Promise<Buffer> },
): Promise<Buffer> {
  const html = marked.parse(markdown, { async: false }) as string;
  const htmlDocument = buildMarkdownDocument(html, htmlTemplate);
  const render = deps?.renderHtmlToPng ?? ((doc: string) => getRenderer().renderHtmlToPng(doc));
  return render(htmlDocument);
}

// ─── Hook handler ───────────────────────────────────────────────

function resolveEnabledChannels(config: Record<string, unknown>): string[] {
  const enabled = config.enabledChannels;
  if (Array.isArray(enabled) && enabled.every((v) => typeof v === 'string')) {
    return enabled;
  }
  return ['*'];
}

export async function handleMd2ImgSend(
  context: OnSendContext,
  deps: {
    htmlTemplate: string;
    logger: PluginContext['logger'];
    pluginConfig: Record<string, unknown>;
    convert?: typeof convertMarkdownToImage;
  },
): Promise<PipelineResult> {
  const { message, sessionKey } = context;
  const { htmlTemplate: template, logger, pluginConfig: config } = deps;

  if (!template || !isMarkdown(message.content)) {
    return { action: 'continue' };
  }

  const channels = resolveEnabledChannels(config);
  if (!sessionKey || (!channels.includes('*') && !channels.includes(sessionKey.channel))) {
    return { action: 'continue' };
  }

  try {
    const convert = deps.convert ?? convertMarkdownToImage;
    const pngBuffer = await convert(message.content, template);

    const attachment: MediaAttachment = {
      type: 'image',
      base64: pngBuffer.toString('base64'),
      mimeType: 'image/png',
    };

    return { action: 'respond', content: '', attachments: [attachment] };
  } catch (err) {
    logger.error(
      'md2img conversion failed',
      { sessionChannel: sessionKey?.channel ?? null, contentLength: message.content.length },
      err,
    );
    return { action: 'continue' };
  }
}

// ─── Plugin definition ──────────────────────────────────────────

const plugin: PluginDefinition = {
  name: 'md2img',
  version: '0.1.0',
  description:
    'Detects Markdown in LLM output and sends it as a rendered image instead of raw text.',
  defaultConfig: { enabledChannels: ['*'] },
  hooks: {
    async onSend({ message, sessionKey }) {
      return handleMd2ImgSend(
        { message, sessionKey },
        { htmlTemplate, logger: logger!, pluginConfig },
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

    try {
      const fontBase64 = (await readFile(FONT_PATH)).toString('base64');
      htmlTemplate = htmlTemplate.replace('{{fontBase64}}', fontBase64);
      logger.info('md2img initialized with bundled font');
    } catch {
      logger.info('md2img initialized without bundled fonts; browser fallback fonts will be used');
    }
  },
  async destroy() {
    await getRenderer().destroy();
    htmlTemplate = '';
    logger = undefined;
    pluginConfig = {};
  },
};

// ─── Module state ───────────────────────────────────────────────

let htmlTemplate = '';
let logger: PluginContext['logger'] | undefined;
let pluginConfig: Record<string, unknown> = {};
let renderer: PlaywrightMarkdownRenderer | null = null;

function getRenderer(): PlaywrightMarkdownRenderer {
  renderer ??= new PlaywrightMarkdownRenderer();
  return renderer;
}

export default plugin;
