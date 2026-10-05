import test from 'node:test';
import assert from 'node:assert/strict';
import { createGameServer } from './support/legacy-server.mjs';
import { createRoom, joinRoom, start, advance, act, playerView, legalMoves } from '../game.mjs';
function fixture() { const ps=Array.from({length:4},(_,i)=>({id:`private-${i}`,publicId:`public-${i}`,name:`P${i}`})); const r=createRoom('ABCD',ps[0],0); ps.slice(1).forEach(p=>joinRoom(r,p)); start(r,ps[0].id,0,()=>0); return r; }
function next(r){advance(r,r.deadline,()=>0);}
function action(r,id,type,extra={}){act(r,id,{type,round:r.round,gameNumber:r.gameNumber,...extra},r.deadline-1,()=>0);}
test('private search and identical retries cannot change other players responses, even metadata',()=>{
  const r=fixture();next(r);next(r);const now=r.deadline-1;
  const before=r.players.map(p=>JSON.stringify(playerView(r,p.id,now)));
  action(r,r.snitch,'search',{target:r.snitch});
  for(let i=0;i<r.players.length;i++){if(r.players[i].id!==r.snitch)assert.equal(JSON.stringify(playerView(r,r.players[i].id,now)),before[i]);}
  const all=r.players.map(p=>JSON.stringify(playerView(r,p.id,now)));
  action(r,r.snitch,'search',{target:r.snitch});assert.deepEqual(r.players.map(p=>JSON.stringify(playerView(r,p.id,now))),all);
  assert.throws(()=>action(r,r.snitch,'search',{target:r.writer}),/locked/);
  const pass=fixture();next(pass);action(pass,pass.writer,'pass',{move:'keep'});const version=pass.version;action(pass,pass.writer,'pass',{move:'keep'});assert.equal(pass.version,version);
});
test('a non-holder cannot move or deliver the real note or spoof an actor/holder in payload',()=>{
  const r=fixture();next(r);const fake=r.players.find(p=>p.id!==r.writer && legalMoves(r,p.id).includes('deliver'));
  action(r,fake.id,'pass',{move:'deliver',holder:fake.id,playerId:r.writer});next(r);assert.equal(r.holder,r.writer);assert.equal(r.phase,'search');assert.equal(r.outcome,null);
});
test('nested view fields remain allowlisted when internal records acquire extra secrets',()=>{
  const r=fixture();next(r);next(r);action(r,r.snitch,'search',{target:r.snitch});next(r);
  r.board.internalSecret='LEAK';r.board.seats[0].secret='LEAK';r.searches[0].chosenBy='LEAK';r.searches[0].holder='LEAK';
  r.roundLog[0].chosenBy='LEAK';r.roundLog[0].arrows[0].holder='LEAK';r.roundLog[0].search.privateTarget='LEAK';
  assert.ok(!JSON.stringify(playerView(r,r.writer)).includes('LEAK'));
  r.phase='over';r.outcome={winner:'snitch',reason:'Test',privateSecret:'LEAK'};r.guess={playerId:r.writer,correct:true,privateSecret:'LEAK'};r.path[0].credential='LEAK';
  assert.ok(!JSON.stringify(playerView(r,r.writer)).includes('LEAK'));
});

