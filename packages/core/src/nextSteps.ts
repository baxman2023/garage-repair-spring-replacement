/**
 * "What to do next" checklist per asset (WO-042, pure). Derives the user's
 * next actions from the asset's pipeline position so the Delivery Center can
 * walk a new user from approved build to live-ready files without leaving
 * the screen.
 */

export interface NextStepsInputs {
  status: string;
  g7Pass: boolean;
  hasFiles: boolean;
  hasMacalyPrompt: boolean;
  hasUniversalPrompt: boolean;
  hasVariantMap: boolean;
  isSpoken: boolean;
}

export function nextStepsForAsset(a: NextStepsInputs): string[] {
  const steps: string[] = [];
  switch (a.status) {
    case 'draft':
    case 'council':
    case 'revising':
      steps.push('In the gate pipeline — wait for Council (G3) to finish or check the gate dashboard.');
      break;
    case 'focus_group':
      steps.push('Focus group flagged this draft — review the annotations and click “Fix annotations”, then let the gates re-run.');
      break;
    case 'deslop':
      steps.push('De-slop (G5) is running — no action needed unless it blocks.');
      break;
    case 'compliance':
      steps.push('Compliance (G6) needs attention — resolve flagged claims in the proof linker or acknowledge lint warnings, then re-run.');
      break;
    case 'blocked':
      steps.push('Blocked at a gate — open the gate dashboard, read the report, then fix and re-run or override with a reason (owner).');
      break;
    case 'packaging':
    case 'approved':
    case 'live': {
      if (!a.g7Pass) {
        steps.push('Package incomplete — re-run packaging so files and prompts compile (G7).');
        break;
      }
      if (a.status === 'packaging') steps.push('Review the copy once more, then Approve (owner) on the gate dashboard.');
      if (a.hasMacalyPrompt) steps.push('Copy the Macaly prompt and build the page in one shot — the copy inside is fenced and final.');
      if (a.hasUniversalPrompt) steps.push('Or copy the universal prompt into any capable model (pick your stack first).');
      if (a.hasFiles) steps.push('Download the files (or the per-market ZIP) if you are building by hand.');
      if (a.isSpoken) steps.push('Record from the teleprompter TXT — timings are pre-computed at 170 WPM.');
      if (a.hasVariantMap) steps.push('Install the message-match snippet in the page <head> and tag the headline/lead elements.');
      if (a.status !== 'live') steps.push('Once the page is live, mark the asset Live so the ledger attributes events to it.');
      break;
    }
    case 'retired':
      steps.push('Retired — kept for history and control lineage.');
      break;
    default:
      steps.push('Check the gate dashboard for this asset.');
  }
  return steps;
}
