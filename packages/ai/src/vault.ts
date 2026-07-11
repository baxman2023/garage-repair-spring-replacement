import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import Anthropic from '@anthropic-ai/sdk';
import { and, eq, isNull } from 'drizzle-orm';
import { env, newId } from '@copyforge/core';
import { apiKeys, getDb, modelRoutes } from '@copyforge/db';
import { WorkspaceKeyError } from './errors.js';
import { redact } from './redact.js';

/**
 * BYO Anthropic key vault (WO-005). Per-workspace keys are encrypted at rest
 * with AES-256-GCM under `MASTER_KEY`; only ciphertext + iv + tag + last4 are
 * persisted. Plaintext keys are decrypted transiently to make calls and never
 * logged.
 */

const ALGO = 'aes-256-gcm';

/** Derive a 32-byte key from MASTER_KEY (hex, base64, or arbitrary string). */
function masterKey(): Buffer {
  const raw = env.MASTER_KEY;
  if (/^[0-9a-fA-F]{64}$/.test(raw)) return Buffer.from(raw, 'hex');
  const b64 = Buffer.from(raw, 'base64');
  if (b64.length === 32) return b64;
  return createHash('sha256').update(raw).digest();
}

export interface EncryptedSecret {
  ciphertext: string;
  iv: string;
  tag: string;
}

export function encryptSecret(plaintext: string): EncryptedSecret {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, masterKey(), iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return {
    ciphertext: ct.toString('base64'),
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
  };
}

export function decryptSecret(secret: EncryptedSecret): string {
  const decipher = createDecipheriv(ALGO, masterKey(), Buffer.from(secret.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(secret.tag, 'base64'));
  const pt = Buffer.concat([
    decipher.update(Buffer.from(secret.ciphertext, 'base64')),
    decipher.final(),
  ]);
  return pt.toString('utf8');
}

// --- Storage ---------------------------------------------------------------

type Provider = 'anthropic';

/** Store (or rotate) a workspace's key. Verification is reset until re-tested. */
export async function storeWorkspaceKey(
  workspaceId: string,
  plaintext: string,
  provider: Provider = 'anthropic',
): Promise<{ last4: string }> {
  const enc = encryptSecret(plaintext);
  const last4 = plaintext.slice(-4);
  const db = getDb();
  await db
    .insert(apiKeys)
    .values({
      id: newId(),
      workspaceId,
      provider,
      ciphertext: enc.ciphertext,
      iv: enc.iv,
      tag: enc.tag,
      last4,
      verifiedAt: null,
    })
    .onDuplicateKeyUpdate({
      set: { ciphertext: enc.ciphertext, iv: enc.iv, tag: enc.tag, last4, verifiedAt: null },
    });
  return { last4 };
}

export interface KeyMeta {
  configured: boolean;
  last4: string | null;
  verifiedAt: Date | null;
}

export async function getWorkspaceKeyMeta(
  workspaceId: string,
  provider: Provider = 'anthropic',
): Promise<KeyMeta> {
  const rows = await getDb()
    .select({ last4: apiKeys.last4, verifiedAt: apiKeys.verifiedAt })
    .from(apiKeys)
    .where(and(eq(apiKeys.workspaceId, workspaceId), eq(apiKeys.provider, provider)))
    .limit(1);
  const row = rows[0];
  if (!row) return { configured: false, last4: null, verifiedAt: null };
  return { configured: true, last4: row.last4, verifiedAt: row.verifiedAt };
}

/** Decrypt and return a workspace's key, or null if none stored. */
export async function getWorkspaceKey(
  workspaceId: string,
  provider: Provider = 'anthropic',
): Promise<string | null> {
  const rows = await getDb()
    .select({ ciphertext: apiKeys.ciphertext, iv: apiKeys.iv, tag: apiKeys.tag })
    .from(apiKeys)
    .where(and(eq(apiKeys.workspaceId, workspaceId), eq(apiKeys.provider, provider)))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return decryptSecret(row);
}

/** Decrypt a workspace's key or throw an actionable {@link WorkspaceKeyError}. */
export async function requireWorkspaceKey(
  workspaceId: string,
  provider: Provider = 'anthropic',
): Promise<string> {
  const key = await getWorkspaceKey(workspaceId, provider);
  if (!key) throw new WorkspaceKeyError();
  return key;
}

export async function deleteWorkspaceKey(
  workspaceId: string,
  provider: Provider = 'anthropic',
): Promise<void> {
  await getDb()
    .delete(apiKeys)
    .where(and(eq(apiKeys.workspaceId, workspaceId), eq(apiKeys.provider, provider)));
}

async function markVerified(workspaceId: string, provider: Provider): Promise<void> {
  await getDb()
    .update(apiKeys)
    .set({ verifiedAt: new Date() })
    .where(and(eq(apiKeys.workspaceId, workspaceId), eq(apiKeys.provider, provider)));
}

// --- Test-key ping ---------------------------------------------------------

/** A function that verifies a key by making a minimal call; throws on failure. */
export type Pinger = (apiKey: string) => Promise<void>;

async function resolvePingModel(): Promise<string> {
  const rows = await getDb()
    .select({ model: modelRoutes.primaryModel })
    .from(modelRoutes)
    .where(and(eq(modelRoutes.stage, 'classification'), isNull(modelRoutes.workspaceId)))
    .limit(1);
  const model = rows[0]?.model;
  if (!model) throw new Error('No model route configured for the classification stage.');
  return model;
}

/** Default ping: a 1-token Messages request to Anthropic (spec WO-005). */
export const defaultAnthropicPing: Pinger = async (apiKey) => {
  const model = await resolvePingModel();
  const client = new Anthropic({ apiKey });
  await client.messages.create({
    model,
    max_tokens: 1,
    messages: [{ role: 'user', content: 'ping' }],
  });
};

export interface TestKeyResult {
  ok: boolean;
  last4?: string;
  error?: string;
}

/**
 * Verify a workspace's stored key with a 1-token ping. On success, stamp
 * `verified_at`. Any error message is redacted before being returned/logged.
 */
export async function testWorkspaceKey(
  workspaceId: string,
  provider: Provider = 'anthropic',
  ping: Pinger = defaultAnthropicPing,
): Promise<TestKeyResult> {
  const meta = await getWorkspaceKeyMeta(workspaceId, provider);
  if (!meta.configured) {
    return { ok: false, error: 'No API key configured for this workspace.' };
  }
  const key = await getWorkspaceKey(workspaceId, provider);
  if (!key) return { ok: false, error: 'No API key configured for this workspace.' };
  try {
    await ping(key);
    await markVerified(workspaceId, provider);
    return { ok: true, last4: meta.last4 ?? undefined };
  } catch (err) {
    return { ok: false, error: redact(err) };
  }
}
