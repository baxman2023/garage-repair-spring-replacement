#!/usr/bin/env node
// AI boundary scan (WO-006 acceptance): the Anthropic SDK may only be imported
// inside packages/ai. Any other package/app constructing a raw Anthropic
// request is a violation — all calls must go through @copyforge/ai.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');

// Everything except packages/ai (the sanctioned choke point).
const SCAN_DIRS = [
  'apps/web/src',
  'apps/worker/src',
  'apps/cli/src',
  'packages/core/src',
  'packages/db/src',
];

function walk(dir) {
  const out = [];
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
}

const violations = [];
for (const rel of SCAN_DIRS) {
  for (const file of walk(join(repoRoot, rel))) {
    const source = readFileSync(file, 'utf8');
    const lines = source.split('\n');
    lines.forEach((line, i) => {
      if (line.includes('@anthropic-ai/sdk') || /\bnew\s+Anthropic\s*\(/.test(line)) {
        violations.push({ file: file.replace(`${repoRoot}/`, ''), line: i + 1, code: line.trim() });
      }
    });
  }
}

if (violations.length > 0) {
  console.error('AI boundary violation(s): Anthropic SDK used outside packages/ai.\n');
  for (const v of violations) console.error(`  ${v.file}:${v.line}  ${v.code}`);
  console.error('\nRoute all model calls through @copyforge/ai (generate / createClient).');
  process.exit(1);
}

console.log('AI boundary scan clean: Anthropic SDK confined to packages/ai.');
