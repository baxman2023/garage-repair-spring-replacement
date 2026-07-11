import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { env } from '@copyforge/core';
import { runStrategyPhase } from './strategy.js';

// Load the repo-root .env so headless runs see DATABASE_URL etc.
config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../../../.env') });

/**
 * `produce` — the headless pipeline driver (spec §1).
 *
 *   produce --project <id> --phase strategy [--auto-approve] [--dump-file f]
 *           [--price 1000] [--margin 0.8] [--refund 0.05] [--cpc meta=2,search=3.5]
 *
 * Later phases: build (WO-034), challenge (WO-049).
 */

const VERSION = '0.1.0';

interface ParsedArgs {
  flags: Map<string, string | boolean>;
}

function parseArgs(argv: string[]): ParsedArgs {
  const flags = new Map<string, string | boolean>();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith('--')) {
      flags.set(key, next);
      i++;
    } else {
      flags.set(key, true);
    }
  }
  return { flags };
}

function printHelp(): void {
  console.log(`${env.APP_NAME} produce — headless pipeline driver

Usage:
  produce --project <id> --phase strategy [options]

Options:
  --auto-approve      Auto-approve gates G0 (best passing variant) and G2
  --dump-file <path>  Ingest a txt/md dump through Sales Detective first
  --price <n>         Funnel-math price (default: approved offer price)
  --margin <0-1>      Contribution margin (default 0.8)
  --refund <0-1>      Refund rate (default 0.05)
  --cpc a=1.5,b=3     Channel CPC list (default meta=2)
  --help, --version
`);
}

function parseChannels(spec: string | undefined): { name: string; cpc: number }[] | undefined {
  if (!spec) return undefined;
  const channels = spec
    .split(',')
    .map((pair) => {
      const [name, cpc] = pair.split('=');
      return { name: (name ?? '').trim(), cpc: Number(cpc) };
    })
    .filter((c) => c.name && Number.isFinite(c.cpc) && c.cpc > 0);
  return channels.length ? channels : undefined;
}

async function main(): Promise<number> {
  const { flags } = parseArgs(process.argv.slice(2));

  if (flags.has('version')) {
    console.log(VERSION);
    return 0;
  }
  if (flags.has('help') || flags.size === 0) {
    printHelp();
    return 0;
  }

  const phase = flags.get('phase');
  const projectId = flags.get('project');
  if (typeof projectId !== 'string' || projectId.length !== 26) {
    console.error('[produce] --project <26-char id> is required.');
    return 2;
  }

  if (phase === 'strategy') {
    const summary = await runStrategyPhase({
      projectId,
      autoApprove: flags.get('auto-approve') === true,
      dumpFile: typeof flags.get('dump-file') === 'string' ? String(flags.get('dump-file')) : undefined,
      math: {
        ...(flags.has('price') ? { price: Number(flags.get('price')) } : {}),
        ...(flags.has('margin') ? { margin: Number(flags.get('margin')) } : {}),
        ...(flags.has('refund') ? { refundRate: Number(flags.get('refund')) } : {}),
        ...(parseChannels(flags.get('cpc') as string | undefined)
          ? { channels: parseChannels(flags.get('cpc') as string | undefined) }
          : {}),
      },
    });
    console.log(JSON.stringify(summary, null, 2));
    return summary.ok ? 0 : 1;
  }

  if (typeof phase === 'string') {
    console.error(
      `[produce] phase "${phase}" is not available yet (build → WO-034, challenge → WO-049).`,
    );
    return 2;
  }

  console.error('[produce] unrecognized arguments. Run with --help.');
  return 2;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error('[produce] fatal:', err instanceof Error ? err.message : err);
    process.exit(1);
  });
