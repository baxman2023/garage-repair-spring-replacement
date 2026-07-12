'use client';

import { trpc } from '@/trpc/react';

/** Exercises the tRPC wiring end-to-end from the client. */
export function HealthCheck() {
  const health = trpc.health.useQuery();

  if (health.isPending) {
    return <p className="muted small">Checking API…</p>;
  }
  if (health.isError) {
    return <p className="danger small">API error: {health.error.message}</p>;
  }

  return (
    <p className="faint xsmall" style={{ marginTop: '2.5rem' }}>
      <span className="ok">● </span>
      API healthy — <code>{health.data.app}</code> at <code>{health.data.time}</code>
    </p>
  );
}
