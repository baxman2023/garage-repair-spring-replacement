import { describe, expect, it } from 'vitest';
import {
  assertClaimsResolvedForStrictMode,
  buildClaimsFlagReport,
  claimSimilarity,
  rematchClaims,
} from './claimsMatch.js';

describe('claimSimilarity (WO-031)', () => {
  it('scores identity 1, paraphrase high, unrelated low', () => {
    expect(claimSimilarity('rated ten thousand cycles', 'rated ten thousand cycles')).toBe(1);
    expect(
      claimSimilarity(
        'rated ten thousand cycles by the independent lab',
        'rated ten thousand cycles by an accredited independent lab',
      ),
    ).toBeGreaterThan(0.7);
    expect(claimSimilarity('rated ten thousand cycles', 'installed in under one hour')).toBeLessThan(0.2);
  });
});

describe('rematchClaims — resolutions survive regeneration', () => {
  const existing = [
    { text: 'rated ten thousand cycles by the independent lab', proofRef: 'lab-cert-2201', status: 'proven' as const },
    { text: 'installed in under one hour', proofRef: null, status: 'flagged' as const },
  ];

  it('a paraphrased claim inherits the prior proof; a new claim arrives flagged', () => {
    const out = rematchClaims(
      [
        { text: 'rated ten thousand cycles by an accredited independent lab' },
        { text: 'saves five hundred dollars every single year' },
      ],
      existing,
    );
    expect(out[0]).toMatchObject({
      status: 'proven',
      proofRef: 'lab-cert-2201',
      rematchedFrom: 'rated ten thousand cycles by the independent lab',
    });
    expect(out[1]).toMatchObject({ status: 'flagged', proofRef: null, rematchedFrom: null });
  });

  it('matching a FLAGGED prior claim does not fabricate proof', () => {
    const out = rematchClaims([{ text: 'installed in under one hour flat' }], existing);
    expect(out[0]!.status).toBe('flagged');
    expect(out[0]!.proofRef).toBeNull();
  });

  it('an incoming claim with its own proof keeps it', () => {
    const out = rematchClaims([{ text: 'anything at all here', proofRef: 'testimonial-7' }], existing);
    expect(out[0]).toMatchObject({ status: 'proven', proofRef: 'testimonial-7' });
  });

  it('threshold is a parameter', () => {
    const loose = rematchClaims([{ text: 'ten thousand cycles' }], existing, 0.3);
    expect(loose[0]!.status).toBe('proven');
    const strict = rematchClaims([{ text: 'ten thousand cycles' }], existing, 0.99);
    expect(strict[0]!.status).toBe('flagged');
  });
});

describe('flag report + strict-mode precondition (feeds G6)', () => {
  const claims = [
    { text: 'claim a', status: 'proven' as const },
    { text: 'claim b', status: 'flagged' as const },
    { text: 'claim c', status: 'flagged' as const },
  ];

  it('builds the per-asset flag report', () => {
    expect(buildClaimsFlagReport(claims)).toEqual({
      total: 3,
      proven: 1,
      flagged: 2,
      flaggedClaims: ['claim b', 'claim c'],
    });
  });

  it('strict modes fail closed on unresolved flags; none mode does not gate', () => {
    const report = buildClaimsFlagReport(claims);
    expect(() => assertClaimsResolvedForStrictMode(report, 'none')).not.toThrow();
    expect(() => assertClaimsResolvedForStrictMode(report, 'health')).toThrow(/G6 blocked \(health mode\): 2 unresolved/);
    expect(() => assertClaimsResolvedForStrictMode(report, 'finance')).toThrow(/claim b \| claim c/);
    const clean = buildClaimsFlagReport(claims.map((c) => ({ ...c, status: 'proven' as const })));
    expect(() => assertClaimsResolvedForStrictMode(clean, 'health')).not.toThrow();
  });
});
