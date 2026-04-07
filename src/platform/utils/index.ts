export { PathResolver, pathResolver } from './paths.js';
export { mapProviderType } from './llm-utils.js';
export { mediaDownloader, MediaDownloader, type MediaDownloadOptions, type MediaDownloadResult, type DownloadedMedia } from './media-downloader.js';

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && !(value instanceof Date);
}
