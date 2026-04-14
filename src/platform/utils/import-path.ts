import * as path from 'path';

export function normalizeImportPath(filePath: string): string {
  if (path.isAbsolute(filePath)) {
    return `file:///${filePath.replace(/\\/g, '/')}`;
  }

  return filePath;
}
