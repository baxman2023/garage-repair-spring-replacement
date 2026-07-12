'use client';

import Link from 'next/link';
import { trpc } from '@/trpc/react';

/**
 * The "First Funnel Today" checklist (WO-054): derives from real pipeline
 * state and always points at the next action. Rendered on the project page,
 * so every empty state has a way forward.
 */
export function OnboardingChecklist({ projectId }: { projectId: string }) {
  const progress = trpc.onboarding.progress.useQuery({ projectId }, { refetchInterval: 5000 });
  const data = progress.data;
  if (!data) return null;

  return (
    <section className="card" style={{ margin: '0.75rem 0 1rem' }}>
      <div className="row-lg small">
        {data.steps.map((s, i) => (
          <Link
            key={s.key}
            href={s.href}
            style={{
              color: s.done ? 'var(--ok)' : data.next?.key === s.key ? 'var(--accent)' : 'var(--muted)',
              textDecoration: 'none',
              fontWeight: data.next?.key === s.key ? 700 : 400,
            }}
          >
            {s.done ? '✓' : `${i + 1}.`} {s.label}
          </Link>
        ))}
      </div>
      {data.next ? (
        <p className="muted small" style={{ margin: '0.5rem 0 0' }}>
          <strong style={{ color: 'inherit' }}>Next:</strong> {data.next.hint}{' '}
          <Link href={data.next.href}>Go →</Link> · <Link href={data.next.docs}>docs</Link>
        </p>
      ) : (
        <p className="ok small" style={{ margin: '0.5rem 0 0' }}>
          Funnel shipped end-to-end. Watch the <Link href={`/projects/${projectId}/dashboard`}>dashboard</Link>{' '}
          and let the challengers earn their shot.
        </p>
      )}
    </section>
  );
}
