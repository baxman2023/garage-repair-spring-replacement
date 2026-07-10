import { HealthCheck } from './HealthCheck';

export default function HomePage() {
  return (
    <main>
      <h1>CopyForge</h1>
      <p style={{ color: 'var(--muted)' }}>
        Multi-tenant persuasion system — interrogates an offer, selects markets,
        generates and gates a complete direct-response funnel, and closes the
        loop on real performance.
      </p>
      <HealthCheck />
    </main>
  );
}
