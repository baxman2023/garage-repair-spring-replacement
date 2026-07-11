import Link from 'next/link';
import { BYO_KEY_TERMS, COMMERCIAL_RIGHTS_STATEMENT, COMPLIANCE_DISCLAIMER } from '@copyforge/core';

export const metadata = { title: 'Terms of Service — CopyForge' };

const h2 = { fontSize: 18, margin: '1.4rem 0 0.4rem' } as const;

export default function TermsPage() {
  return (
    <main style={{ maxWidth: 760, lineHeight: 1.65 }}>
      <p>
        <Link href="/">← App</Link> · <Link href="/legal/privacy">Privacy policy</Link>
      </p>
      <h1>Terms of Service</h1>
      <p style={{ color: 'var(--muted)' }}>
        CopyForge is professional software sold at a professional price. These terms set
        expectations accordingly — plainly.
      </p>

      <h2 style={h2}>1. The license</h2>
      <p>
        A CopyForge license is a lifetime, per-named-user seat license. Seats are assigned to
        specific people in your workspace and may be reassigned as your team changes. Using one
        seat for multiple people violates these terms; the software also enforces it.
      </p>

      <h2 style={h2}>2. Your API key, your costs, our duty</h2>
      <p>{BYO_KEY_TERMS}</p>
      <p>
        If your key is rate-limited, suspended, or exhausted, generation stops until you resolve
        it with Anthropic. Token usage and cost estimates are shown in-app per workspace,
        project, and month.
      </p>

      <h2 style={h2}>3. Commercial rights to generated copy</h2>
      <p>
        <strong>{COMMERCIAL_RIGHTS_STATEMENT}</strong>
      </p>
      <p>
        This same statement ships inside every export manifest, so your rights travel with
        your files.
      </p>

      <h2 style={h2}>4. The compliance gate is not your lawyer</h2>
      <p>{COMPLIANCE_DISCLAIMER}</p>

      <h2 style={h2}>5. Your content</h2>
      <p>
        Everything you feed CopyForge — product material, customer voice, ledger events — stays
        in your workspace. We access it only to operate the service, never to train models, and
        never share it across workspaces. Internal winners your account learns from stay yours.
      </p>

      <h2 style={h2}>6. Refunds and revocation</h2>
      <p>
        Refunds follow the terms offered at purchase. A refunded license is revoked after a
        seven-day grace period; export your work during that window. We may revoke licenses
        obtained fraudulently or used to violate these terms.
      </p>

      <h2 style={h2}>7. Warranty & liability</h2>
      <p>
        The software is provided as-is. Direct-response results depend on your product, your
        traffic, and your market — we do not guarantee revenue outcomes. Our aggregate
        liability is capped at the amount you paid for your license.
      </p>
    </main>
  );
}
