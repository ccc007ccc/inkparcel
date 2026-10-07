import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const markdown = ['README.md', 'AGENTS.md', 'CONTRIBUTING.md', 'SECURITY.md'];
function collect(directory) {
  for (const entry of readdirSync(resolve(root, directory), { withFileTypes: true })) {
    const name = `${directory}/${entry.name}`;
    if (entry.isDirectory()) collect(name);
    else if (name.endsWith('.md')) markdown.push(name);
  }
}
collect('docs');
collect('.github');
function content(path) {
  return readFileSync(path, 'utf8').replace(/^```[^\n]*\n[\s\S]*?^```\s*$/gm, '');
}
function anchors(path) {
  const result = new Set();
  for (const match of content(path).matchAll(/^#{1,6}\s+(.+?)\s*#*\s*$/gm)) {
    const base = match[1]
      .toLowerCase()
      .replace(/[^\p{L}\p{N}_ -]/gu, '')
      .trim()
      .replace(/ /g, '-');
    let slug = base;
    for (let duplicate = 1; result.has(slug); duplicate++) slug = `${base}-${duplicate}`;
    result.add(slug);
  }
  return result;
}
let failures = 0;
for (const file of markdown) {
  const path = resolve(root, file);
  for (const match of content(path).matchAll(/!?\[[^\]]*\]\(([^)\s]+)(?:\s+["'][^)]*["'])?\)/g)) {
    const target = match[1].replace(/^<|>$/g, '');
    if (/^[a-z][a-z0-9+.-]*:/i.test(target)) continue;
    const [name, fragment] = target.split('#');
    const destination = name ? resolve(dirname(path), decodeURIComponent(name)) : path;
    const missing =
      !existsSync(destination) ||
      (fragment &&
        destination.endsWith('.md') &&
        !anchors(destination).has(decodeURIComponent(fragment)));
    if (missing) {
      console.error(`${file}: broken link ${target} (${relative(root, destination)})`);
      failures++;
    }
  }
}
if (failures) process.exit(1);
console.log(`Checked relative links and heading anchors in ${markdown.length} Markdown files.`);