for(const count of [4,5,6])test(`HTTP audit: every role in every phase; tampering and retries (${count} players)`,async t=>{
  let clock=0;const server=createGameServer({now:()=>clock,random:()=>0});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}));
  const origin=`http://127.0.0.1:${server.address().port}`;
  const call=async(path,body,id)=>{const response=await fetch(origin+path,{method:body?'POST':'GET',headers:{...(body?{'Content-Type':'application/json'}:{}),...(id?{Authorization:`Bearer ${id}`}:{})},...(body?{body:JSON.stringify(body)}:{})});return {status:response.status,data:await response.json(),cache:response.headers.get('cache-control')};};
  const host=(await call('/api/create',{name:'Host'})).data,code=host.view.code;const players=[host];
  for(let i=1;i<count;i++)players.push((await call('/api/join',{name:`P${i}`,code})).data);
  const poll=async()=>Promise.all(players.map(p=>call(`/api/rooms/${code}`,null,p.playerId)));
  const send=async(p,input)=>call(`/api/rooms/${code}/action`,input,p.playerId);
  const root=['code','phase','version','serverTime','deadline','round','gameNumber','solo','players','board','me','submittedCount','arrows','searches','roundLog','outcome','reveal'].sort();
  const seen=new Set();
  async function sample(phase){const results=await poll();for(const result of results){assert.equal(result.status,200);assert.equal(result.cache,'no-store');assert.deepEqual(Object.keys(result.data),['view']);const v=result.data.view;assert.equal(v.phase,phase);assert.deepEqual(Object.keys(v).sort(),root);assert.deepEqual(Object.keys(v.me).sort(),['id','name','host','role','holdsNote','moves','submitted'].sort());
    for(const p of players)assert.ok(!JSON.stringify(v).includes(p.playerId));
    for(const p of v.players)assert.deepEqual(Object.keys(p).sort(),['id','name','seat','score','host','connected'].sort());
    if(phase!=='over')assert.equal(v.reveal,null);
    if(phase!=='lobby' && phase!=='over')seen.add(`${phase}:${v.me.role}`);
    if(phase!=='pass')assert.deepEqual(v.me.moves,[]);
  }return results.map(r=>r.data.view);}
  await sample('lobby');assert.equal((await send(players[1],{type:'start',gameNumber:0})).status,400);
  assert.equal((await send(players[0],{type:'start',gameNumber:0})).status,200);
  let views=await sample('reveal');const writerIndex=views.findIndex(v=>v.me.role==='Writer'),snitchIndex=views.findIndex(v=>v.me.role==='Snitch');const writer=players[writerIndex],snitch=players[snitchIndex];
  clock=views[0].deadline;views=await sample('pass');
  const base={gameNumber:1,round:1};
  const first=await send(writer,{type:'pass',move:'keep',...base});assert.equal(first.status,200);
  const retry=await send(writer,{type:'pass',move:'keep',...base});assert.deepEqual(retry.data,first.data);
  const otherMove=views[writerIndex].me.moves.find(m=>m!=='keep');assert.equal((await send(writer,{type:'pass',move:otherMove,...base})).status,400);
  // Test the transport boundary: a private credential cannot be used as a desk ID.
  assert.equal((await send(writer,{type:'pass',move:writer.playerId,...base})).status,400);
  for(let i=0;i<count;i++)if(i!==writerIndex){const move=views[i].me.moves.includes('deliver')?'deliver':'keep';assert.equal((await send(players[i],{type:'pass',move,playerId:writer.playerId,holder:players[i].view.me.id,...base})).status,200);}
  clock=views[0].deadline;views=await sample('search');assert.equal(views[writerIndex].me.holdsNote,true);assert.ok(views.every((v,i)=>v.me.holdsNote===(i===writerIndex)));
  assert.equal((await send(writer,{type:'search',target:snitch.view.me.id,playerId:snitch.playerId,...base})).status,400);
  const nonSnitchBefore=JSON.stringify(views.filter((v,i)=>i!==snitchIndex));
  const chosen=await send(snitch,{type:'search',target:snitch.view.me.id,...base});assert.equal(chosen.status,200);
  const chosenAgain=await send(snitch,{type:'search',target:snitch.view.me.id,...base});assert.deepEqual(chosenAgain.data,chosen.data);
  views=await sample('search');assert.equal(JSON.stringify(views.filter((v,i)=>i!==snitchIndex)),nonSnitchBefore);
  assert.equal((await send(snitch,{type:'search',target:writer.view.me.id,...base})).status,400);
  clock=views[0].deadline;views=await sample('result');clock=views[0].deadline;views=await sample('talk');clock=views[0].deadline;views=await sample('pass');
  // Find a public-board route to delivery without the Snitch, then execute it.
  const all=views[0].players,queue=[[writer.view.me.id]];let route;
  while(queue.length){const candidate=queue.shift(),id=candidate.at(-1),seat=all.find(p=>p.id===id).seat;if(!all.some(p=>p.seat.row===seat.row && p.seat.col>seat.col)){route=[...candidate,'deliver'];break;}for(const p of all)if(p.id!==snitch.view.me.id && !candidate.includes(p.id) && Math.abs(p.seat.row-seat.row)+Math.abs(p.seat.col-seat.col)===1)queue.push([...candidate,p.id]);}
  assert.ok(route);
  for(let i=1;i<route.length;i++){
    const owner=players.find(p=>p.view.me.id===route[i-1]);const v=views[0];assert.equal((await send(owner,{type:'pass',move:route[i],gameNumber:v.gameNumber,round:v.round})).status,200);clock=v.deadline;
    if(route[i]==='deliver'){views=await sample('guess');break;}
    views=await sample('search');await send(snitch,{type:'search',target:snitch.view.me.id,gameNumber:1,round:views[0].round});clock=views[0].deadline;views=await sample('result');clock=views[0].deadline;views=await sample('talk');clock=views[0].deadline;views=await sample('pass');
  }
  assert.ok(views.every(v=>v.players.every(p=>p.score===0)));assert.ok(views.every(v=>!v.me.holdsNote));
  const guess={type:'guess',target:writer.view.me.id,gameNumber:1,round:views[0].round};assert.equal((await send(writer,guess)).status,400);assert.equal((await send(snitch,guess)).status,200);
  views=await sample('over');assert.equal(views[0].reveal.guess.correct,true);assert.equal(views[0].reveal.roles.length,count);assert.equal(views[0].reveal.path.at(-1).to,'deliver');
  const scores=views[0].players.map(p=>p.score);assert.equal((await send(snitch,guess)).status,400);assert.deepEqual((await poll())[0].data.view.players.map(p=>p.score),scores);
  assert.equal((await send(host,{type:'again',gameNumber:0})).status,400);assert.equal((await send(host,{type:'again',gameNumber:1})).status,200);await sample('lobby');
  assert.equal((await send(host,{type:'start',gameNumber:0})).status,400);assert.equal((await send(host,{type:'start',gameNumber:1})).status,200);await sample('reveal');
  for(const phase of ['reveal','pass','search','result','talk','guess'])for(const role of ['Writer','Snitch','Classmate'])assert.ok(seen.has(`${phase}:${role}`));
});
