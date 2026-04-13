export const SOURCE_ALIAS_PREFIX = '@/';
export const PLUGIN_SDK_PREFIX = '@/sdk/';

export const APP_FILES = new Set(['src/index.ts', 'src/bootstrap.ts']);

export function getTopLevelModule(repoRelativePath) {
  if (APP_FILES.has(repoRelativePath)) {
    return 'app';
  }

  if (repoRelativePath.startsWith('src/')) {
    const [, topLevel] = repoRelativePath.split('/');
    if (topLevel?.endsWith('.ts') || topLevel?.endsWith('.js')) {
      return 'app';
    }
    return topLevel || null;
  }

  if (repoRelativePath.startsWith('plugins/')) {
    return 'plugins';
  }

  return null;
}

export function getFeatureName(repoRelativePath) {
  if (!repoRelativePath.startsWith('src/features/')) {
    return null;
  }

  const [, , featureName] = repoRelativePath.split('/');
  return featureName || null;
}

export function isPluginFile(repoRelativePath) {
  return repoRelativePath.startsWith('plugins/');
}

export function isBarrelFile(repoRelativePath) {
  return repoRelativePath.endsWith('/index.ts') || repoRelativePath === 'src/index.ts';
}
