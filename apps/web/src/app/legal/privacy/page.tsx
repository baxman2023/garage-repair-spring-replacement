import Link from 'next/link';

export const metadata = { title: 'Privacy Policy — CopyForge' };

const h2 = { fontSize: 18, margin: '1.4rem 0 0.4rem' } as const;

export default function PrivacyPage() {
  return (
    <main style={{ maxWidth: 760, lineHeight: 1.65 }}>
      <p>
        <Link href="/">← App</Link> · <Link href="/legal/terms">Terms of Service</Link>
      </p>
      <h1>Privacy Policy</h1>

      <h2 style={h2}>What we store</h2>
      <p>
        Your account (email, name), your workspace content (product profiles, generated assets,
        funnel events you ingest), operational records (jobs, gate reports, audit log), and
        billing records from Stripe. Your Anthropic API key is stored encrypted with
        AES-256-GCM; the plaintext is never logged, never displayed after entry, and is
        decrypted only in memory to make the API calls you request.
      </p>

      <h2 style={h2}>What we do NOT do</h2>
      <p>
        We do not sell your data, do not train models on your content, do not share content
        between workspaces, and do not place tracking of ours inside your exported funnels —
        the pixel in your build kit reports to YOUR project, not to us.
      </p>

      <h2 style={h2}>Funnel event data</h2>
      <p>
        Events you ingest (page views, calls, sales, email opens) are stored to power your
        dashboards and the learning loop, scoped to your workspace. Lead emails captured by
        your quizzes belong to you; export or delete them at will.
      </p>

      <h2 style={h2}>Processors</h2>
      <p>
        Anthropic processes the prompts and copy you generate (under your own key and
        agreement). Stripe processes payments; we never see card numbers.
      </p>

      <h2 style={h2}>Deletion</h2>
      <p>
        Deleting a project removes its content; deleting your workspace removes everything,
        subject to short-lived backups that expire on their retention schedule. Email us from
        your account address to request deletion.
      </p>
    </main>
  );
}
