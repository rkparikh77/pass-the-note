import { randomBytes, randomInt } from 'node:crypto';
import { createRoom, joinRoom, advance, act, playerView, GameError } from './game.mjs';
import { present, leave, reconcilePresence } from './session.mjs';

const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const expiry = 24 * 60 * 60 * 1000;
const newPlayer = name => ({ id: randomBytes(32).toString('hex'), publicId: randomBytes(8).toString('hex'), rejoinCode: randomBytes(12).toString('hex').toUpperCase(), name });
const newCode = () => Array.from({ length: 4 }, () => alphabet[randomInt(alphabet.length)]).join('');
function name(value) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 24) throw new GameError('Enter a name of 1–24 characters.');
  return value.trim();
}
function response(status, data) {
  return Response.json(data, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...(status === 503 ? { 'Retry-After': '1' } : {}) } });
}
async function body(request) {
  if (Number(request.headers.get('content-length')) > 4096) throw new GameError('Request too large.');
  const reader = request.body?.getReader();
  if (!reader) throw new GameError('Invalid request.');
  let size = 0; const chunks = [];
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > 4096) { await reader.cancel(); throw new GameError('Request too large.'); }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const input = JSON.parse(new TextDecoder().decode(bytes));
    if (!input || Array.isArray(input) || typeof input !== 'object') throw new Error();
    return input;
  } catch (error) { if (error instanceof GameError) throw error; throw new GameError('Invalid request.'); }
}

// The store is a Netlify Blobs store in production. All mutations (including
// presence and timer advancement) commit ONE room with an ETag precondition.
// Failed candidates are discarded. Rules and authorization run again against
// the new snapshot; a stale whole-room write is never used as a fallback.
export function createGameHandler({ store, now = Date.now, random = () => randomBytes(6).readUIntBE(0, 6) / 2 ** 48, pause = ms => new Promise(resolve => setTimeout(resolve, ms)), roomCode = newCode } ) {
  return async request => {
    try {
      const url = new URL(request.url);
      if (url.pathname !== '/.netlify/functions/game') return response(404, { error: 'Not found.' });
      if (!['GET', 'POST'].includes(request.method)) return response(405, { error: 'Method not allowed.' });
      if (request.method === 'POST' && request.headers.get('origin') && request.headers.get('origin') !== url.origin) return response(403, { error: 'Origin rejected.' });
      const input = request.method === 'POST' ? await body(request) : Object.fromEntries(url.searchParams);
      const op = input.op;
      if (!['create', 'join', 'rejoin', 'view', 'action', 'leave'].includes(op)) return response(400, { error: 'Unknown operation.' });
      if ((op === 'view') !== (request.method === 'GET')) return response(405, { error: 'Method not allowed.' });
      const credential = request.headers.get('authorization')?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];
      const player = ['create', 'join'].includes(op) ? newPlayer(name(input.name)) : null;
      const code = String(input.code ?? '').toUpperCase();
      if (op !== 'create' && !/^[A-Z]{4}$/.test(code)) throw new GameError('Enter a four-letter room code.');
      if (op === 'create') {
        for (let attempt = 0; attempt < 32; attempt++) {
          const candidate = roomCode(); const at = now(); const key = `rooms/${candidate}`;
          const previous = await store.getWithMetadata(key, { type: 'json', consistency: 'strong' });
          if (previous && at - previous.data.lastActivity <= expiry) continue;
          if (previous && !previous.etag) throw new Error("Missing storage ETag");
          const room = createRoom(candidate, player, at);
          present(room, player.id, at); reconcilePresence(room, at);
          const { modified } = await store.setJSON(key, room, previous ? { onlyIfMatch: previous.etag } : { onlyIfNew: true });
          if (modified) return response(201, { playerId: player.id, rejoinCode: player.rejoinCode, view: playerView(room, player.id, at) });
        }
        return response(503, { error: 'Could not reserve a room. Try again.' });
      }
      const key = `rooms/${code}`;
      for (let attempt = 0; attempt < 20; attempt++) {
        const snapshot = await store.getWithMetadata(key, { type: 'json', consistency: 'strong' });
        const at = now();
        if (!snapshot || at - snapshot.data.lastActivity > expiry) {
          if (op === 'join' || op === 'rejoin') throw new GameError('Room not found. Check the four-letter code.');
          return response(404, { error: 'Room no longer exists. Create a new room.', reset: true });
        }
        // Missing ETags must never cause an unconditional write.
        if (!snapshot.etag) throw new Error('Missing storage ETag');
        const room = structuredClone(snapshot.data); let id = credential;
        if (op === 'join') {
          advance(room, at, random); joinRoom(room, player); id = player.id;
          present(room, id, at); reconcilePresence(room, at);
        } else if (op === 'rejoin') {
          const rejoinCode = typeof input.rejoinCode === 'string' ? input.rejoinCode.replace(/[\s-]/g, '').toUpperCase() : '';
          const returning = room.players.find(p => p.rejoinCode === rejoinCode);
          if (!returning) throw new GameError('Room or rejoin key is incorrect.');
          id = returning.id; present(room, id, at); reconcilePresence(room, at); advance(room, at, random);
        } else {
          if (!room.players.some(p => p.id === id)) return response(401, { error: 'Your player session is invalid.', reset: true });
          if (op === 'leave') { leave(room, id); reconcilePresence(room, at); advance(room, at, random); }
          else if (op === 'view') { present(room, id, at); reconcilePresence(room, at); advance(room, at, random); }
          else {
            reconcilePresence(room, at);
            const action = { ...input };
            const resolve = value => { const target = room.players.find(p => p.publicId === value); if (!target) throw new GameError('Choose a public player desk ID.'); return target.id; };
            if (action.move !== undefined && !['keep', 'deliver'].includes(action.move)) action.move = resolve(action.move);
            if (action.target !== undefined) action.target = resolve(action.target);
            act(room, id, action, at, random);
          }
        }
        room.lastActivity = at;
        const { modified } = await store.setJSON(key, room, { onlyIfMatch: snapshot.etag });
        if (modified) {
          const result = { view: playerView(room, id, at) };
          if (op === 'join' || op === 'rejoin') {
            const self = room.players.find(p => p.id === id);
            result.playerId = self.id; result.rejoinCode = self.rejoinCode;
          }
          return response(op === 'join' ? 201 : 200, result);
        }
        await pause(5 + randomInt(30));
      }
      return response(503, { error: 'Room is busy. Please try again.' });
    } catch (error) {
      return response(error instanceof GameError ? 400 : 500, { error: error instanceof GameError ? error.message : 'Server error. Try again.' });
    }
  };
}
