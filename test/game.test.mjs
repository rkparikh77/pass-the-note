import test from 'node:test';
import assert from 'node:assert/strict';
import { createRoom, joinRoom, start, advance, act, playerView, legalMoves } from '../game.mjs';
function fixture(n=4) {
  const players=Array.from({length:n},(_,i)=>({id:`secret-${i}`,publicId:`seat-${i}`,name:`Player ${i}`}));
  const room=createRoom('ABCD',players[0],0);for(const p of players.slice(1))joinRoom(room,p);start(room,players[0].id,0,()=>0);return room;
}
function submit(room,id,type,data={}){act(room,id,{type,round:room.round,gameNumber:room.gameNumber,...data},room.deadline-1,()=>0);}
function next(room){advance(room,room.deadline,()=>0);}
function deliveryRoute(room) {
  const queue=[[room.holder]];
  while(queue.length){const route=queue.shift(),last=route.at(-1);if(legalMoves(room,last).includes('deliver'))return [...route,'deliver'];for(const id of legalMoves(room,last))if(id!=='keep' && id!=='deliver' && id!==room.snitch && !route.includes(id))queue.push([...route,id]);}
  throw Error('No route');
}
function deliver(room){next(room);const route=deliveryRoute(room);for(const destination of route.slice(1)){submit(room,room.holder,'pass',{move:destination});next(room);if(room.phase==='guess')break;submit(room,room.snitch,'search',{target:room.snitch});next(room);next(room);next(room);}assert.equal(room.phase,'guess');}
test('all layouts permit delivery avoiding every possible Snitch seat',()=>{
  for(const count of [4,5,6]){const room=fixture(count);for(const snitch of room.players)for(const writer of room.players.filter(p=>p!==snitch)){room.snitch=snitch.id;room.holder=writer.id;assert.ok(deliveryRoute(room).length<=5);}}
});
test('per-player views exclude credentials, other roles, hidden actions, search and actual path',()=>{
  const room=fixture();next(room);submit(room,room.writer,'pass',{move:'keep'});
  for(const p of room.players){const view=playerView(room,p.id,1);assert.equal(view.me.role,p.role);assert.equal(view.me.holdsNote,p.id===room.writer);assert.equal(view.reveal,null);for(const other of room.players)assert.ok(!JSON.stringify(view).includes(other.id));assert.ok(view.players.every(p=>!Object.hasOwn(p,'role')));assert.equal(view.me.submitted,p.id===room.writer?'keep':null);assert.deepEqual(view.arrows,[]);}
  next(room);submit(room,room.snitch,'search',{target:room.writer});for(const p of room.players){const view=playerView(room,p.id);assert.equal(view.me.submitted,p.id===room.snitch?room.players.find(p=>p.id===room.writer).publicId:null);assert.deepEqual(view.searches,[]);}
});
test('simultaneous passes move once and later actions cannot overwrite a locked pass',()=>{
  const room=fixture();next(room);const holder=room.holder;const recipient=legalMoves(room,holder).find(id=>!['keep','deliver',room.snitch].includes(id));
  submit(room,holder,'pass',{move:recipient});submit(room,recipient,'pass',{move:holder});assert.throws(()=>submit(room,holder,'pass',{move:'keep'}),/locked/);submit(room,holder,'pass',{move:recipient});next(room);assert.equal(room.holder,recipient);assert.equal(room.path.length,2);
});
test('reject wrong phases, stale rounds, non-host start, illegal moves and non-Snitch search/guess',()=>{
  const room=fixture();assert.throws(()=>submit(room,room.writer,'pass',{move:'keep'}),/closed/);next(room);assert.throws(()=>submit(room,room.writer,'pass',{move:'garbage'}),/legal/);assert.throws(()=>act(room,room.writer,{type:'pass',move:'keep',round:999,gameNumber:1},room.deadline-1),/older/);submit(room,room.writer,'pass',{move:'keep'});next(room);assert.throws(()=>submit(room,room.writer,'search',{target:room.writer}),/Only the Snitch/);
  const winning=fixture();deliver(winning);assert.throws(()=>submit(winning,winning.writer,'guess',{target:winning.writer}),/Only the Snitch/);
  const lobby=createRoom('ABCD',{id:'a',publicId:'pa',name:'A'});joinRoom(lobby,{id:'b',publicId:'pb',name:'B'});assert.throws(()=>start(lobby,'b'),/host/);assert.throws(()=>start(lobby,'a'),/four/);
});
test('student delivery, bonus guess, public full path, scores, replay and role redeal for 4–6 players',()=>{
  for(const count of [4,5,6]){const room=fixture(count);deliver(room);assert.equal(room.outcome.winner,'students');assert.equal(playerView(room,room.writer).reveal,null);assert.ok(playerView(room,room.writer).players.every(p=>p.score===0));submit(room,room.snitch,'guess',{target:room.writer});assert.equal(room.phase,'over');const view=playerView(room,room.writer);assert.equal(view.reveal.roles.length,count);assert.equal(view.reveal.path.at(-1).to,'deliver');assert.equal(view.reveal.guess.correct,true);assert.equal(room.players.find(p=>p.id===room.snitch).score,1);assert.ok(room.players.filter(p=>p.id!==room.snitch).every(p=>p.score===2));
  act(room,room.hostId,{type:'again',gameNumber:room.gameNumber},999999);assert.equal(room.phase,'lobby');start(room,room.hostId,999999,()=>0.5);assert.equal(room.gameNumber,2);assert.equal(room.path.length,1);assert.equal(room.players.filter(p=>p.role==='Writer').length,1);assert.equal(room.players.filter(p=>p.role==='Snitch').length,1);}
});
test('search hit, interception, six-round timeout, guess timeout and offline catch-up',()=>{
  const searched=fixture();next(searched);next(searched);submit(searched,searched.snitch,'search',{target:searched.holder});next(searched);assert.equal(searched.outcome.winner,'snitch');assert.equal(searched.phase,'over');assert.equal(searched.players.find(p=>p.id===searched.snitch).score,6);
  const intercepted=fixture();next(intercepted);const neighbor=legalMoves(intercepted,intercepted.snitch).find(id=>!['keep','deliver'].includes(id));intercepted.holder=neighbor;submit(intercepted,neighbor,'pass',{move:intercepted.snitch});next(intercepted);assert.match(intercepted.outcome.reason,/intercepted/);
  const timeout=fixture();next(timeout);for(let i=0;i<6;i++){next(timeout);submit(timeout,timeout.snitch,'search',{target:timeout.snitch});next(timeout);if(i<5){next(timeout);next(timeout);}}assert.match(timeout.outcome.reason,/Six rounds/);
  const guessed=fixture();deliver(guessed);next(guessed);assert.equal(guessed.guess.correct,false);assert.equal(guessed.phase,'over');
  const offline=fixture();advance(offline,10000000,()=>0);assert.equal(offline.phase,'over');
});
test('deadline is authoritative and prior round retry cannot affect a new round',()=>{
  const room=fixture();next(room);const at=room.deadline;assert.throws(()=>act(room,room.writer,{type:'pass',move:'keep',round:1,gameNumber:1},at),/closed/);assert.equal(room.phase,'search');
});
