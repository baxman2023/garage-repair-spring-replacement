/**
 * Raised when a workspace has no usable Anthropic key. Carries an actionable
 * message surfaced to the user on any AI call (WO-005 acceptance).
 */
export class WorkspaceKeyError extends Error {
  readonly code = 'WORKSPACE_KEY_MISSING' as const;
  constructor(
    message = 'No verified Anthropic API key is configured for this workspace. Add one in Settings → API Key before running AI features.',
  ) {
    super(message);
    this.name = 'WorkspaceKeyError';
  }
}

/**
 * True for API failures no retry can fix — bad/revoked key (401), forbidden
 * (403). The worker fails these jobs immediately instead of burning the
 * retry budget (found live: a fake key retried 5x before surfacing).
 */
export function isPermanentApiError(err: unknown): boolean {
  const status = (err as { status?: number } | null)?.status;
  return status === 401 || status === 403;
}
