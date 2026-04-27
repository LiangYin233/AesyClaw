import { marked } from 'marked';
import { html } from 'satori-html';
import satori from 'satori';
import sharp from 'sharp';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PluginDefinition, PluginContext } from '../../src/plugin/plugin-types';
import type { MediaAttachment } from '../../src/core/types';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FONTS_DIR = resolve(__dirname, 'fonts');
const TEMPLATE_PATH = resolve(__dirname, 'template.html');

// ─── Markdown detection ─────────────────────────────────────────

const MARKDOWN_RE = /(?:^|\n)(?:\s*(?:#{1,6}|[*\-+]|\d+\.|```|>|---|\|))|[*_~]{2}|`{1,2}|\[.+?\]\(.+?\)/;

function isMarkdown(text: string): boolean {
  return MARKDOWN_RE.test(text);
}

// ─── Font loading ───────────────────────────────────────────────

const FONT_FILE = 'SourceHanSerif-VF.otf';
const FONT_NAME = 'SourceHanSerif';

async function loadFont(): Promise<{ name: string; data: Buffer; weight: number } | null> {
  const fontPath = resolve(FONTS_DIR, FONT_FILE);
  try {
    const data = await readFile(fontPath);
    return { name: FONT_NAME, data, weight: 400 };
  } catch {
    return null;
  }
}

// ─── Markdown → Image pipeline ─────────────────────────────────

async function convertMarkdownToImage(
  markdown: string,
  rawFonts: { name: string; data: Buffer; weight: number }[],
  htmlTemplate: string,
): Promise<Buffer> {
  const unsafeHtml = marked.parse(markdown, { async: false }) as string;

  const sanitized = unsafeHtml
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '');

  const fontFamily = rawFonts[0]?.name ?? 'sans-serif';
  const htmlContent = htmlTemplate
    .replace('{{fontFamily}}', fontFamily)
    .replace('{{content}}', sanitized);

  const vdom = html(htmlContent);
  const width = 680;
  const svg = await satori(vdom as never, { width, fonts: rawFonts as never, height: 800 });
  const png = await sharp(Buffer.from(svg)).png().toBuffer();
  return png;
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
      if (!fonts.length || !isMarkdown(message.content)) {
        return { action: 'continue' };
      }

      const cfg = pluginConfig;
      const channels = cfg.enabledChannels as string[];
      if (!sessionKey || (!channels.includes('*') && !channels.includes(sessionKey.channel))) {
        return { action: 'continue' };
      }

      try {
        const pngBuffer = await convertMarkdownToImage(message.content, fonts, htmlTemplate);
        const base64 = pngBuffer.toString('base64');

        const attachment: MediaAttachment = {
          type: 'image',
          base64,
          mimeType: 'image/png',
        };

        return { action: 'respond', content: '', attachments: [attachment] };
      } catch (err) {
        logger.error('Failed to convert markdown to image', err);
        return { action: 'continue' };
      }
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

    const loaded = await loadFont();
    if (!loaded) {
      logger.warn(`Font file "${FONT_FILE}" not found in fonts/ directory. md2img plugin will be inactive.`);
      return;
    }
    fonts = [loaded];

    logger.info(`md2img initialized with font: ${FONT_NAME}`);
  },
  async destroy() {
    fonts = [];
    htmlTemplate = '';
    logger = undefined as unknown as PluginContext['logger'];
  },
};

// ─── Module state ───────────────────────────────────────────────

let htmlTemplate = '';
let fonts: { name: string; data: Buffer; weight: number }[] = [];
let logger: PluginContext['logger'];
let pluginConfig: Record<string, unknown> = {};

export default plugin;
