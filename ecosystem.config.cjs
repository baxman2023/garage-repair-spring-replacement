// PM2 process manifest for CopyForge (spec §1: web + worker in one ecosystem).
// `pm2 start ecosystem.config.cjs` launches both processes.
//
// - web:    the built Next.js server (`next start`). Requires `pnpm build` first.
// - worker: the job-claim/generation worker. Runs the compiled bundle in prod,
//           or via `tsx` in development (WORKER_DEV=1) so no build step is needed.

const path = require('path');

const repoRoot = __dirname;
const webDir = path.join(repoRoot, 'apps', 'web');
const workerDir = path.join(repoRoot, 'apps', 'worker');

const workerDev = process.env.WORKER_DEV === '1';

module.exports = {
  apps: [
    {
      name: 'copyforge-web',
      cwd: webDir,
      script: 'node_modules/.bin/next',
      args: 'start',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      env: {
        NODE_ENV: 'production',
      },
    },
    {
      name: 'copyforge-worker',
      cwd: workerDir,
      // Prod: run the compiled bundle. Dev (WORKER_DEV=1): run TypeScript
      // source directly via the tsx loader (`node --import tsx`) so no build
      // step is needed. PM2 fork mode cannot exec the tsx shell shim, so we
      // drive it through the Node interpreter instead.
      script: workerDev
        ? path.join(workerDir, 'src', 'index.ts')
        : path.join(workerDir, 'dist', 'index.js'),
      interpreter: 'node',
      interpreter_args: workerDev ? '--import tsx' : undefined,
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      env: {
        NODE_ENV: workerDev ? 'development' : 'production',
      },
    },
  ],
};
