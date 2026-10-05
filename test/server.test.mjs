import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
test('HTTP create/join/start, per-tab credentials, no private credential leaks and refresh',async t=>{
  const child=spawn(process.execPath,['test/support/legacy-server.mjs'],{cwd:new URL('..',import.meta.url),env:{...process.env,PORT:'0'},stdio:['ignore','pipe','pipe']});t.after(()=>child.kill());
  const origin=await new Promise((resolve,reject)=>{child.on('error',reject);child.stdout.on('data',chunk=>{const match=String(chunk).match(/http:\/\/localhost:\d+/);if(match)resolve(match[0]);});child.on('exit',()=>reject(Error('Server exited')));});
  const call=async(path,input,id)=>{const response=await fetch(origin+path,{method:input?'POST':'GET',headers:{...(input?{'Content-Type':'application/json'}:{}),...(id?{Authorization:`Bearer ${id}`}:{})},...(input?{body:JSON.stringify(input)}:{})});return {status:response.status,data:await response.json(),cache:response.headers.get('cache-control')};};
  const host=await call('/api/create',{name:'Host'});assert.equal(host.status,201);assert.match(host.data.view.code,/^[A-Z]{4}$/);const code=host.data.view.code;const players=[host.data];
  for(const name of ['B','C','D'])players.push((await call('/api/join',{name,code})).data);assert.equal(new Set(players.map(p=>p.playerId)).size,4);
  assert.equal((await call(`/api/rooms/${code}`)).status,401);assert.equal((await call(`/api/rooms/${code}`,null,players[0].view.me.id)).status,401);
  assert.equal((await call(`/api/rooms/${code}/action`,{type:'start',gameNumber:0},players[1].playerId)).status,400);
  const started=await call(`/api/rooms/${code}/action`,{type:'start',gameNumber:0},players[0].playerId);assert.equal(started.data.view.phase,'reveal');
  const views=[];for(const p of players){const result=await call(`/api/rooms/${code}`,null,p.playerId);assert.equal(result.cache,'no-store');views.push(result.data.view);for(const other of players)assert.ok(!JSON.stringify(result.data.view).includes(other.playerId));assert.equal(result.data.view.reveal,null);}
  assert.equal(views.filter(v=>v.me.role==='Snitch').length,1);assert.equal(views.filter(v=>v.me.role==='Writer').length,1);assert.equal(views.filter(v=>v.me.holdsNote).length,1);
  assert.equal((await call('/api/join',{name:'Too late',code})).status,400);
  const refresh=await call(`/api/rooms/${code}`,null,players[0].playerId);assert.equal(refresh.data.view.me.id,started.data.view.me.id);
  const badOrigin=await fetch(origin+`/api/rooms/${code}/action`,{method:'POST',headers:{Origin:'https://other.example',Authorization:`Bearer ${players[0].playerId}`,'Content-Type':'application/json'},body:JSON.stringify({type:'start'})});assert.equal(badOrigin.status,403);
});
