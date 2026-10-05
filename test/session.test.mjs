import test from 'node:test';
import assert from 'node:assert/strict';
import { createGameServer } from './support/legacy-server.mjs';
import { present, leave, reconcilePresence, DISCONNECT_GRACE } from '../session.mjs';
test('host handoff respects grace, join order, explicit leave, and returning host',()=>{
  const room={players:[{id:'a'},{id:'b'},{id:'c'}],hostId:'a',version:1};
  room.players.forEach(p=>present(room,p.id,0));reconcilePresence(room,0);
  present(room,'c',DISCONNECT_GRACE-1);reconcilePresence(room,DISCONNECT_GRACE-1);assert.equal(room.hostId,'a');
  reconcilePresence(room,DISCONNECT_GRACE);assert.equal(room.hostId,'c');
  present(room,'a',DISCONNECT_GRACE+1);reconcilePresence(room,DISCONNECT_GRACE+1);assert.equal(room.hostId,'c');
  leave(room,'c');reconcilePresence(room,DISCONNECT_GRACE+1);assert.equal(room.hostId,'a');
});
async function setup(t,count){
  let clock=1000;const server=createGameServer({now:()=>clock,random:()=>0});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}));
  const origin=`http://127.0.0.1:${server.address().port}`;
  async function raw(path,input,credential){const response=await fetch(origin+path,{method:input?'POST':'GET',headers:{...(input?{'Content-Type':'application/json'}:{}),...(credential?{Authorization:`Bearer ${credential}`}:{})},...(input?{body:JSON.stringify(input)}:{})});return {status:response.status,data:await response.json()};}
  const host=(await raw('/api/create',{name:'Host'})).data,code=host.view.code,players=[host];
  for(let i=1;i<count;i++)players.push((await raw('/api/join',{name:`Player ${i}`,code})).data);
  const get=async p=>{const result=await raw(`/api/rooms/${code}`,null,p.playerId);assert.equal(result.status,200);return result.data.view;};
  const send=async(p,input)=>raw(`/api/rooms/${code}/action`,input,p.playerId);
  const depart=p=>raw(`/api/rooms/${code}/leave`,{},p.playerId);
  const rejoin=p=>raw('/api/rejoin',{code,rejoinCode:p.rejoinCode});
  const all=()=>Promise.all(players.map(get));
  return {raw,players,code,get,send,depart,rejoin,all,setTime:value=>{clock=value;}};
}
for(const count of [4,6])test(`full ${count}-player HTTP game: refresh/rejoin, absent holder, timeout defaults, host leave, log and replay`,async t=>{
  const api=await setup(t,count),{players,get,send}=api;
  assert.equal((await send(players[0],{type:'start',gameNumber:0})).status,200);
  let views=await api.all();const writer=players[views.findIndex(v=>v.me.role==='Writer')],snitch=players[views.findIndex(v=>v.me.role==='Snitch')];
  const originals=new Map(views.map(v=>[v.me.id,{role:v.me.role,seat:v.players.find(p=>p.id===v.me.id).seat}]));
  const refresh=await get(writer);assert.equal(refresh.me.role,'Writer');assert.equal(refresh.me.holdsNote,true);assert.deepEqual(refresh.players.find(p=>p.id===refresh.me.id).seat,originals.get(refresh.me.id).seat);
  api.setTime(views[0].deadline);views=await api.all();assert.equal(views[0].phase,'pass');
  assert.equal((await api.depart(players[0])).status,200);let view=await get(writer);assert.equal(view.me.host,true);assert.equal(view.players[0].connected,false);
  assert.equal((await send(players[0],{type:'settings',solo:true,gameNumber:1})).status,400);
  // Nobody acts: all passes must resolve to Keep, even for the absent Snitch.
  api.setTime(view.deadline);view=await get(writer);assert.equal(view.phase,'search');assert.ok(view.arrows.every(a=>a.move==='keep'));assert.equal(view.me.holdsNote,true);assert.equal(view.roundLog.length,1);assert.equal(view.roundLog[0].search,null);
  // The Snitch is still away: search timeout chooses a desk using injected RNG.
  api.setTime(view.deadline);view=await get(writer);assert.equal(view.phase,'result');assert.equal(view.searches[0].playerId,snitch.view.me.id);assert.equal(view.roundLog[0].search.playerId,snitch.view.me.id);
  assert.equal((await api.raw('/api/rejoin',{code:api.code,rejoinCode:'WRONG'})).status,400);
  const recovered=await api.rejoin(snitch);assert.equal(recovered.status,200);assert.equal(recovered.data.playerId,snitch.playerId);assert.equal(recovered.data.view.me.role,'Snitch');assert.equal(recovered.data.view.me.host,false);assert.deepEqual(recovered.data.view.players.find(p=>p.id===snitch.view.me.id).seat,originals.get(snitch.view.me.id).seat);
  // Keep the new host's heartbeat alive while advancing the discussion deadline.
  api.setTime(view.deadline);view=await get(writer);assert.equal(view.phase,'talk');await api.all();api.setTime(view.deadline);view=await get(writer);assert.equal(view.phase,'pass');await api.all();
  const board=view.players,queue=[[writer.view.me.id]];let route;
  while(queue.length){const path=queue.shift(),id=path.at(-1),seat=board.find(p=>p.id===id).seat;if(!board.some(p=>p.seat.row===seat.row && p.seat.col>seat.col)){route=[...path,'deliver'];break;}for(const p of board)if(p.id!==snitch.view.me.id && !path.includes(p.id) && Math.abs(p.seat.row-seat.row)+Math.abs(p.seat.col-seat.col)===1)queue.push([...path,p.id]);}
  assert.ok(route);let checkedAbsentHolder=false;
  for(let i=1;i<route.length;i++){
    const owner=players.find(p=>p.view.me.id===route[i-1]);
    const recipient=players.find(p=>p.view.me.id===route[i]);
    if(recipient && !checkedAbsentHolder)assert.equal((await api.depart(recipient)).status,200);
    assert.equal((await send(owner,{type:'pass',move:route[i],round:view.round,gameNumber:1})).status,200);
    api.setTime(view.deadline);view=await get(writer);
    if(route[i]==='deliver'){assert.equal(view.phase,'guess');break;}
    assert.equal(view.phase,'search');
    if(recipient && !checkedAbsentHolder){const returned=await api.rejoin(recipient);assert.equal(returned.status,200);assert.equal(returned.data.view.me.holdsNote,true);assert.equal(returned.data.view.me.role,originals.get(recipient.view.me.id).role);assert.deepEqual(returned.data.view.players.find(p=>p.id===recipient.view.me.id).seat,originals.get(recipient.view.me.id).seat);checkedAbsentHolder=true;}
    const writerBefore=await get(writer);await send(snitch,{type:'search',target:snitch.view.me.id,round:view.round,gameNumber:1});assert.deepEqual(await get(writer),writerBefore);assert.equal(view.roundLog.at(-1).search,null);
    api.setTime(view.deadline);view=await get(writer);assert.equal(view.phase,'result');api.setTime(view.deadline);view=await get(writer);assert.equal(view.phase,'talk');await api.all();api.setTime(view.deadline);view=await get(writer);assert.equal(view.phase,'pass');await api.all();
  }
  assert.equal(checkedAbsentHolder,true);assert.equal(view.reveal,null);assert.ok(view.players.every(p=>p.score===0));
  assert.equal((await send(snitch,{type:'guess',target:writer.view.me.id,round:view.round,gameNumber:1})).status,200);
  const final=await api.all();assert.ok(final.every(v=>v.phase==='over' && v.outcome.winner==='students'));assert.ok(final.every(v=>JSON.stringify(v.roundLog)===JSON.stringify(final[0].roundLog)));assert.equal(final[0].roundLog.length,route.length);assert.equal(final[0].reveal.path.at(-1).to,'deliver');assert.equal(final[0].reveal.roles.length,count);
  for(const v of final)for(const p of players){assert.ok(!JSON.stringify(v).includes(p.playerId));assert.ok(!JSON.stringify(v).includes(p.rejoinCode));}
  assert.equal(final[0].players.find(p=>p.id===snitch.view.me.id).score,1);assert.ok(final[0].players.filter(p=>p.id!==snitch.view.me.id).every(p=>p.score===2));
  assert.equal((await send(writer,{type:'again',gameNumber:1})).status,200);const lobby=await get(writer);assert.equal(lobby.phase,'lobby');assert.deepEqual(lobby.roundLog,[]);assert.equal((await send(writer,{type:'start',gameNumber:1})).status,200);assert.equal((await get(writer)).gameNumber,2);
});
for(const count of [4,6])test(`full ${count}-player six-round stalled game: automatic search, host timeout and late rejoin`,async t=>{
  const api=await setup(t,count);await api.send(api.players[0],{type:'start',gameNumber:0});let view=await api.get(api.players[1]);
  api.setTime(view.deadline);view=await api.get(api.players[1]);assert.equal(view.me.host,true);assert.equal(view.players[0].connected,false);
  while(view.phase!=='over'){api.setTime(view.deadline);view=await api.get(api.players[1]);}
  assert.equal(view.outcome.winner,'snitch');assert.match(view.outcome.reason,/Six rounds/);assert.equal(view.roundLog.length,6);assert.ok(view.roundLog.every(r=>r.arrows.length===count && r.arrows.every(a=>a.move==='keep') && r.search?.found===false));
  const recovered=await api.rejoin(api.players[0]);assert.equal(recovered.status,200);assert.equal(recovered.data.view.phase,'over');assert.equal(recovered.data.view.me.host,false);assert.equal(recovered.data.view.players.find(p=>p.id===api.players[0].view.me.id).score,2*(count-1));assert.deepEqual(recovered.data.view.roundLog,view.roundLog);
});
