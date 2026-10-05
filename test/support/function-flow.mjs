import assert from 'node:assert/strict';
export async function completeGame(handler, setTime, { concurrent = false } = {}) {
  const origin = 'https://classroom.example'; let code;
  async function raw(op, input, id) {
    const response = await handler(new Request(origin + '/.netlify/functions/game' + (op === 'view' ? `?op=view&code=${code}` : ''), {
      method: op === 'view' ? 'GET' : 'POST', headers: { ...(op !== 'view' ? { 'Content-Type': 'application/json', Origin: origin } : {}), ...(id ? { Authorization: `Bearer ${id}` } : {}) },
      ...(op !== 'view' ? { body: JSON.stringify({ op, code, ...input }) } : {}),
    }));
    assert.equal(response.headers.get('cache-control'), 'no-store');
    return { status: response.status, data: await response.json() };
  }
  const created = await raw('create', { name: 'Alex' }); assert.equal(created.status, 201, JSON.stringify(created.data)); const host = created.data; code = host.view.code;
  const players = [host]; for (const name of ['Blair', 'Casey', 'Drew']) { const joined = await raw('join', { name }); assert.equal(joined.status, 201, JSON.stringify(joined.data)); players.push(joined.data); }
  const get = async p => { const result = await raw('view', null, p.playerId); assert.equal(result.status, 200); return result.data.view; };
  const all = async () => { if (concurrent) return Promise.all(players.map(get)); const views = []; for (const p of players) views.push(await get(p)); return views; };
  const send = async (p, action, view) => raw('action', { ...action, round: view.round, gameNumber: view.gameNumber }, p.playerId);
  assert.equal((await raw('view')).status, 401);
  assert.equal((await raw('view', null, host.view.me.id)).status, 401);
  assert.equal((await raw('action', { type: 'start', gameNumber: 0 }, players[1].playerId)).status, 400);
  assert.equal((await raw('action', { type: 'start', gameNumber: 0 }, host.playerId)).status, 200);
  let views = await all(), view = views[0];
  const writer = players[views.findIndex(v => v.me.role === 'Writer')], snitch = players[views.findIndex(v => v.me.role === 'Snitch')];
  function secrets(views) {
    for (const v of views) {
      assert.equal(v.reveal, null);
      for (const p of players) { assert.ok(!JSON.stringify(v).includes(p.playerId)); assert.ok(!JSON.stringify(v).includes(p.rejoinCode)); }
      assert.ok(v.players.every(p => !Object.hasOwn(p, 'role') && !Object.hasOwn(p, 'holdsNote')));
    }
  }
  secrets(views); assert.equal(views.filter(v => v.me.holdsNote).length, 1);
  assert.equal((await raw('rejoin', { rejoinCode: writer.rejoinCode })).data.view.me.role, 'Writer');
  setTime(view.deadline); views = await all(); view = views[0]; assert.equal(view.phase, 'pass');
  // First round has real/fake passes that keep their current destinations.
  // This guarantees a search round even when the Writer starts at a ★ desk.
  const first = await send(writer, { type: 'pass', move: 'keep' }, view); assert.equal(first.status, 200);
  assert.equal((await send(writer, { type: 'pass', move: 'keep' }, view)).status, 200);
  const alternative = first.data.view.me.moves.find(move => move !== 'keep');
  assert.equal((await send(writer, { type: 'pass', move: alternative }, view)).status, 400);
  if (concurrent) await Promise.all(players.filter(p => p !== writer).map(p => send(p, { type: 'pass', move: 'keep' }, view)));
  setTime(view.deadline); views = await all(); view = views[0]; assert.equal(view.phase, 'search'); assert.ok(view.arrows.every(a => a.move === 'keep'));
  async function searchRound() {
    const before = await get(writer);
    assert.equal((await send(writer, { type: 'search', target: writer.view.me.id }, view)).status, 400);
    const selected = await send(snitch, { type: 'search', target: snitch.view.me.id }, view); assert.equal(selected.status, 200);
    assert.equal((await send(snitch, { type: 'search', target: snitch.view.me.id }, view)).status, 200);
    assert.equal((await send(snitch, { type: 'search', target: writer.view.me.id }, view)).status, 400);
    assert.deepEqual(await get(writer), before, 'Search actor/timing must stay private');
    setTime(view.deadline); views = await all(); view = views[0]; assert.equal(view.phase, 'result'); assert.equal(view.searches.at(-1).found, false); secrets(views);
    setTime(view.deadline); view = await get(writer); assert.equal(view.phase, 'talk'); await all();
    setTime(view.deadline); views = await all(); view = views[0]; assert.equal(view.phase, 'pass');
  }
  await searchRound();
  const board = view.players, writerSeat = board.find(p => p.id === writer.view.me.id).seat;
  const neighbor = board.find(p => p.id !== snitch.view.me.id && p.id !== writer.view.me.id && Math.abs(p.seat.row - writerSeat.row) + Math.abs(p.seat.col - writerSeat.col) === 1);
  assert.ok(neighbor); const queue = [[neighbor.id]]; let route;
  while (queue.length) {
    const path = queue.shift(), id = path.at(-1), seat = board.find(p => p.id === id).seat;
    if (!board.some(p => p.seat.row === seat.row && p.seat.col > seat.col)) { route = [writer.view.me.id, ...path, 'deliver']; break; }
    for (const p of board) if (p.id !== snitch.view.me.id && !path.includes(p.id) && Math.abs(p.seat.row - seat.row) + Math.abs(p.seat.col - seat.col) === 1) queue.push([...path, p.id]);
  }
  assert.ok(route);
  for (let i = 1; i < route.length; i++) {
    const owner = players.find(p => p.view.me.id === route[i - 1]);
    if (concurrent) {
      const actions = players.map(p => send(p, { type: 'pass', move: p === owner ? route[i] : 'keep' }, view));
      for (const result of await Promise.all(actions)) assert.equal(result.status, 200);
    } else {
      for (const p of players) assert.equal((await send(p, { type: 'pass', move: p === owner ? route[i] : 'keep' }, view)).status, 200);
    }
    const locked = await get(owner); assert.equal(locked.me.submitted, route[i]);
    setTime(view.deadline); views = await all(); view = views[0]; secrets(views);
    if (route[i] === 'deliver') { assert.equal(view.phase, 'guess'); break; }
    assert.equal(view.phase, 'search'); assert.equal(views.filter(v => v.me.holdsNote).length, 1); assert.equal(views.find(v => v.me.id === route[i]).me.holdsNote, true);
    await searchRound();
  }
  assert.equal(view.outcome.winner, 'students'); assert.ok(view.players.every(p => p.score === 0));
  assert.equal((await send(writer, { type: 'guess', target: writer.view.me.id }, view)).status, 400);
  if (concurrent) {
    const guesses = await Promise.all([send(snitch, { type: 'guess', target: writer.view.me.id }, view), send(snitch, { type: 'guess', target: writer.view.me.id }, view)]);
    assert.deepEqual(guesses.map(result => result.status).sort(), [200, 400]);
  } else assert.equal((await send(snitch, { type: 'guess', target: writer.view.me.id }, view)).status, 200);
  assert.equal((await send(snitch, { type: 'guess', target: writer.view.me.id }, view)).status, 400);
  views = await all(); view = views[0]; assert.equal(view.phase, 'over'); assert.equal(view.reveal.guess.correct, true); assert.equal(view.reveal.roles.length, 4); assert.equal(view.reveal.path.at(-1).to, 'deliver');
  assert.equal(view.players.find(p => p.id === snitch.view.me.id).score, 1); assert.ok(view.players.filter(p => p.id !== snitch.view.me.id).every(p => p.score === 2));
  const scores = view.players.map(p => p.score);
  assert.equal((await send(host, { type: 'again' }, view)).status, 200); view = await get(host); assert.equal(view.phase, 'lobby'); assert.deepEqual(view.players.map(p => p.score), scores);
  assert.equal((await send(host, { type: 'start' }, view)).status, 200); view = await get(host); assert.equal(view.gameNumber, 2); assert.deepEqual(view.players.map(p => p.score), scores); assert.equal(view.reveal, null);
  return { raw, get, players, code };
}
