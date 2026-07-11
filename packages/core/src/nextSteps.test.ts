import { describe, expect, it } from 'vitest';
import { nextStepsForAsset } from './nextSteps.js';

const base = {
  status: 'packaging',
  g7Pass: true,
  hasFiles: true,
  hasMacalyPrompt: true,
  hasUniversalPrompt: true,
  hasVariantMap: true,
  isSpoken: false,
};

describe('next-steps checklist (WO-042)', () => {
  it('a fully-packaged asset walks the user to live without leaving the screen', () => {
    const steps = nextStepsForAsset(base);
    expect(steps.join(' ')).toContain('Approve (owner)');
    expect(steps.join(' ')).toContain('Macaly prompt');
    expect(steps.join(' ')).toContain('universal prompt');
    expect(steps.join(' ')).toContain('message-match snippet');
    expect(steps.join(' ')).toContain('mark the asset Live');
  });

  it('spoken assets get the teleprompter step; incomplete packages point at G7', () => {
    expect(nextStepsForAsset({ ...base, isSpoken: true }).join(' ')).toContain('teleprompter');
    const incomplete = nextStepsForAsset({ ...base, g7Pass: false });
    expect(incomplete).toHaveLength(1);
    expect(incomplete[0]).toContain('Package incomplete');
  });

  it('gate positions produce their fix-it steps', () => {
    expect(nextStepsForAsset({ ...base, status: 'focus_group' })[0]).toContain('Fix annotations');
    expect(nextStepsForAsset({ ...base, status: 'compliance' })[0]).toContain('proof linker');
    expect(nextStepsForAsset({ ...base, status: 'blocked' })[0]).toContain('override');
    expect(nextStepsForAsset({ ...base, status: 'live' }).join(' ')).not.toContain('mark the asset Live');
  });
});
