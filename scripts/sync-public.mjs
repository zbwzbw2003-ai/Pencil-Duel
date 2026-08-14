import { cp, mkdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'public');
const staticFiles = ['index.html', 'online.html', 'styles.css', 'game.js', 'online.js'];
const destinations = [output, path.join(output, 'game1')];

await rm(output, {recursive: true, force: true});
await Promise.all(destinations.map(destination => mkdir(path.join(destination, 'assets'), {recursive: true})));

await Promise.all([
  ...destinations.flatMap(destination => staticFiles.map(file => cp(path.join(root, file), path.join(destination, file)))),
  ...destinations.map(destination => cp(path.join(root, 'assets', 'paper-texture.png'), path.join(destination, 'assets', 'paper-texture.png')))
]);

console.log(`Synced ${staticFiles.length + 1} static assets to both / and /game1/`);
