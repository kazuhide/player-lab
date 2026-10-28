import { readdir, readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

const root = new URL('../', import.meta.url);
let checked = 0;
async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
    const file = new URL(entry.name + (entry.isDirectory() ? '/' : ''), directory);
    if (entry.isDirectory()) await walk(file);
    else if (entry.name.endsWith('.mjs')) {
      const result = spawnSync(process.execPath, ['--check', file.pathname], { encoding: 'utf8' });
      if (result.status !== 0) { process.stderr.write(result.stderr); process.exit(1); }
      checked += 1;
    }
  }
}
await walk(root);
const html = await readFile(new URL('public/index.html', root), 'utf8');
for (const asset of ['/app.mjs', '/styles.css']) if (!html.includes(asset)) throw new Error('Missing dashboard entry asset.');
console.log(`Build check passed: ${checked} JavaScript modules and static dashboard assets. No compilation or external assets required.`);
