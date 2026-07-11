/**
 * Secret redaction (WO-005). Anthropic keys must never appear in logs or error
 * messages. `redact()` scrubs anything shaped like an Anthropic key;
 * `installConsoleRedaction()` wraps console methods so stray keys are removed
 * even from third-party log lines.
 */

// Anthropic keys look like `sk-ant-...`; also catch bare `sk-...` secrets.
const KEY_PATTERN = /sk-(?:ant-)?[A-Za-z0-9_-]{8,}/g;
export const REDACTED = '[REDACTED]';

/** Replace anything shaped like a secret key with `[REDACTED]`. */
export function redact(value: unknown): string {
  const text =
    typeof value === 'string'
      ? value
      : value instanceof Error
        ? `${value.name}: ${value.message}`
        : safeStringify(value);
  return text.replace(KEY_PATTERN, REDACTED);
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

let installed = false;

/** Wrap console.{log,info,warn,error,debug} to redact secrets from all output. */
export function installConsoleRedaction(): void {
  if (installed) return;
  installed = true;
  const methods = ['log', 'info', 'warn', 'error', 'debug'] as const;
  for (const method of methods) {
    const original = console[method].bind(console);
    console[method] = (...args: unknown[]) => {
      original(...args.map((a) => (typeof a === 'string' || a instanceof Error ? redact(a) : a)));
    };
  }
}
