'use client';

import { trpc } from '@/trpc/react';

/** Exercises the tRPC wiring end-to-end from the client. */
export function HealthCheck() {
  const health = trpc.health.useQuery();

  if (health.isPending) {
    return <p style={{ color: 'var(--muted)' }}>Checking API…</p>;
  }
  if (health.isError) {
    return <p style={{ color: 'salmon' }}>API error: {health.error.message}</p>;
  }

  return (
    <p>
      <span style={{ color: 'var(--ok)' }}>● </span>
      API healthy — <code>{health.data.app}</code> at{' '}
      <code>{health.data.time}</code>
    </p>
  );
}
