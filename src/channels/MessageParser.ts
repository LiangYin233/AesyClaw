export function detectFileType(fileName: string): 'audio' | 'video' | 'image' | 'file' {
  const ext = fileName.toLowerCase().match(/\.([^.]+)$/)?.[1];

  if (!ext) {
    return 'file';
  }

  // Audio extensions
  const audioExts = ['mp3', 'wav', 'm4a', 'ogg', 'opus', 'flac', 'amr', 'aac', 'wma'];
  if (audioExts.includes(ext)) {
    return 'audio';
  }

  // Video extensions
  const videoExts = ['mp4', 'avi', 'mov', 'wmv', 'flv', 'mkv', 'webm', 'm4v', 'mpg', 'mpeg'];
  if (videoExts.includes(ext)) {
    return 'video';
  }

  // Image extensions
  const imageExts = ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'svg', 'ico'];
  if (imageExts.includes(ext)) {
    return 'image';
  }

  return 'file';
}
