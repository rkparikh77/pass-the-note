import { mkdir, rm, readFile, writeFile } from 'node:fs/promises';
import { zipFunctions } from '@netlify/zip-it-and-ship-it';
await rm('packaged-functions', { recursive: true, force: true });
await mkdir('packaged-functions', { recursive: true });
const functions = await zipFunctions('netlify/functions', 'packaged-functions', {
  config: { '*': { nodeBundler: 'esbuild', nodeVersion: '22' } },
});
if (functions.length !== 1 || functions[0].name !== 'game') throw new Error('Expected only the game function');
console.log('Netlify packaged game function verified: packaged-functions/game.zip');

const manifest = JSON.parse(await readFile('packaged-functions/manifest.json', 'utf8'));
for (const item of manifest.functions) {
  item.mainFile = 'netlify/functions/game.ts';
  item.path = 'packaged-functions/game.zip';
}
await writeFile('packaged-functions/manifest.json', JSON.stringify(manifest, null, 2) + '\n');
