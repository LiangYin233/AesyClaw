import { marked } from 'marked';
import { html } from 'satori-html';
import satori from 'satori';
import sharp from 'sharp';
import { readFile, readdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PluginDefinition, PluginContext } from '../../src/plugin/plugin-types';
import type { MediaAttachment } from '../../src/core/types';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FONTS_DIR = resolve(__dirname, 'fonts');
const TEMPLATE_PATH = resolve(__dirname, 'template.html');

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

const WEIGHT_MAP: Record<string, number> = {
  ExtraLight: 200,
  Light: 300,
  Regular: 400,
  Medium: 500,
  SemiBold: 600,
  Bold: 700,
  Heavy: 900,
};

async function loadFonts(): Promise<{ name: string; data: Buffer; weight: number }[]> {
  let files: string[];
  try {
    files = await readdir(FONTS_DIR);
  } catch {
    return [];
  }

  const results: { name: string; data: Buffer; weight: number }[] = [];
  for (const file of files) {
    const match = file.match(/^SourceHanSerifSC-(.+)\.otf$/);
    if (!match) continue;
    const weightLabel = match[1];
    const weight = WEIGHT_MAP[weightLabel];
    if (!weight) continue;
    try {
      const data = await readFile(resolve(FONTS_DIR, file));
      results.push({ name: FONT_NAME, data, weight });
    } catch {
      continue;
    }
  }

  return results.sort((a, b) => a.weight - b.weight);
}

// ─── Markdown → Image pipeline ─────────────────────────────────

async function convertMarkdownToImage(
  markdown: string,
  rawFonts: { name: string; data: Buffer; weight: number }[],
  htmlTemplate: string,
): Promise<Buffer> {
  const unsafeHtml = marked.parse(markdown, { async: false }) as string;
  const sanitized = sanitizeRenderedMarkdownHtml(unsafeHtml);

  const fontFamily = rawFonts[0]?.name ?? 'sans-serif';
  const htmlContent = htmlTemplate
    .replace('{{fontFamily}}', fontFamily)
    .replace('{{content}}', sanitized);

  const vdom = html(htmlContent);
  const width = 680;
  const svg = await satori(vdom as never, { width, fonts: rawFonts as never });
  const png = await sharp(Buffer.from(svg)).png().toBuffer();
  return png;
}

// ─── Plugin definition ──────────────────────────────────────────

const plugin: PluginDefinition = {
  name: 'md2img',
  version: '0.1.0',
  description:
    'Detects Markdown in LLM output and sends it as a rendered image instead of raw text.',
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

    fonts = await loadFonts();

    if (fonts.length === 0) {
      logger.warn(
        'No SourceHanSerifSC-*.otf fonts found in fonts/ directory. md2img plugin will be inactive.',
      );
      return;
    }

    logger.info(
      `md2img initialized with ${fonts.length} font(s): ${fonts.map((f) => `${f.name}(${f.weight})`).join(', ')}`,
    );
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
