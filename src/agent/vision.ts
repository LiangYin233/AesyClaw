import type { InboundFile } from '../types.js';

const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.svg'];

export function isVisionableFile(file: InboundFile): boolean {
  return file.type === 'image' || IMAGE_EXTENSIONS.some((ext) => file.name?.toLowerCase().endsWith(ext));
}

