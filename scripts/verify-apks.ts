import assert from 'node:assert/strict';
import { readFile, stat, mkdir } from 'node:fs/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import {
  apkHandler,
  fingerprintApk,
  inspectApk,
  type ByteSource,
} from '../packages/marking/src/index.ts';

const directory = resolve('target/apk-fixtures');
const tools = JSON.parse(await readFile(resolve(directory, 'tools.json'), 'utf8')) as {
  apksigner: string;
};
const output = resolve(directory, 'marked');
await mkdir(output, { recursive: true });
const source = async (path: string): Promise<ByteSource> => ({
  size: (await stat(path)).size,
  async read(offset, length) {
    if (length === 0) return new Uint8Array();
    const parts: Buffer[] = [];
    for await (const part of createReadStream(path, { start: offset, end: offset + length - 1 }))
      parts.push(part as Buffer);
    const result = Buffer.concat(parts);
    assert.equal(result.length, length);
    return new Uint8Array(result);
  },
  async stream(offset, length) {
    if (!length)
      return new ReadableStream({
        start(controller) {
          controller.close();
        },
      });
    return Readable.toWeb(
      createReadStream(path, { start: offset, end: offset + length - 1 }),
    ) as ReadableStream<Uint8Array>;
  },
});
function verify(path: string, minimum: string) {
  return execFileSync(
    tools.apksigner,
    ['verify', '--verbose', '--print-certs', '--min-sdk-version', minimum, path],
    {
      encoding: 'utf8',
      env: { ...process.env, JAVA_TOOL_OPTIONS: '--enable-native-access=ALL-UNNAMED' },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
}
const marker = new TextEncoder().encode(
  'InkParcel generic fixture verification, no recipient data.',
);
for (const name of ['v2', 'v1-v2', 'v2-v3', 'verity', 'v31', 'large']) {
  const inputPath = resolve(directory, `${name}.apk`);
  const outputPath = resolve(output, `${name}.apk`);
  const input = await source(inputPath);
  const min = name === 'v1-v2' ? '21' : '24';
  const before = verify(inputPath, min);
  const marked = await apkHandler.mark(input, marker);
  await pipeline(Readable.fromWeb((await marked.stream()) as never), createWriteStream(outputPath));
  const after = verify(outputPath, min);
  const certs = (text: string) =>
    text
      .split('\n')
      .filter((line) => /certificate SHA-256 digest:|Verified using v[123]/.test(line));
  assert.deepEqual(certs(after), certs(before), `${name}: signature/certificate mismatch`);
  const markedSource = await source(outputPath);
  assert.equal(markedSource.size, marked.size);
  assert.deepEqual(await apkHandler.extract(markedSource), marker);
  assert.equal(
    await fingerprintApk(input),
    await fingerprintApk(markedSource),
    `${name}: normalized fingerprint mismatch`,
  );
  const layout = (await inspectApk(input)) as { signingBlockOffset: number };
  for (const range of [
    { offset: 0, length: 32 },
    { offset: Math.max(0, layout.signingBlockOffset - 17), length: 256 },
    { offset: marked.size - 32, length: 32 },
  ]) {
    const data = new Uint8Array(await new Response(await marked.stream(range)).arrayBuffer());
    assert.deepEqual(data, await markedSource.read(range.offset, range.length));
  }
  console.log(
    `PASS ${name}: signatures/certificates, extraction, fingerprint, ranges (${marked.size} bytes)`,
  );
}
await assert.rejects(async () =>
  apkHandler.mark(await source(resolve(directory, 'v1-only.apk')), marker),
);
console.log('PASS v1-only rejection');
