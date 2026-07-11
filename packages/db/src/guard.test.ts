import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newId } from '@copyforge/core';
import { closePool, getDb, tenantDb, TENANT_TABLES } from './index.js';
import * as s from './schema/index.js';

/**
 * Cross-tenant test suite (WO-004): for every enforced tenant table, insert a
 * row in workspace A and workspace B, then prove that a workspace-B-scoped
 * guard cannot read, update, or delete workspace A's row — it fails closed.
 */
type Row = Record<string, any>;
interface Entry {
  label: string;
  table: any;
  values: (suffix: string) => Row;
}

const entries: Entry[] = [
  { label: 'projects', table: s.projects, values: (x) => ({ name: `P-${x}` }) },
  { label: 'productProfiles', table: s.productProfiles, values: () => ({ projectId: newId(), profile: {} }) },
  { label: 'offers', table: s.offers, values: () => ({ projectId: newId(), offer: {} }) },
  { label: 'funnelMathRuns', table: s.funnelMathRuns, values: () => ({ projectId: newId(), inputs: {}, outputs: {}, pass: true }) },
  { label: 'markets', table: s.markets, values: () => ({ projectId: newId(), rank: 1, label: 'm', profile: {} }) },
  { label: 'vocSources', table: s.vocSources, values: () => ({ projectId: newId(), kind: 'paste' }) },
  { label: 'vocPhrases', table: s.vocPhrases, values: () => ({ marketId: newId(), phrase: 'p', kind: 'pain' }) },
  { label: 'assets', table: s.assets, values: () => ({ projectId: newId(), type: 'vsl' }) },
  { label: 'assetVersions', table: s.assetVersions, values: () => ({ assetId: newId(), blocks: [] }) },
  { label: 'councilReviews', table: s.councilReviews, values: () => ({ assetVersionId: newId(), lens: 'schwartz', score: 80, verdict: 'pass' }) },
  { label: 'focusGroupRuns', table: s.focusGroupRuns, values: () => ({ assetVersionId: newId(), annotations: {}, pass: true }) },
  { label: 'claims', table: s.claims, values: () => ({ assetId: newId(), text: 'c' }) },
  { label: 'gateReports', table: s.gateReports, values: () => ({ assetId: newId(), gate: 'G3', pass: true, report: {} }) },
  { label: 'pageBuildPackages', table: s.pageBuildPackages, values: (x) => ({ package: {}, checksum: `cs-${x}` }) },
  { label: 'exports', table: s.exports, values: (x) => ({ format: 'markdown', path: `/tmp/${x}` }) },
  { label: 'quizDefinitions', table: s.quizDefinitions, values: (x) => ({ projectId: newId(), slug: `slug-${x}`, questions: [], scoring: {}, bands: [] }) },
  { label: 'quizSessions', table: s.quizSessions, values: (x) => ({ quizDefinitionId: newId(), sessionRef: `sr-${x}` }) },
  { label: 'quizAnswers', table: s.quizAnswers, values: () => ({ sessionId: newId(), questionId: 'q1', answer: {} }) },
  { label: 'quizLeads', table: s.quizLeads, values: () => ({ band: 'a' }) },
  { label: 'utmVariantMaps', table: s.utmVariantMaps, values: () => ({ utmContent: 'x' }) },
  { label: 'events', table: s.events, values: (x) => ({ type: 'sale', source: 'manual', dedupeKey: `dk-${x}` }) },
  { label: 'controls', table: s.controls, values: () => ({ projectId: newId(), marketId: newId(), assetType: 'vsl', assetId: newId() }) },
  { label: 'challengers', table: s.challengers, values: () => ({ controlId: newId(), assetId: newId() }) },
  { label: 'predictions', table: s.predictions, values: () => ({ assetId: newId(), metric: 'cvr', predicted: '0.1' }) },
  { label: 'usageLedger', table: s.usageLedger, values: () => ({ model: 'm' }) },
  { label: 'apiKeys', table: s.apiKeys, values: () => ({ ciphertext: 'c', iv: 'i', tag: 't' }) },
  { label: 'subscriptions', table: s.subscriptions, values: () => ({ status: 'active' }) },
  { label: 'seatAssignments', table: s.seatAssignments, values: () => ({ licenseId: newId(), userId: newId() }) },
  { label: 'licenses', table: s.licenses, values: (x) => ({ key: `lic-${x}` }) },
  { label: 'harvestQueries', table: s.harvestQueries, values: () => ({ niche: 'n', query: {} }) },
  { label: 'funnelBuilds', table: s.funnelBuilds, values: () => ({ projectId: newId(), plan: {} }) },
  { label: 'funnelBuildSteps', table: s.funnelBuildSteps, values: () => ({ buildId: newId(), marketId: newId(), assetType: 'vsl', seq: 1 }) },
  { label: 'eventTriage', table: s.eventTriage, values: () => ({ projectId: newId(), source: 'pixel', payload: {}, reason: 'r' }) },
  { label: 'campaignMarketMaps', table: s.campaignMarketMaps, values: (x) => ({ projectId: newId(), campaign: `c-${x}`, marketId: newId() }) },
  { label: 'autopsies', table: s.autopsies, values: (x) => ({ title: `A-${x}`, pages: [] }) },
];

const runId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const wsA = newId();
const wsB = newId();
const A = tenantDb(wsA);
const B = tenantDb(wsB);

let dbUp = false;
beforeAll(async () => {
  try {
    await getDb().execute(sql`select 1`);
    dbUp = true;
  } catch {
    dbUp = false;
    console.warn('[guard.test] MariaDB unreachable — skipping cross-tenant tests');
  }
});
afterAll(async () => {
  if (dbUp) await closePool();
});

describe('tenancy guard — structural', () => {
  it('enforces every declared tenant table (coverage matches TENANT_TABLES)', () => {
    expect(entries.length).toBe(TENANT_TABLES.length);
    const covered = new Set(entries.map((e) => e.table));
    for (const table of TENANT_TABLES) expect(covered.has(table)).toBe(true);
  });

  it('every tenant table exposes a workspace_id column', () => {
    for (const table of TENANT_TABLES) {
      expect((table as Row).workspaceId).toBeDefined();
    }
  });
});

describe('tenancy guard — cross-tenant isolation', () => {
  for (const { label, table, values } of entries) {
    it(`fails closed on ${label}`, async () => {
      if (!dbUp) return;
      const idA = await A.insert(table, values(`${runId}-${label}-A`));
      const idB = await B.insert(table, values(`${runId}-${label}-B`));

      // Read isolation: B cannot see A's row; B sees its own.
      const bSeesA = await B.findMany(table, eq(table.id, idA));
      expect(bSeesA.length).toBe(0);
      expect(await B.findFirst(table, eq(table.id, idB))).not.toBeNull();
      expect(await A.findFirst(table, eq(table.id, idA))).not.toBeNull();

      // Write isolation: B's update/delete targeting A's row affect nothing.
      const upd = await B.update(table, { updatedAt: new Date() }, eq(table.id, idA));
      expect(upd[0].affectedRows).toBe(0);
      const del = await B.delete(table, eq(table.id, idA));
      expect(del[0].affectedRows).toBe(0);

      // A's row survives the cross-tenant attempts.
      expect(await A.findFirst(table, eq(table.id, idA))).not.toBeNull();
    });
  }
});
