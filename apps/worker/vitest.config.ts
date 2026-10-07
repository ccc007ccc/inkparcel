import { defineConfig } from 'vitest/config';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers';

export default defineConfig({
  plugins: [cloudflareTest({
      main: './src/index.ts',
      miniflare: {
        compatibilityDate: '2026-08-15',
        compatibilityFlags: ['nodejs_compat'],
        d1Databases: ['DB'],
        r2Buckets: ['BUCKET'],
        bindings: {
          APP_SECRET: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
          BOOTSTRAP_TOKEN: 'test-bootstrap-token-not-a-deployment-secret',
          ENVIRONMENT: 'local',
          TEST_MIGRATIONS: await readD1Migrations('../../migrations')
        },
        serviceBindings: {
          ASSETS: async () => new Response('<!doctype html><html><title>InkParcel test asset</title></html>', { headers: { 'Content-Type': 'text/html' } })
        }
      }
    })],
  test: { include: ['test/**/*.test.ts'] }
});
