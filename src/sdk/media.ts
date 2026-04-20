/** @file 媒体下载相关工具的 SDK 公共导出
 *
 * 提供媒体文件下载器及其相关类型，供频道插件下载远程媒体文件使用。
 * 使用方式：`import { mediaDownloader } from '@/sdk/media.js'`
 */
export { mediaDownloader, MediaDownloader } from '@/platform/utils/media-downloader.js';

export type {
    MediaDownloadOptions,
    MediaDownloadResult,
    DownloadedMedia,
} from '@/platform/utils/media-downloader.js';
