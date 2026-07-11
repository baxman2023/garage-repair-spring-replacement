#!/usr/bin/env node
// Tenancy scan (WO-004): forbid raw Drizzle queries on tenant tables outside
// the guard. A file "raw-queries" a tenant table when it imports that table
// from @copyforge/db AND calls .from()/.insert()/.update()/.delete() on it
// directly (instead of going through tenantDb()). Passing a table to
// tenantDb().findMany(table, ...) or referencing table.column is allowed.
//
// Exit code 1 on any violation.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');

// Keep in sync with TENANT_TABLE_NAMES in packages/db/src/guard.ts.
const TENANT_TABLE_NAMES = new Set([
  'projects', 'productProfiles', 'offers', 'funnelMathRuns', 'markets',
  'vocSources', 'vocPhrases', 'assets', 'assetVersions', 'councilReviews',
  'focusGroupRuns', 'claims', 'gateReports', 'pageBuildPackages', 'exports',
  'quizDefinitions', 'quizSessions', 'quizAnswers', 'quizLeads', 'utmVariantMaps',
  'events', 'controls', 'challengers', 'predictions', 'usageLedger',
  'apiKeys', 'subscriptions', 'seatAssignments', 'licenses', 'harvestQueries',
  'funnelBuilds', 'funnelBuildSteps', 'eventTriage', 'campaignMarketMaps', 'autopsies',
]);

const SCAN_DIRS = ['apps/web/src', 'apps/worker/src', 'apps/cli/src'];

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
    if (statSync(full).isDirectory()) {
      out.push(...walk(full));
    } else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

/** Table identifiers imported from @copyforge/db in this source. */
function importedDbTables(source) {
  const names = new Set();
  const re = /import\s*(?:type\s*)?\{([^}]*)\}\s*from\s*['"]@copyforge\/db['"]/g;
  let m;
  while ((m = re.exec(source)) !== null) {
    for (const raw of m[1].split(',')) {
      const name = raw.trim().split(/\s+as\s+/)[0].trim();
      if (name) names.add(name);
    }
  }
  return names;
}

const violations = [];
for (const rel of SCAN_DIRS) {
  for (const file of walk(join(repoRoot, rel))) {
    const source = readFileSync(file, 'utf8');
    const imported = importedDbTables(source);
    const enforced = [...imported].filter((n) => TENANT_TABLE_NAMES.has(n));
    if (enforced.length === 0) continue;
    const lines = source.split('\n');
    for (const name of enforced) {
      // Raw drizzle calls take ONLY the table: `.from(tbl)`, `.insert(tbl).values(…)`,
      // `.update(tbl).set(…)`, `.delete(tbl).where(…)`. Guard calls pass the table
      // plus more arguments (`tenantDb().insert(tbl, values)`) and never match the
      // no-comma form. Guard `.delete(tbl)` with an omitted `where` would also match —
      // pass an explicit predicate to guard deletes.
      const re = new RegExp(`\\.(from|insert|update|delete)\\(\\s*${name}\\s*\\)`);
      lines.forEach((line, i) => {
        if (re.test(line)) {
          violations.push({ file: file.replace(`${repoRoot}/`, ''), line: i + 1, table: name, code: line.trim() });
        }
      });
    }
  }
}

if (violations.length > 0) {
  console.error('Tenancy violation(s): raw queries on tenant tables outside the guard.\n');
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line}  [${v.table}]  ${v.code}`);
  }
  console.error('\nUse tenantDb(workspaceId) from @copyforge/db instead.');
  process.exit(1);
}

console.log('Tenancy scan clean: no raw tenant-table queries outside the guard.');
