import path from 'path';
import { fileURLToPath } from 'url';
import {
  SOURCE_ALIAS_PREFIX,
  PLUGIN_SDK_PREFIX,
  getTopLevelModule,
  isBarrelFile,
  isPluginFile,
} from '../import-policy.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function normalizePath(value) {
  return value.replace(/\\/g, '/');
}

function toRepoRelative(filename) {
  return normalizePath(path.relative(repoRoot, filename));
}

function toResolvedRepoRelative(context, sourceValue) {
  const filename = context.filename;

  if (sourceValue.startsWith(SOURCE_ALIAS_PREFIX)) {
    return normalizePath(`src/${sourceValue.slice(SOURCE_ALIAS_PREFIX.length)}`);
  }

  if (sourceValue.startsWith('.')) {
    const absoluteTarget = path.resolve(path.dirname(filename), sourceValue);
    return toRepoRelative(absoluteTarget);
  }

  if (sourceValue.includes('/src/')) {
    const srcIndex = sourceValue.lastIndexOf('/src/');
    return normalizePath(sourceValue.slice(srcIndex + 1));
  }

  return null;
}

function isCrossModuleRelativeImport(sourceModule, targetModule, sourceValue) {
  return sourceValue.startsWith('.') && Boolean(sourceModule) && Boolean(targetModule) && sourceModule !== targetModule;
}

function isPluginInternalSourceImport(sourceValue) {
  return sourceValue.includes('/src/') && !sourceValue.includes('/src/sdk/');
}

function reportsForNode(context, node) {
  const source = node.source && typeof node.source.value === 'string' ? node.source.value : null;
  if (!source) {
    return [];
  }

  const repoRelativeFile = toRepoRelative(context.filename);
  const sourceModule = getTopLevelModule(repoRelativeFile);
  const targetRepoRelative = toResolvedRepoRelative(context, source);
  const targetModule = targetRepoRelative ? getTopLevelModule(targetRepoRelative) : null;
  const reports = [];

  if (isPluginFile(repoRelativeFile)) {
    if (source.startsWith(SOURCE_ALIAS_PREFIX) && !source.startsWith(PLUGIN_SDK_PREFIX)) {
      reports.push({
        node: node.source,
        message: 'Plugins must import core project symbols through @/sdk/* only.',
      });
    }

    if (isPluginInternalSourceImport(source)) {
      reports.push({
        node: node.source,
        message: 'Plugins must not import internal src implementation paths directly.',
      });
    }

    return reports;
  }

  if (sourceModule === 'platform' && ['features', 'agent', 'channels'].includes(targetModule || '')) {
    reports.push({
      node: node.source,
      message: 'Platform code must not depend on higher-level feature, agent, or channel modules.',
    });
  }

  if (isCrossModuleRelativeImport(sourceModule, targetModule, source)) {
    reports.push({
      node: node.source,
      message: 'Cross-module imports must use the @/ alias instead of relative traversal.',
    });
  }

  if (source.startsWith('.') && /(\/|^)index(\.js)?$/.test(source) && sourceModule === targetModule) {
    reports.push({
      node: node.source,
      message: 'Module-internal code should import concrete files instead of routing through a local barrel.',
    });
  }

  return reports;
}

function createImportVisitor(context) {
  return {
    ImportDeclaration(node) {
      for (const report of reportsForNode(context, node)) {
        context.report(report);
      }
    },
  };
}

function createBarrelVisitor(context) {
  return {
    ExportAllDeclaration(node) {
      reportBarrelExport(context, node);
    },
    ExportNamedDeclaration(node) {
      reportBarrelExport(context, node);
    },
  };
}

function reportBarrelExport(context, node) {
  const source = node.source && typeof node.source.value === 'string' ? node.source.value : null;
  if (!source) {
    return;
  }

  const repoRelativeFile = toRepoRelative(context.filename);
  if (!isBarrelFile(repoRelativeFile) || isPluginFile(repoRelativeFile)) {
    return;
  }

  const sourceModule = getTopLevelModule(repoRelativeFile);
  const targetRepoRelative = toResolvedRepoRelative(context, source);
  const targetModule = targetRepoRelative ? getTopLevelModule(targetRepoRelative) : null;

  if (sourceModule && targetModule && sourceModule !== targetModule) {
    context.report({
      node: node.source,
      message: 'Barrels may only re-export files owned by their own top-level module.',
    });
  }
}

export default {
  rules: {
    'no-invalid-import-boundaries': {
      meta: {
        type: 'problem',
        schema: [],
      },
      create: createImportVisitor,
    },
    'no-invalid-barrel-exports': {
      meta: {
        type: 'problem',
        schema: [],
      },
      create: createBarrelVisitor,
    },
  },
};
