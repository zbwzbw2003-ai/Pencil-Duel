import { cp, mkdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'public');
const staticFiles = ['index.html', 'online.html', 'styles.css', 'game.js', 'online.js'];

await rm(output, {recursive: true, force: true});
await mkdir(path.join(output, 'assets'), {recursive: true});

await Promise.all([
  ...staticFiles.map(file => cp(path.join(root, file), path.join(output, file))),
  cp(path.join(root, 'assets', 'paper-texture.png'), path.join(output, 'assets', 'paper-texture.png'))
]);

console.log(`Synced ${staticFiles.length + 1} static assets to public/`);
