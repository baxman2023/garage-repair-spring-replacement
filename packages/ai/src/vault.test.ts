import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newId } from '@copyforge/core';
import { closePool, getDb } from '@copyforge/db';
import {
  decryptSecret,
  deleteWorkspaceKey,
  encryptSecret,
  getWorkspaceKey,
  getWorkspaceKeyMeta,
  requireWorkspaceKey,
  storeWorkspaceKey,
  testWorkspaceKey,
} from './vault.js';
import { WorkspaceKeyError } from './errors.js';

const FAKE_KEY = 'sk-ant-api03-SECRET123456_do-not-log-me';

describe('vault crypto', () => {
  it('round-trips a secret through AES-256-GCM', () => {
    const enc = encryptSecret(FAKE_KEY);
    expect(enc.ciphertext).not.toContain(FAKE_KEY);
    expect(decryptSecret(enc)).toBe(FAKE_KEY);
  });

  it('produces a fresh iv each time (non-deterministic ciphertext)', () => {
    const a = encryptSecret(FAKE_KEY);
    const b = encryptSecret(FAKE_KEY);
    expect(a.iv).not.toBe(b.iv);
    expect(a.ciphertext).not.toBe(b.ciphertext);
  });

  it('fails to decrypt a tampered ciphertext', () => {
    const enc = encryptSecret(FAKE_KEY);
    expect(() => decryptSecret({ ...enc, tag: encryptSecret('x').tag })).toThrow();
  });
});

let dbUp = false;
beforeAll(async () => {
  try {
    await getDb().execute(sql`select 1`);
    dbUp = true;
  } catch {
    dbUp = false;
    console.warn('[vault.test] MariaDB unreachable — skipping DB-backed vault tests');
  }
});
afterAll(async () => {
  if (dbUp) await closePool();
});

describe('vault storage (DB-backed)', () => {
  it('stores only ciphertext and round-trips the key', async () => {
    if (!dbUp) return;
    const ws = newId();
    await storeWorkspaceKey(ws, FAKE_KEY);

    // Raw row holds no plaintext.
    const raw = await getDb().execute(
      sql`SELECT ciphertext, iv, tag, last4 FROM api_keys WHERE workspace_id = ${ws}`,
    );
    const row = (raw[0] as unknown as Array<Record<string, string>>)[0];
    expect(JSON.stringify(row)).not.toContain(FAKE_KEY);
    expect(row.last4).toBe('g-me'.slice(-4));

    expect(await getWorkspaceKey(ws)).toBe(FAKE_KEY);
  });

  it('reports meta and clears verification on rotation', async () => {
    if (!dbUp) return;
    const ws = newId();
    await storeWorkspaceKey(ws, 'sk-ant-first-000000000');
    const okPing = async () => {};
    expect((await testWorkspaceKey(ws, 'anthropic', okPing)).ok).toBe(true);
    expect((await getWorkspaceKeyMeta(ws)).verifiedAt).not.toBeNull();

    // Rotate → verifiedAt resets, last4 changes.
    await storeWorkspaceKey(ws, 'sk-ant-second-111122AB');
    const meta = await getWorkspaceKeyMeta(ws);
    expect(meta.verifiedAt).toBeNull();
    expect(meta.last4).toBe('22AB');
    expect(await getWorkspaceKey(ws)).toBe('sk-ant-second-111122AB');
  });

  it('throws an actionable error when no key is configured', async () => {
    if (!dbUp) return;
    await expect(requireWorkspaceKey(newId())).rejects.toBeInstanceOf(WorkspaceKeyError);
  });

  it('test-key returns ok:false (not throw) for an unconfigured workspace', async () => {
    if (!dbUp) return;
    const result = await testWorkspaceKey(newId());
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/No API key/i);
  });

  it('redacts the key from a failed ping error', async () => {
    if (!dbUp) return;
    const ws = newId();
    await storeWorkspaceKey(ws, FAKE_KEY);
    const badPing = async () => {
      throw new Error(`401 unauthorized: ${FAKE_KEY}`);
    };
    const result = await testWorkspaceKey(ws, 'anthropic', badPing);
    expect(result.ok).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.error).not.toContain(FAKE_KEY);
    expect(result.error).not.toContain('sk-ant');
  });

  it('deletes a stored key', async () => {
    if (!dbUp) return;
    const ws = newId();
    await storeWorkspaceKey(ws, FAKE_KEY);
    await deleteWorkspaceKey(ws);
    expect(await getWorkspaceKey(ws)).toBeNull();
  });
});
