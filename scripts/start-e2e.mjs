import { mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import ts from 'typescript';
import { createServer, request } from 'node:http';

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
// A second browser origin models a CDN that rewrites Host while preserving Origin.
// Stream both directions so the test proxy cannot hide full-file buffering defects.
const proxy = createServer((incoming, outgoing) => {
  const upstream = request(
    {
      hostname: '127.0.0.1',
      port: 8791,
      path: incoming.url,
      method: incoming.method,
      headers: { ...incoming.headers, host: '127.0.0.1:8791' },
    },
    (response) => {
      outgoing.writeHead(response.statusCode, response.headers);
      response.pipe(outgoing);
    },
  );
  upstream.on('error', () => {
    outgoing.writeHead(502);
    outgoing.end();
  });
  outgoing.on('close', () => upstream.destroy());
  incoming.pipe(upstream);
});
await new Promise((resolve, reject) => {
  proxy.once('error', reject);
  proxy.listen(8793, '127.0.0.1', resolve);
});

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
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, () => {
    proxy.close();
    proxy.closeAllConnections();
    server.kill(signal);
  });
server.on('exit', (code) => process.exit(code ?? 0));
