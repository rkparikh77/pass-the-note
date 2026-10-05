import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { BlobsServer } from '@netlify/blobs/server';
import { completeGame } from './support/function-flow.mjs';

test('production build and packaged Netlify function: real Blobs SDK, full four-player game and score carryover', async t => {
  const root = new URL('..', import.meta.url);
  const frontend = await readFile(new URL('dist/app.js', root), 'utf8');
  assert.ok(frontend.includes('/.netlify/functions/game')); assert.ok(!frontend.includes('/api/'));
  for (const name of ['index.html', 'app.js', 'style.css', 'favicon.svg']) assert.deepEqual(await readFile(new URL(`dist/${name}`, root)), await readFile(new URL(`public/${name}`, root)));
  assert.deepEqual(await readdir(new URL('netlify/functions', root)), ['game.ts']);
  const config = await readFile(new URL('netlify.toml', root), 'utf8'); assert.ok(!config.includes('redirect'));
  const source = await readFile(new URL('netlify/functions/game.ts', root), 'utf8'); assert.ok(!source.includes('config')); assert.ok(source.includes("consistency: 'strong'"));
  const scratch = await mkdtemp(join(tmpdir(), 'pass-note-function-'));
  t.after(() => rm(scratch, { recursive: true, force: true }));
  execFileSync('unzip', ['-q', new URL('packaged-functions/game.zip', root).pathname, '-d', join(scratch, 'function')]);
  const metadata = JSON.parse(await readFile(join(scratch, 'function', '___netlify-metadata.json'), 'utf8')); assert.equal(metadata.version, 1);
  const manifest = JSON.parse(await readFile(new URL("packaged-functions/manifest.json", root), "utf8")); assert.equal(manifest.functions[0].buildData.runtimeAPIVersion, 2);
  const blobs = new BlobsServer({ directory: join(scratch, 'blobs'), logger: () => {} });
  const address = await blobs.start(); t.after(() => blobs.stop());
  // Mimic the automatic runtime context. These are local test values, not
  // deployment settings or credentials a player/site owner must supply.
  const originalContext = globalThis.netlifyBlobsContext;
  globalThis.netlifyBlobsContext = Buffer.from(JSON.stringify({ siteID: 'test-site', token: 'test-only', edgeURL: 'https://cached-endpoint.invalid', uncachedEdgeURL: `http://127.0.0.1:${address.port}` })).toString('base64');
  const originalFetch = globalThis.fetch; let conditionalWrites = 0; const etags = new Map();
  // @netlify/blobs 11.1.3's emulator omits ETag on reads. PUT returns its
  // real ETag, so attach the latest PUT ETag to GET in this sequential test.
  // Production requires the documented GET ETag and fails closed if missing.
  globalThis.fetch = async (url, options) => {
    assert.ok(String(url).startsWith(`http://127.0.0.1:${address.port}/`), 'Strong reads must bypass the cached endpoint');
    const result = await originalFetch(url, options);
    if (options?.method === 'put') {
      assert.ok(options.headers['if-match'] || options.headers['if-none-match']); conditionalWrites++;
      if (result.status === 200) { assert.ok(result.headers.get('etag')); etags.set(String(url), result.headers.get('etag')); }
    }
    if (options?.method === 'get' && result.status === 200 && !result.headers.has('etag')) {
      assert.ok(etags.has(String(url)));
      const headers = new Headers(result.headers); headers.set('etag', etags.get(String(url)));
      return new Response(result.body, { status: result.status, headers });
    }
    return result;
  };
  t.after(() => { globalThis.fetch = originalFetch; });
  const originalNow = Date.now; let clock = 1000; Date.now = () => clock;
  t.after(() => { Date.now = originalNow; globalThis.netlifyBlobsContext = originalContext; });
  const { default: handler } = await import(pathToFileURL(join(scratch, 'function', 'netlify', 'functions', 'game.mjs')).href);
  await completeGame(handler, time => { clock = time; });
  assert.ok(conditionalWrites > 20);
});
