import test from 'node:test';
import assert from 'node:assert/strict';
import { createGameHandler } from '../room-service.mjs';
import { MemoryStore } from './support/memory-store.mjs';
import { completeGame } from './support/function-flow.mjs';

test('four-player function game: simultaneous passes, search privacy, delivery, bonus and scores in game two', async () => {
  let clock = 1000; const store = new MemoryStore();
  const handler = createGameHandler({ store, now: () => clock, random: () => 0, pause: async () => {} });
  await completeGame(handler, time => { clock = time; }, { concurrent: true });
  assert.ok(store.conflicts > 0, 'Must exercise conflicting ETags');
});

test('concurrent joins preserve all players, enforce six seats, and never overwrite', async () => {
  const store = new MemoryStore(), handler = createGameHandler({ store, pause: async () => {} });
  const post = async input => { const result = await handler(new Request('https://game.test/.netlify/functions/game', { method: 'POST', body: JSON.stringify(input) })); return { status: result.status, data: await result.json() }; };
  const host = await post({ op: 'create', name: 'Host' }), code = host.data.view.code;
  const joins = await Promise.all(Array.from({ length: 7 }, (_, i) => post({ op: 'join', code, name: `Player ${i}` })));
  assert.equal(joins.filter(r => r.status === 201).length, 5); assert.equal(joins.filter(r => r.status === 400).length, 2);
  const room = store.entries.get(`rooms/${code}`).data; assert.equal(new Set(room.players.map(p => p.id)).size, 6); assert.ok(store.conflicts > 0);
});

test('conditional room creation handles collisions, and exhausted contention fails closed', async () => {
  const store = new MemoryStore(); let calls = 0;
  const handler = createGameHandler({ store, roomCode: () => calls++ < 2 ? 'ROOM' : 'NEXT', pause: async () => {} });
  const create = () => handler(new Request('https://game.test/.netlify/functions/game', { method: 'POST', body: JSON.stringify({ op: 'create', name: 'Host' }) }));
  const rooms = await Promise.all([create(), create()]); assert.ok(rooms.every(r => r.status === 201)); assert.equal(store.entries.size, 2); assert.ok(store.conflicts > 0);
  const host = await rooms[0].json(); let attempts = 0;
  const busy = createGameHandler({ store: { getWithMetadata: (...args) => store.getWithMetadata(...args), setJSON: async (_key, _room, opts) => { assert.ok(opts.onlyIfMatch); attempts++; return { modified: false }; } }, pause: async () => {} });
  const result = await busy(new Request(`https://game.test/.netlify/functions/game?op=view&code=${host.view.code}`, { headers: { Authorization: `Bearer ${host.playerId}` } }));
  assert.equal(result.status, 503); assert.equal(attempts, 20); assert.equal(result.headers.get('Retry-After'), '1');
});

test('function rejects cross-origin, malformed/oversized requests, and wrong HTTP methods', async () => {
  const handler = createGameHandler({ store: new MemoryStore() });
  const request = (body, headers = {}) => new Request('https://game.test/.netlify/functions/game', { method: 'POST', headers, body });
  assert.equal((await handler(request('{}', { Origin: 'https://other.test' }))).status, 403);
  assert.equal((await handler(request('invalid'))).status, 400);
  assert.equal((await handler(request(' '.repeat(4097)))).status, 400);
  assert.equal((await handler(new Request('https://game.test/.netlify/functions/game?op=action'))).status, 405);
});
