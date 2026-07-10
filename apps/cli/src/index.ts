import { env } from '@copyforge/core';

/**
 * `produce` — the headless pipeline driver (spec §1: `npm run produce -- <flags>`).
 *
 * This is the CLI shell: argument parsing, help, and version. The pipeline
 * phases it drives are wired incrementally — strategy in WO-016, full build in
 * WO-034, challenger batches in WO-049 — each registering its flags here.
 */

const VERSION = '0.1.0';

interface ParsedArgs {
  flags: Map<string, string | boolean>;
  positionals: string[];
}

function parseArgs(argv: string[]): ParsedArgs {
  const flags = new Map<string, string | boolean>();
  const positionals: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        flags.set(key, next);
        i++;
      } else {
        flags.set(key, true);
      }
    } else {
      positionals.push(arg);
    }
  }

  return { flags, positionals };
}

function printHelp(): void {
  console.log(`${env.APP_NAME} produce — headless pipeline driver

Usage:
  produce [options]

Options:
  --help              Show this help
  --version           Print the CLI version

Phases (registered by later work orders):
  --phase strategy    Run intake → market profiles              (WO-016)
  --phase build       Full 5-market build through the gates      (WO-034)
  --phase challenge   Ledger-driven challenger batch             (WO-049)
`);
}

function main(): number {
  const argv = process.argv.slice(2);
  const { flags } = parseArgs(argv);

  if (flags.has('version')) {
    console.log(VERSION);
    return 0;
  }

  if (flags.has('help') || flags.size === 0) {
    printHelp();
    return 0;
  }

  const phase = flags.get('phase');
  if (typeof phase === 'string') {
    console.error(
      `[produce] phase "${phase}" is not available in this build; ` +
        `pipeline phases are registered in WO-016 / WO-034 / WO-049.`,
    );
    return 2;
  }

  console.error('[produce] unrecognized arguments. Run with --help.');
  return 2;
}

process.exit(main());
