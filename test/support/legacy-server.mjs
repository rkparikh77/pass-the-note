import http from 'node:http';
import { randomBytes, randomInt } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { createRoom, joinRoom, advance, act, playerView, GameError } from '../../game.mjs';
import { present, leave, reconcilePresence } from '../../session.mjs';

// Local adapter only. Replace this Map with transactional durable storage when
// moving to serverless. Rule execution itself is synchronous and atomic here.
const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const newPlayer = name => ({ id: randomBytes(32).toString('hex'), publicId: randomBytes(8).toString('hex'), rejoinCode: randomBytes(12).toString('hex').toUpperCase(), name });
function code(rooms) { let result; do { result = Array.from({length:4},()=>alphabet[randomInt(alphabet.length)]).join(''); } while (rooms.has(result)); return result; }
function name(value) { if (typeof value !== 'string' || !value.trim() || value.trim().length > 24) throw new GameError('Enter a name of 1–24 characters.'); return value.trim(); }
async function body(req) {
  let text = ''; for await (const chunk of req) { text += chunk; if (text.length > 4096) throw new GameError('Request too large.'); }
  try { const value = JSON.parse(text); if (!value || Array.isArray(value) || typeof value !== 'object') throw Error(); return value; } catch { throw new GameError('Invalid request.'); }
}
const files = { '/': ['index.html','text/html'], '/app.js': ['app.js','text/javascript'], '/style.css': ['style.css','text/css'], '/favicon.svg': ['favicon.svg','image/svg+xml'] };
// Clock injection allows full HTTP security tests without waiting for timers.
// Production always uses server time and cryptographically secure randomness.
export function createGameServer({ now = Date.now, random = () => randomBytes(6).readUIntBE(0,6) / 2**48 } = {}) {
const rooms = new Map();
const server = http.createServer(async (req,res) => {
  const send = (status,data) => { res.writeHead(status, { 'Content-Type':'application/json', 'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff' }); res.end(JSON.stringify(data)); };
  try {
    const url = new URL(req.url, 'http://localhost');
    if (!url.pathname.startsWith('/api/')) {
      if (req.method !== 'GET' || !files[url.pathname]) return send(404,{error:'Not found.'});
      const [file,type] = files[url.pathname]; res.writeHead(200, { 'Content-Type':type, 'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff', 'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; frame-ancestors 'none'; base-uri 'none'" }); res.end(await readFile(new URL(`../../public/${file}`,import.meta.url))); return;
    }
    // No CORS. Browser mutations must originate from this local app.
    if (req.method === 'POST' && req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) return send(403,{error:'Origin rejected.'});
    if (req.method === 'POST' && url.pathname === '/api/create') {
      const input = await body(req), player = newPlayer(name(input.name)), room = createRoom(code(rooms),player,now()); rooms.set(room.code,room);
      present(room,player.id,now()); reconcilePresence(room,now());
      return send(201,{playerId:player.id, rejoinCode:player.rejoinCode, view:playerView(room,player.id,now())});
    }
    if (req.method === 'POST' && url.pathname === '/api/join') {
      const input = await body(req), room = rooms.get(String(input.code).toUpperCase()); if (!room) throw new GameError('Room not found. Check the four-letter code.');
      advance(room,now(),random); const player = newPlayer(name(input.name)); joinRoom(room,player); room.lastActivity = now();
      present(room,player.id,now()); reconcilePresence(room,now());
      return send(201,{playerId:player.id,rejoinCode:player.rejoinCode,view:playerView(room,player.id,now())});
    }
    if (req.method === 'POST' && url.pathname === '/api/rejoin') {
      const input = await body(req), room = rooms.get(String(input.code).toUpperCase());
      const key = typeof input.rejoinCode === 'string' ? input.rejoinCode.replace(/[\s-]/g,'').toUpperCase() : '';
      const player = room?.players.find(p => p.rejoinCode === key);
      if (!player) throw new GameError('Room or rejoin key is incorrect.');
      present(room,player.id,now()); reconcilePresence(room,now()); advance(room,now(),random); room.lastActivity=now();
      return send(200,{playerId:player.id,rejoinCode:player.rejoinCode,view:playerView(room,player.id,now())});
    }
    const match = url.pathname.match(/^\/api\/rooms\/([A-Z]{4})(\/(?:action|leave))?$/); if (!match) return send(404,{error:'Not found.'});
    const room = rooms.get(match[1]); if (!room) return send(404,{error:'Room no longer exists. Create a new room.',reset:true});
    const id = req.headers.authorization?.replace(/^Bearer /,''); if (!room.players.some(p=>p.id===id)) return send(401,{error:'Your player session is invalid.',reset:true});
    room.lastActivity = now();
    if (req.method === 'POST' && match[2] === '/leave') {
      leave(room,id); reconcilePresence(room,now()); advance(room,now(),random);
    } else if (req.method === 'POST' && match[2] === '/action') {
      const input = await body(req);
      reconcilePresence(room,now());
      // Public seat references are resolved here, never used as authentication.
      const resolve = value => { const player = room.players.find(p=>p.publicId===value); if (!player) throw new GameError('Choose a public player desk ID.'); return player.id; };
      if (input.move !== undefined && !['keep','deliver'].includes(input.move)) input.move = resolve(input.move);
      if (input.target !== undefined) input.target = resolve(input.target);
      act(room,id,input,now(),random);
    } else if (req.method === 'GET' && !match[2]) { present(room,id,now()); reconcilePresence(room,now()); advance(room,now(),random); }
    else return send(405,{error:'Method not allowed.'});
    send(200,{view:playerView(room,id,now())});
  } catch (error) { send(error instanceof GameError ? 400 : 500,{error:error instanceof GameError ? error.message : 'Server error. Try again.'}); if (!(error instanceof GameError)) console.error(error); }
});
const cleanup = setInterval(()=>{ for (const [key,room] of rooms) if (now()-room.lastActivity > 24*60*60*1000) rooms.delete(key); },60*60*1000); cleanup.unref();
server.on('close',()=>clearInterval(cleanup));
return server;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = createGameServer();
  const port = Number(process.env.PORT || 3000);
  server.listen(port,'127.0.0.1',()=>console.log(`Pass the Note is running at http://localhost:${server.address().port}`));
}
