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
