import * as fs from 'fs';
import * as path from 'path';

const AESYCLAW_DIR = '.aesyclaw';
const WORKSPACE_DIR = 'workspace';

export function getWorkspaceDir(): string {
  return path.join(process.cwd(), AESYCLAW_DIR, WORKSPACE_DIR);
}

export function ensureWorkspaceDir(): string {
  const workspaceDir = getWorkspaceDir();
  if (!fs.existsSync(workspaceDir)) {
    fs.mkdirSync(workspaceDir, { recursive: true });
  }

  return workspaceDir;
}
