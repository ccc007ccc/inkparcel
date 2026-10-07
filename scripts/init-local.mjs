import { randomBytes } from 'node:crypto';
import { writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const destination = fileURLToPath(new URL('../.dev.vars', import.meta.url));
if (existsSync(destination)) {
  console.log('.dev.vars already exists; existing secrets were preserved.');
} else {
  const secret = () => randomBytes(32).toString('base64url');
  writeFileSync(
    destination,
    `APP_SECRET="${secret()}"\nBOOTSTRAP_TOKEN="${secret()}"\nENVIRONMENT="local"\n`,
    { flag: 'wx', mode: 0o600 },
  );
  console.log('Created .dev.vars with fresh local secrets. Use its BOOTSTRAP_TOKEN for setup.');
}
