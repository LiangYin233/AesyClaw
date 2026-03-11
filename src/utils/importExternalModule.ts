import { mkdir } from 'fs/promises';
import { dirname, join } from 'path';
import { pathToFileURL } from 'url';

function resolveTsxTempDir(modulePath: string): string {
  const workspace = process.cwd();
  const moduleDir = dirname(modulePath);

  if (moduleDir.startsWith(workspace)) {
    return join(workspace, '.tmp', 'tsx');
  }

  return join(workspace, '.tmp', 'tsx');
}

export async function importExternalModule<T = unknown>(modulePath: string): Promise<T> {
  const tmpDir = resolveTsxTempDir(modulePath);
  await mkdir(tmpDir, { recursive: true });
  process.env.TMPDIR = tmpDir;
  process.env.TEMP = tmpDir;
  process.env.TMP = tmpDir;

  const { tsImport } = await import('tsx/esm/api');
  return tsImport(pathToFileURL(modulePath).href, { parentURL: import.meta.url }) as Promise<T>;
}
