import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const dist = resolve(process.cwd(), 'dist');
const manifest = JSON.parse(readFileSync(resolve(dist, '.vite/manifest.json'), 'utf8'));
const html = readFileSync(resolve(dist, 'display/index.html'), 'utf8');
const forbidden = [
  /@supabase/i,
  /supabase\.co/i,
  /screenSupabase/i,
  /turnstile/i,
  /useRemoteScreen/i,
  /useIssues/i,
  /camtom-screen-auth/i,
  /realtime(?:channel|subscription|client)/i,
];

const keysByFile = new Map(Object.entries(manifest).map(([key, value]) => [value.file, key]));
const scriptTags = [...html.matchAll(/<script\b[^>]*>[\s\S]*?<\/script>/gi)].map((match) => match[0]);
const scriptFiles = new Set();

for (const tag of scriptTags) {
  for (const match of tag.matchAll(/(?:src|data-src)=["']\/([^"']+)["']/gi)) scriptFiles.add(match[1]);
  const inline = tag.replace(/^<script\b[^>]*>/i, '').replace(/<\/script>$/i, '');
  for (const pattern of forbidden) {
    if (pattern.test(inline)) throw new Error(`Forbidden TV dependency ${pattern} found in inline display bootstrap`);
  }
}

if (scriptFiles.size < 3) throw new Error('Generated display HTML does not include modern, legacy, and polyfill scripts');

const visitedKeys = new Set();
const visitedFiles = new Set();

function visitKey(key) {
  if (visitedKeys.has(key)) return;
  visitedKeys.add(key);
  const item = manifest[key];
  if (!item) throw new Error(`Display bundle manifest entry is missing: ${key}`);
  if (key === 'index.html' || key === 'index-legacy.html' || item.name === 'app') {
    throw new Error(`Normal application entry leaked into the TV closure: ${key}`);
  }
  visitedFiles.add(item.file);
  for (const imported of [...(item.imports ?? []), ...(item.dynamicImports ?? [])]) visitKey(imported);
}

for (const file of scriptFiles) {
  const key = keysByFile.get(file);
  if (!key) throw new Error(`Injected display script is absent from the manifest: ${file}`);
  visitKey(key);
}

for (const file of visitedFiles) {
  const source = readFileSync(resolve(dist, file), 'utf8');
  for (const pattern of forbidden) {
    if (pattern.test(source)) throw new Error(`Forbidden TV dependency ${pattern} found in ${file}`);
  }
}

if (![...visitedFiles].some((file) => /display-legacy-/.test(file))
  || ![...visitedFiles].some((file) => /polyfills-legacy-/.test(file))) {
  throw new Error('Legacy TV runtime closure is incomplete');
}

console.log(`Display bundle closure check passed (${visitedFiles.size} scripts/chunks scanned).`);
