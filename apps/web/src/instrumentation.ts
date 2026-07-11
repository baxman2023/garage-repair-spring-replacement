/**
 * Next.js server bootstrap. Installs secret redaction on console output so
 * Anthropic keys never leak into server logs (WO-005).
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { installConsoleRedaction } = await import('@copyforge/ai');
    installConsoleRedaction();
  }
}
