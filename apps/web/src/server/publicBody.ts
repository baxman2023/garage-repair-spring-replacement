/**
 * Input size caps for public endpoints (WO-056). Every unauthenticated route
 * reads its body through this: oversized payloads get 413 before any parsing.
 */

export const MAX_PUBLIC_BODY_BYTES = 128 * 1024; // 128 KiB — generous for events

export type CappedJson =
  | { ok: true; body: Record<string, unknown> }
  | { ok: false; status: 413 | 400; error: string };

export async function readCappedJson(
  req: Request,
  maxBytes = MAX_PUBLIC_BODY_BYTES,
): Promise<CappedJson> {
  const declared = Number(req.headers.get('content-length') ?? 0);
  if (declared > maxBytes) {
    return { ok: false, status: 413, error: `Payload too large (max ${maxBytes} bytes).` };
  }
  const text = await req.text();
  if (text.length > maxBytes) {
    return { ok: false, status: 413, error: `Payload too large (max ${maxBytes} bytes).` };
  }
  try {
    const body = JSON.parse(text) as unknown;
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return { ok: false, status: 400, error: 'Expected a JSON object.' };
    }
    return { ok: true, body: body as Record<string, unknown> };
  } catch {
    return { ok: false, status: 400, error: 'Malformed JSON.' };
  }
}
