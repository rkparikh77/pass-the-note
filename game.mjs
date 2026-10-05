// Pure game rules: no HTTP, browser, storage or runtime-specific imports.
export class GameError extends Error {}
const requireRule = (condition, message) => { if (!condition) throw new GameError(message); };
export const NORMAL = { reveal: 25000, pass: 15000, search: 10000, result: 3000, talk: 30000, guess: 10000 };
export const SOLO = { reveal: 5000, pass: 60000, search: 30000, result: 2000, talk: 5000, guess: 30000 };
export function createRoom(code, player, now = Date.now()) {
  return { code, hostId: player.id, players: [{ ...player, score: 0, snitchGames: 0, writerGames: 0 }], phase: 'lobby', version: 1, deadline: null, round: 0, gameNumber: 0, lastActivity: now, solo: false };
}
export function joinRoom(room, player) {
  requireRule(room.phase === 'lobby', 'Join between games, while the room is in the lobby.');
  requireRule(room.players.length < 6, 'This room already has six players.');
  requireRule(!room.players.some(p => p.name.toLowerCase() === player.name.toLowerCase()), 'Choose a different player name.');
  room.players.push({ ...player, score: 0, snitchGames: 0, writerGames: 0 }); room.version++;
}
export function layout(count) {
  const seats = count === 4 ? [[0,0],[0,1],[1,0],[1,1]] : count === 5 ? [[0,0],[0,1],[1,0],[1,1],[1,2]] : [[0,0],[0,1],[0,2],[1,0],[1,1],[1,2]];
  return { seats: seats.map(([row,col]) => ({ row,col })), crush: { row: 0, col: count === 5 ? 2 : count === 4 ? 2 : 3 }, columns: count === 6 ? 4 : 3 };
}
const weighted = (players, field, random) => {
  const weights = players.map(p => 1 / (1 + p[field]) ** 2); let value = random() * weights.reduce((a,b) => a+b,0);
  return players.find((p,i) => (value -= weights[i]) < 0) || players.at(-1);
};
function phase(room, name, now) { room.phase = name; room.deadline = name === 'over' || name === 'lobby' ? null : now + room.timers[name]; room.version++; }
export function legalMoves(room, id) {
  const player = room.players.find(p => p.id === id); if (!player?.seat) return [];
  const { row,col } = player.seat;
  const moves = ['keep', ...room.players.filter(p => p.id !== id && Math.abs(p.seat.row-row)+Math.abs(p.seat.col-col) === 1).map(p => p.id)];
  if (!room.players.some(p => p.seat.row === row && p.seat.col > col)) moves.push('deliver');
  return moves;
}
function end(room, winner, reason, now) {
  room.outcome = { winner, reason }; phase(room, winner === 'students' ? 'guess' : 'over', now);
  for (const p of room.players) if (winner === 'students' ? p.role !== 'Snitch' : p.role === 'Snitch') p.score += winner === 'students' ? 2 : 2*(room.players.length-1);
}
export function start(room, id, now = Date.now(), random = Math.random) {
  requireRule(id === room.hostId, 'Only the host can start the game.');
  requireRule(room.phase === 'lobby', 'The game has already started.');
  requireRule(room.players.length >= 4 && room.players.length <= 6, 'You need four to six players.');
  const snitch = weighted(room.players, 'snitchGames', random);
  const writer = weighted(room.players.filter(p => p !== snitch), 'writerGames', random);
  const shuffled = [...room.players]; for (let i=shuffled.length-1;i>0;i--) { const j=Math.floor(random()*(i+1)); [shuffled[i],shuffled[j]]=[shuffled[j],shuffled[i]]; }
  room.board = layout(shuffled.length); shuffled.forEach((p,i) => { p.seat = room.board.seats[i]; p.role = p === snitch ? 'Snitch' : p === writer ? 'Writer' : 'Classmate'; });
  snitch.snitchGames++; writer.writerGames++; room.holder = writer.id; room.writer = writer.id; room.snitch = snitch.id;
  room.startScores = Object.fromEntries(room.players.map(p => [p.id,p.score]));
  room.gameNumber++; room.round = 1; room.actions = {}; room.arrows = []; room.searches = []; room.roundLog = []; room.path = [{ round: 0, from: null, to: writer.id }]; room.outcome = null; room.guess = null; room.result = null; room.target = null;
  room.timers = room.solo ? SOLO : NORMAL; phase(room, 'reveal', now);
}
export function advance(room, now = Date.now(), random = Math.random) {
  while (room.deadline !== null && now >= room.deadline) {
    const at = room.deadline;
    if (room.phase === 'reveal') phase(room, 'pass', at);
    else if (room.phase === 'pass') {
      for (const p of room.players) room.actions[p.id] ??= 'keep';
      room.arrows = room.players.map(p => ({ playerId: p.id, move: room.actions[p.id] ?? 'keep' }));
      room.roundLog.push({ round: room.round, arrows: room.arrows.map(a => ({ playerId: a.playerId, move: a.move })), search: null });
      const from = room.holder, move = room.actions[from] ?? 'keep'; const to = move === 'keep' ? from : move;
      room.path.push({ round: room.round, from, to }); room.holder = to;
      if (to === 'deliver') end(room, 'students', 'The note reached the Crush.', at);
      else if (to === room.snitch) end(room, 'snitch', 'The Snitch intercepted the note.', at);
      else { room.target = null; phase(room, 'search', at); }
    } else if (room.phase === 'search') {
      const target = room.target ?? room.players[Math.floor(random()*room.players.length)].id;
      const found = target === room.holder; room.result = { round: room.round, playerId: target, found }; room.searches.push(room.result);
      room.roundLog.at(-1).search = { playerId: target, found };
      if (found) end(room, 'snitch', 'The Teacher found the note.', at);
      else if (room.round >= 6) end(room, 'snitch', 'Six rounds passed without delivery.', at);
      else phase(room, 'result', at);
    } else if (room.phase === 'result') phase(room, 'talk', at);
    else if (room.phase === 'talk') { room.round++; room.actions = {}; room.target = null; phase(room, 'pass', at); }
    else if (room.phase === 'guess') { room.guess = { playerId: null, correct: false }; phase(room, 'over', at); }
  }
}
export function act(room, id, input, now = Date.now(), random = Math.random) {
  requireRule(room.players.some(p => p.id === id), 'Unknown player.'); advance(room, now, random);
  if (['start','settings','again'].includes(input.type)) requireRule(input.gameNumber === room.gameNumber, 'This action belongs to an older game.');
  if (input.type === 'start') return start(room, id, now, random);
  if (input.type === 'settings') { requireRule(id === room.hostId && room.phase === 'lobby', 'Only the host can change lobby settings.'); room.solo = input.solo === true; room.version++; return; }
  if (input.type === 'again') { requireRule(id === room.hostId && room.phase === 'over', 'Only the host can return a completed game to the lobby.'); phase(room, 'lobby', now); room.holder = null; room.actions = {}; return; }
  requireRule(input.gameNumber === room.gameNumber && input.round === room.round, 'This action belongs to an older game or round.');
  if (input.type === 'pass') {
    requireRule(room.phase === 'pass', 'Passing is closed.'); requireRule(legalMoves(room,id).includes(input.move), 'That desk is not a legal neighbor or delivery target.');
    requireRule(!Object.hasOwn(room.actions,id) || room.actions[id] === input.move, 'Your pass is already locked.');
    if (Object.hasOwn(room.actions,id)) return; // Identical retries are no-ops.
    room.actions[id] = input.move; room.version++;
  } else if (input.type === 'search') {
    requireRule(room.phase === 'search', 'Searching is closed.'); requireRule(id === room.snitch, 'Only the Snitch can search.'); requireRule(room.players.some(p => p.id === input.target), 'Search an occupied player desk.');
    requireRule(room.target === null || room.target === input.target, 'Your search is already locked.');
    if (room.target !== null) return;
    room.target = input.target;
    // A secret submission changes ONLY the actor's response version. Keep this
    // counter across games so older in-flight responses cannot overwrite it.
    const actor = room.players.find(p => p.id === id); actor.privateVersion = (actor.privateVersion ?? 0) + 1;
  } else if (input.type === 'guess') {
    requireRule(room.phase === 'guess', 'The Writer guess is closed.'); requireRule(id === room.snitch, 'Only the Snitch can guess.'); requireRule(room.players.some(p => p.id === input.target), 'Choose a player.');
    room.guess = { playerId: input.target, correct: input.target === room.writer }; if (room.guess.correct) room.players.find(p => p.id === id).score++; phase(room,'over',now);
  } else throw new GameError('Unknown action.');
}
// This allowlist is the ONLY representation the server sends to a player.
// Public seat IDs are unrelated to private authentication credentials.
export function playerView(room, id, now = Date.now()) {
  const me = room.players.find(p => p.id === id); requireRule(me, 'Unknown player.');
  const publicId = value => value === 'deliver' || value === 'keep' || value === null ? value : room.players.find(p => p.id === value)?.publicId;
  const active = !['lobby','over'].includes(room.phase);
  return {
    code: room.code, phase: room.phase, version: room.version + (me.privateVersion ?? 0), serverTime: now, deadline: room.deadline, round: room.round, gameNumber: room.gameNumber, solo: room.solo,
    players: room.players.map(p => ({ id: p.publicId, name: p.name, seat: room.phase === 'lobby' ? null : { row: p.seat.row, col: p.seat.col }, score: active ? room.startScores[p.id] : p.score, host: p.id === room.hostId, connected: p.connected ?? true })),
    board: room.phase === 'lobby' ? null : { seats: room.board.seats.map(s => ({ row: s.row, col: s.col })), crush: { row: room.board.crush.row, col: room.board.crush.col }, columns: room.board.columns },
    me: { id: me.publicId, name: me.name, host: me.id === room.hostId, role: active ? me.role : null, holdsNote: active && room.holder === id, moves: room.phase === 'pass' ? legalMoves(room,id).map(publicId) : [], submitted: room.phase === 'pass' ? publicId(room.actions?.[id] ?? null) : room.phase === 'search' && id === room.snitch ? publicId(room.target) : null },
    submittedCount: room.phase === 'pass' ? Object.keys(room.actions).length : null,
    arrows: room.phase === 'lobby' ? [] : (room.arrows ?? []).map(a => ({ playerId: publicId(a.playerId), move: publicId(a.move) })),
    searches: room.phase === 'lobby' ? [] : (room.searches ?? []).map(s => ({ round: s.round, playerId: publicId(s.playerId), found: s.found })),
    roundLog: room.phase === 'lobby' ? [] : (room.roundLog ?? []).map(entry => ({ round: entry.round, arrows: entry.arrows.map(a => ({ playerId: publicId(a.playerId), move: publicId(a.move) })), search: entry.search ? { playerId: publicId(entry.search.playerId), found: entry.search.found } : null })),
    outcome: room.outcome && ['guess','over'].includes(room.phase) ? { winner: room.outcome.winner, reason: room.outcome.reason } : null,
    // Roles, actual path and final holder are disclosed only AFTER the guess.
    reveal: room.phase === 'over' ? { roles: room.players.map(p => ({ id: p.publicId, role: p.role, snitchGames: p.snitchGames, writerGames: p.writerGames })), path: room.path.map(s => ({ round: s.round, from: publicId(s.from), to: publicId(s.to) })), holder: publicId(room.holder), guess: room.guess ? { playerId: publicId(room.guess.playerId), correct: room.guess.correct } : null } : null
  };
}
