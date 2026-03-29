import { join, isAbsolute, resolve } from 'path';

export const AESYCLAW_DIR = '.aesyclaw';
export const WORKSPACE_DIR = 'workspace';
export const PLUGINS_DIR = 'plugins';
export const SKILLS_DIR = 'skills';
export const CONFIG_FILE = 'config.toml';

function resolvePath(base: string, ...segments: string[]): string {
  const resolved = isAbsolute(base) ? base : resolve(process.cwd(), base);
  return join(resolved, ...segments);
}

export const paths = {
  aesyclaw: (...segments: string[]) => resolvePath(AESYCLAW_DIR, ...segments),
  workspace: (...segments: string[]) => resolvePath(WORKSPACE_DIR, ...segments),
  plugins: (...segments: string[]) => resolvePath(PLUGINS_DIR, ...segments),
  skills: (...segments: string[]) => resolvePath(WORKSPACE_DIR, SKILLS_DIR, ...segments),
  config: () => resolvePath(CONFIG_FILE),
};

export const dirPaths = {
  aesyclaw: () => resolvePath(AESYCLAW_DIR),
  workspace: () => resolvePath(WORKSPACE_DIR),
  plugins: () => resolvePath(PLUGINS_DIR),
  skills: () => resolvePath(WORKSPACE_DIR, SKILLS_DIR),
  temp: () => resolvePath(AESYCLAW_DIR, 'temp'),
  sessions: () => resolvePath(AESYCLAW_DIR, 'sessions'),
  cronJobs: () => resolvePath(AESYCLAW_DIR, 'cron-jobs.json'),
  tokenUsage: () => resolvePath(AESYCLAW_DIR, 'token-usage.db'),
  channelAssets: () => resolvePath(AESYCLAW_DIR, 'channel-assets'),
};

export const filePaths = {
  sessionsDb: () => resolvePath(AESYCLAW_DIR, 'sessions', 'sessions.db'),
  tokenUsageDb: () => resolvePath(AESYCLAW_DIR, 'token-usage.db'),
  cronJobs: () => resolvePath(AESYCLAW_DIR, 'cron-jobs.json'),
  config: () => resolvePath(CONFIG_FILE),
  packageJson: () => resolvePath('package.json'),
};

export const channelPaths = {
  weixin: {
    root: () => resolvePath(AESYCLAW_DIR, 'channels', 'weixin'),
    outboundMedia: () => resolvePath(AESYCLAW_DIR, 'channels', 'weixin', 'outbound-media'),
  }
};
