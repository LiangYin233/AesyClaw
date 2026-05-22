/**
 * scripts/check-deps — 依赖规则检查。
 *
 * 检查内容：
 *   1. 循环依赖
 *   2. core/* 不能反向依赖业务模块（agent/* command/* cron/* extension/* pipeline/* role/* session/* skill/* tool/* web/*）
 *   3. hook/types.ts 不能导入具体 Agent / Session / ToolRegistry
 *   4. web/services/*、web/ws/* 不能导入 webui-manager
 *
 * 用法：npx tsx scripts/check-deps.ts
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, dirname, relative, join } from 'node:path';
// ─── 简单的文件扫描 ─────────────────────────────────────────────

function walkDir(dir: string, ext = '.ts'): string[] {
  const result: string[] = [];
  const entries = readDirRecursive(dir);
  for (const f of entries) {
    if (f.endsWith(ext)) result.push(f);
  }
  return result;
}

function readDirRecursive(dir: string): string[] {
  const entries: string[] = [];
  try {
    const list = readdirSync(dir);
    for (const entry of list) {
      const full = join(dir, entry);
      const st = statSync(full, { throwIfNoEntry: false });
      if (!st) continue;
      if (st.isDirectory()) {
        if (entry === 'node_modules' || entry === 'dist') continue;
        entries.push(...readDirRecursive(full));
      } else {
        entries.push(full);
      }
    }
  } catch {
    // ignore
  }
  return entries;
}

// ─── Import 解析 ───────────────────────────────────────────────

const IMPORT_RE =
  /(?:import|export)\s+(?:[^'"']*?\s+from\s+)?['"]([^'"]+)['"]|import\(['"]([^'"]+)['"]\)/g;

const FORBIDDEN_BUSINESS_MODULES = [
  'agent',
  'command',
  'cron',
  'extension',
  'pipeline',
  'role',
  'session',
  'skill',
  'tool',
  'web',
];

// ─── 验证器 ─────────────────────────────────────────────────────

function createValidator(srcRoot: string): {
  check(): { ok: boolean; errors: string[] };
} {
  const root = resolve(srcRoot);
  const files = walkDir(root);
  const fileSet = new Set<string>();
  const fileModule = new Map<string, string>(); // file -> top-level module name

  // Normalize all file paths to be relative to root, without extension
  const normalizedFiles: string[] = [];
  for (const f of files) {
    const rel = relative(root, f).replace(/\\/g, '/');
    const noExt = rel.endsWith('.ts') ? rel.slice(0, -3) : rel;
    // Skip index files when looking up
    const noIndex = noExt.endsWith('/index') ? noExt.slice(0, -6) : noExt;
    fileSet.add(noExt);
    fileSet.add(noIndex);
    normalizedFiles.push(noExt);
    const firstSegment = noExt.split('/')[0];
    if (firstSegment && !firstSegment.startsWith('.')) {
      fileModule.set(noExt, firstSegment);
    }
  }

  function resolveImport(srcFile: string, spec: string): string | null {
    let rel: string;
    if (spec.startsWith('@aesyclaw/')) {
      rel = spec.slice('@aesyclaw/'.length);
    } else if (spec.startsWith('.')) {
      try {
        const resolved = resolve(dirname(resolve(root, srcFile)), spec);
        rel = relative(root, resolved).replace(/\\/g, '/');
      } catch {
        return null;
      }
    } else {
      return null; // external dep, skip
    }
    const noExt = rel.endsWith('.ts') ? rel.slice(0, -3) : rel;
    if (fileSet.has(noExt)) return noExt;
    if (fileSet.has(noExt + '/index')) return noExt + '/index';
    return null;
  }

  // Build dependency graph
  const g = new Map<string, Set<string>>();
  for (const f of normalizedFiles) {
    g.set(f, new Set());
  }

  for (const f of normalizedFiles) {
    const fullPath = resolve(root, f + '.ts');
    let text: string;
    try {
      text = readFileSync(fullPath, 'utf-8');
    } catch {
      // try .tsx
      try {
        text = readFileSync(fullPath.replace('.ts', '.tsx'), 'utf-8');
      } catch {
        continue;
      }
    }
    const deps = g.get(f)!;
    let m: RegExpExecArray | null;
    IMPORT_RE.lastIndex = 0;
    while ((m = IMPORT_RE.exec(text)) !== null) {
      const spec = m[1] ?? m[2];
      if (!spec) continue;
      const target = resolveImport(f, spec);
      if (target) deps.add(target);
    }
  }

  // ─── Checks ───────────────────────────────────────────────

  const errors: string[] = [];

  // 1. Circular dependency check (Tarjan)
  let index = 0;
  const idx = new Map<string, number>();
  const low = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const sccs: string[][] = [];

  function dfs(v: string): void {
    idx.set(v, index);
    low.set(v, index);
    index++;
    stack.push(v);
    onStack.add(v);
    for (const w of g.get(v) ?? []) {
      if (!idx.has(w)) {
        dfs(w);
        low.set(v, Math.min(low.get(v)!, low.get(w)!));
      } else if (onStack.has(w)) {
        low.set(v, Math.min(low.get(v)!, idx.get(w)!));
      }
    }
    if (low.get(v) === idx.get(v)) {
      const comp: string[] = [];
      while (true) {
        const w = stack.pop()!;
        onStack.delete(w);
        comp.push(w);
        if (w === v) break;
      }
      if (comp.length > 1) sccs.push(comp);
    }
  }

  for (const v of normalizedFiles) {
    if (!idx.has(v)) dfs(v);
  }

  if (sccs.length > 0) {
    errors.push(`❌ 检测到 ${sccs.length} 个循环依赖:`);
    for (const comp of sccs) {
      errors.push(`  循环 (${comp.length} 个文件):`);
      for (const f of comp) errors.push(`    - ${f}`);
    }
  } else {
    errors.push('✅ 无循环依赖');
  }

  // 2. core/* 不能导入业务模块
  for (const f of normalizedFiles) {
    const parts = f.split('/');
    if (parts[0] !== 'core') continue;
    if (parts[1] === 'index') continue; // core/index.ts is the barrel, skip
    const deps = g.get(f) ?? new Set();
    for (const dep of deps) {
      const depModule = dep.split('/')[0];
      if (FORBIDDEN_BUSINESS_MODULES.includes(depModule)) {
        errors.push(`❌ ${f} -> ${dep}：core/* 禁止导入业务模块 "${depModule}"`);
      }
    }
  }

  // 3. hook/types.ts 不能导入具体 Agent / Session / ToolRegistry
  const hookTypes = normalizedFiles.find((f) => f === 'hook/types');
  if (hookTypes) {
    const deps = g.get(hookTypes) ?? new Set();
    for (const dep of deps) {
      if (
        dep.startsWith('agent/') ||
        dep.startsWith('session/') ||
        dep.startsWith('tool/tool-registry')
      ) {
        errors.push(`❌ hook/types -> ${dep}：hook/types.ts 禁止导入具体业务实现`);
      }
    }
  }

  // 4. web/services/*、web/ws/* 不能导入 web/webui-manager
  for (const f of normalizedFiles) {
    if (!f.startsWith('web/services/') && !f.startsWith('web/ws/')) continue;
    const deps = g.get(f) ?? new Set();
    for (const dep of deps) {
      if (dep === 'web/webui-manager') {
        errors.push(`❌ ${f} -> ${dep}：${f} 禁止导入 webui-manager`);
      }
    }
  }

  return {
    check: () => {
      const ok = errors.every((e) => !e.startsWith('❌'));
      return { ok, errors };
    },
  };
}

// ─── Main ───────────────────────────────────────────────────────

function main(): void {
  const validator = createValidator('src');
  const result = validator.check();

  console.log('\n=== AesyClaw 依赖规则检查 ===\n');
  for (const line of result.errors) {
    console.log(line);
  }
  console.log();

  if (result.ok) {
    console.log('✅ 全部检查通过');
    process.exit(0);
  } else {
    console.log('❌ 存在违反依赖规则的项');
    process.exit(1);
  }
}

main();
