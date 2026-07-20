import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, extname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(__dirname, '../..');
const workspaceRoot = resolve(root, '../..');
const entry = resolve(root, 'display-main.tsx');
const banned = [/supabase/i, /turnstile/i, /useIssues/i, /useRemoteScreen/i, /\/App(?:\.|$)/];
const nodeRequire = createRequire(import.meta.url);

function resolveImport(from: string, specifier: string): string | null {
  if (specifier === '@camtom/shared') return resolve(workspaceRoot, 'shared/src/index.ts');
  if (specifier.startsWith('node:')) return null;
  if (!specifier.startsWith('.')) {
    try { return nodeRequire.resolve(specifier, { paths: [dirname(from)] }); } catch { return null; }
  }
  const base = resolve(dirname(from), specifier);
  const candidates = extname(base)
    ? [base]
    : [`${base}.ts`, `${base}.tsx`, `${base}.js`, `${base}.mjs`, `${base}.cjs`, resolve(base, 'index.ts'), resolve(base, 'index.tsx'), resolve(base, 'index.js')];
  return candidates.find(existsSync) ?? null;
}

function graph(start: string): string[] {
  const visited = new Set<string>();
  const visit = (file: string) => {
    if (visited.has(file)) return;
    visited.add(file);
    const source = readFileSync(file, 'utf8');
    const imports = source.matchAll(/(?:from\s*|import\s*\(\s*|require\s*\(\s*)['"]([^'"]+)['"]/g);
    for (const match of imports) {
      const resolved = resolveImport(file, match[1]);
      if (resolved) visit(resolved);
    }
  };
  visit(start);
  return [...visited];
}

describe('dedicated TV dependency graph', () => {
  it('does not statically import Supabase, Turnstile, Realtime auth, useIssues, or the normal App', () => {
    const files = graph(entry);
    const normalized = files.map((file) => file.replace(/\\/g, '/'));
    for (const pattern of banned) expect(normalized.filter((file) => pattern.test(file))).toEqual([]);
    expect(normalized.some((file) => file.endsWith('/display/display-transport.ts'))).toBe(true);
    expect(normalized.some((file) => file.endsWith('/display/TvDisplayApp.tsx'))).toBe(true);
  });
});
