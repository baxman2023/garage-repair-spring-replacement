import { env } from '@copyforge/core';
import { redact } from './redact.js';

/**
 * Error reporting (WO-056): a minimal Sentry-compatible reporter. Every field
 * passes through `redact()` BEFORE leaving the process, so an API key caught
 * in an error message can never reach the error tracker. No-op (console only)
 * when SENTRY_DSN is unset.
 */

export type ReportFetcher = (url: string, init: RequestInit) => Promise<{ ok: boolean; status: number }>;

export interface ErrorReportContext {
  [key: string]: string | number | boolean | null | undefined;
}

interface ParsedDsn {
  storeUrl: string;
  publicKey: string;
}

export function parseSentryDsn(dsn: string): ParsedDsn | null {
  // DSN: https://<publicKey>@<host>/<projectId>
  const match = /^(https?):\/\/([^@]+)@([^/]+)\/(\d+)$/.exec(dsn.trim());
  if (!match) return null;
  const [, proto, publicKey, host, projectId] = match;
  return {
    storeUrl: `${proto}://${host}/api/${projectId}/store/`,
    publicKey: publicKey!,
  };
}

/** Build the (fully redacted) Sentry event payload. Exported for tests. */
export function buildErrorEvent(
  err: unknown,
  context: ErrorReportContext = {},
  now = new Date(),
): Record<string, unknown> {
  const message = redact(err);
  const stack = err instanceof Error && err.stack ? redact(err.stack) : undefined;
  const tags: Record<string, string> = {};
  for (const [key, value] of Object.entries(context)) {
    if (value === undefined || value === null) continue;
    tags[key] = redact(String(value));
  }
  return {
    timestamp: now.toISOString(),
    level: 'error',
    platform: 'node',
    logger: 'copyforge',
    message: { formatted: message },
    ...(stack ? { extra: { stack } } : {}),
    tags,
  };
}

/**
 * Report an error. Redaction-first; network failures are swallowed (error
 * reporting must never take the process down with it).
 */
export async function reportError(
  err: unknown,
  context: ErrorReportContext = {},
  fetcher?: ReportFetcher,
): Promise<boolean> {
  const event = buildErrorEvent(err, context);
  const dsn = env.SENTRY_DSN ? parseSentryDsn(env.SENTRY_DSN) : null;
  if (!dsn) {
    console.error('[error-report]', JSON.stringify(event));
    return false;
  }
  try {
    const doFetch: ReportFetcher = fetcher ?? (fetch as unknown as ReportFetcher);
    const res = await doFetch(dsn.storeUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-sentry-auth': `Sentry sentry_version=7, sentry_key=${dsn.publicKey}, sentry_client=copyforge/1.0`,
      },
      body: JSON.stringify(event),
    });
    return res.ok;
  } catch {
    console.error('[error-report] delivery failed', JSON.stringify(event));
    return false;
  }
}
