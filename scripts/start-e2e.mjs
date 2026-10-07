import { mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import ts from 'typescript';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const state = resolve(root, 'target/e2e-state');
const configPath = resolve(root, 'target/e2e-worker.json');
// This fixed, ignored test-only directory is never the user's .wrangler state.
rmSync(state, { force: true, recursive: true });
mkdirSync(state, { recursive: true });
const parsed = ts.parseConfigFileTextToJson(
  'wrangler.jsonc',
  readFileSync(resolve(root, 'wrangler.jsonc'), 'utf8'),
);
if (parsed.error) throw new Error('Cannot parse wrangler.jsonc');
const config = parsed.config;
config.main = resolve(root, config.main);
config.assets.directory = resolve(root, config.assets.directory);
for (const db of config.d1_databases) db.migrations_dir = resolve(root, db.migrations_dir);
config.vars = {
  ENVIRONMENT: 'local',
  APP_SECRET: randomBytes(32).toString('base64url'),
  BOOTSTRAP_TOKEN: randomBytes(32).toString('base64url'),
};
delete config.$schema;
writeFileSync(configPath, JSON.stringify(config, null, 2), { mode: 0o600 });
const env = { ...process.env, WRANGLER_SEND_METRICS: 'false', CI: 'true' };
const migration = spawnSync(
  'pnpm',
  [
    'exec',
    'wrangler',
    'd1',
    'migrations',
    'apply',
    'inkparcel',
    '--local',
    '--config',
    configPath,
    '--persist-to',
    state,
  ],
  { cwd: root, env, stdio: 'inherit' },
);
if (migration.status !== 0) process.exit(migration.status ?? 1);
const server = spawn(
  'pnpm',
  [
    'exec',
    'wrangler',
    'dev',
    '--config',
    configPath,
    '--persist-to',
    state,
    '--port',
    '8791',
    '--ip',
    '127.0.0.1',
    '--show-interactive-dev-session',
    'false',
  ],
  { cwd: root, env, stdio: 'inherit' },
);
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.kill(signal));
server.on('exit', (code) => process.exit(code ?? 0));
