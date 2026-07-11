/**
 * Extract the first JSON object from model output (WO-009+). Models are asked
 * for pure JSON but may wrap it in code fences or prose; this finds and parses
 * the first balanced `{…}` block. Pure and testable.
 */
export function extractJsonObject(text: string): unknown {
  // Prefer fenced ```json blocks when present.
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const candidate = fence ? fence[1]! : text;

  const start = candidate.indexOf('{');
  if (start === -1) throw new Error('No JSON object found in model output.');

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < candidate.length; i++) {
    const ch = candidate[i]!;
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        return JSON.parse(candidate.slice(start, i + 1));
      }
    }
  }
  throw new Error('Unbalanced JSON object in model output.');
}
