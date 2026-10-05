const app = document.querySelector('#app');
let session = JSON.parse(sessionStorage.getItem('pass-the-note') || 'null');
let view = null, busy = false, lastRender = '', clockOffset = 0, noticeTimer, helpOpen = false, reconnecting = !!session, peekOpen = false, peekTimer;
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const playerName = id => id === 'deliver' ? 'Crush' : view.players.find(p=>p.id===id)?.name ?? '—';
const moveName = move => move === 'keep' ? 'Keep' : move === 'deliver' ? 'Deliver to Crush' : `Pass to ${playerName(move)}`;
function notice(message) { const el = document.querySelector('#status'); el.textContent=message; el.classList.add('visible'); clearTimeout(noticeTimer); noticeTimer=setTimeout(()=>el.classList.remove('visible'),5000); }
async function request(operation, input) {
  const path = "/.netlify/functions/game" + (input ? "" : `?op=view&code=${encodeURIComponent(session?.code || "")}`);
  if (input) input = { ...input, op: operation, code: input.code ?? session?.code };
  const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),7000);
  try {
  const response = await fetch(path,{method: input ? 'POST' : 'GET',headers:{...(input ? {'Content-Type':'application/json'} : {}),...(session ? {Authorization:`Bearer ${session.playerId}`} : {})},...(input ? {body:JSON.stringify(input)} : {}),cache:'no-store',signal:controller.signal});
  const data=await response.json(); if (!response.ok) { if(data.reset){sessionStorage.removeItem('pass-the-note');session=null;view=null;lastRender='';render();} throw new Error(data.error || 'Request failed.'); } return data;
  } finally {clearTimeout(timeout);}
}
function update(next) { if(session?.away || session?.code!==next.code || session?.publicId!==next.me.id)return; if(view && view.code===next.code && next.version<view.version)return; if(view?.phase!==next.phase || view?.gameNumber!==next.gameNumber)closePeek(false); reconnecting=false; view=next;clockOffset=next.serverTime-Date.now();render();tick(); }
const phaseLabels={lobby:'Take your seats',reveal:'Check your secret role',pass:'Choose your pass',search:'Teacher is choosing a desk',result:'Search result',talk:'Discuss out loud',guess:'Students delivered!',over:'Class dismissed'};
function header() {return `<header class="top chalkboard"><div class="brand-row"><div><div class="eyebrow">Period 7 · Eyes on the board</div><h1>Pass the Note</h1><div class="muted">${escape(view.me.name)} · Game ${view.gameNumber || 1} · Host: ${escape(view.players.find(p=>p.host)?.name)}</div></div><div class="room-label"><div class="small">Room code</div><div class="room-code">${escape(view.code)}</div></div></div><div class="phasebar"><h2>${phaseLabels[view.phase]}</h2><div class="phase-clock">${view.deadline?`<span class="round-number">Round ${view.round}/6</span><span class="timer" id="timer"></span>`:'<span class="round-number">4–6 players</span>'}</div></div></header><nav class="actions session-nav"><button class="secondary" data-help>How to Play</button><button class="secondary" data-leave>Leave room</button></nav>${reconnecting?'<p class="notice" role="status">Reconnecting… Your seat is saved. The game timer continues; missed passes become Keep.</p>':''}`;}
function entryHeader(){return '<header class="entry-chalk chalkboard"><img class="note-mark" src="/favicon.svg" alt="Folded paper note"><div><div class="eyebrow">4–6 players · Keep it quiet</div><h1>Pass the Note</h1></div></header>';}
function closePeek(redraw=true){clearTimeout(peekTimer);if(!peekOpen)return;peekOpen=false;lastRender='';if(redraw){render();tick();}}
function privateCard(){return `<section class="peek-card ${peekOpen?'peek-open':''}"><button class="peek-toggle" aria-expanded="${peekOpen}" aria-controls="role-details" data-peek><img src="/favicon.svg" alt="" aria-hidden="true"><span><strong>${peekOpen?'Fold shut':'Fold to peek'}</strong><small>${peekOpen?'For your eyes only':'Your role & note · private'}</small></span></button>${peekOpen?`<div id="role-details" class="role-details"><div class="role">${escape(view.me.role)}</div><p>${view.me.holdsNote?'You have the note.':'You do not have the note.'}</p><small>Closes after 8 seconds.</small></div>`:'<p class="peek-hint">Tap the folded note. Don’t let your neighbor peek.</p>'}</section>`;}
function rules() {return '<button class="secondary" data-help>How to Play</button>';}
function helpScreen() {return `<section class="panel help"><div class="phasebar"><h2>How to Play</h2><button class="secondary" data-help-close>${view?'Back to game':'Back'}</button></div>${view && view.deadline?`<p class="notice">The game continues while you read. Round ${view.round} · Watch the chalkboard timer above.</p>`:''}<p><strong>Your mission:</strong> get a secret note across the classroom to the Crush before the Teacher catches it. Play with 4–6 people. Talk out loud on your call; this screen handles the secrets and actions.</p><h3>Join and get your secret role</h3><p>One person creates a room. Everyone else joins using its four-letter code and their own name. The host starts once at least four players have joined. Your role appears only on your device:</p><ul><li><strong>Writer:</strong> you start holding the note. Help the students deliver it.</li><li><strong>Classmate:</strong> help deliver the note and work out whom to trust.</li><li><strong>Snitch:</strong> secretly work for the Teacher. Catch the note or stop delivery.</li></ul><p>Tap <strong>Fold to peek</strong> to see your role and whether <em>you</em> have the note. It folds shut after eight seconds or when you leave this window. If you are the Snitch, peek during Search or the bonus guess to show your private choices. Receiving it does not change your role. Keep your private screen to yourself; you may bluff about it in discussion.</p><h3>Read the classroom</h3><p>Each named desk belongs to a player. Your desk has a dark border. You may pass to an occupied desk directly above, below, left or right of yours. No diagonal passes and no passing through empty desks. The two desks marked <strong>★</strong> have a special <strong>Deliver to Crush</strong> action.</p><h3>Each round</h3><ol><li><strong>Pass:</strong> everybody chooses a neighboring player, Keep, or Deliver from a ★ desk. Your choice locks when submitted. Only the player holding the note at the start of this phase actually moves it; everyone else's choice is a fake. The note moves once, not through a chain of choices.</li><li><strong>Reveal:</strong> all arrows appear together when the timer ends. Real and fake arrows look identical. A new holder is notified privately.</li><li><strong>Search:</strong> the Snitch sees those arrows, then secretly chooses one occupied desk for the Teacher to search. Everyone sees the searched desk when the search timer ends, but never who chose it.</li><li><strong>Talk:</strong> if the search misses, discuss who to trust and plan your next move. The next round starts automatically when the discussion timer ends.</li></ol><p><strong>Example:</strong> Alex holds the note and chooses Blair. Blair chooses Casey. Only Alex's choice moves the real note: it stops at Blair. Blair's arrow to Casey is a fake this round.</p><h3>Winning</h3><ul><li><strong>Students win</strong> as soon as the real note reaches the Crush, including in round six.</li><li><strong>The Snitch wins</strong> if the note is passed to them, the Teacher searches its actual desk, or the sixth round finishes without delivery.</li><li>After delivery, the Snitch gets one guess at the original Writer for <strong>one bonus point</strong>. The student win remains. Roles and the real note path are revealed after the guess ends.</li></ul><h3>Timers, disconnects and the round log</h3><p>Normally, role reveal lasts 25 seconds, Pass 15 seconds, Search 10 seconds, and Talk 30 seconds. If you miss a pass, you Keep. If the Snitch misses a search, the server chooses a random occupied desk. A missed Writer guess earns no bonus. Choices resolve at the deadline even if everyone acts early.</p><p>The <strong>Round log</strong> saves every revealed arrow and searched desk. It never labels which arrows carried the real note. You can check it whenever you return to the game.</p><p>Refresh or reconnect in the same tab to return to your seat. Save your private rejoin key and room code to recover your seat from another tab or device. If the host leaves, the next connected player becomes host; a dropped connection has a 20-second grace period. Seats and roles remain reserved while a player is away.</p><h3>Several games</h3><p>Each student earns 2 points for a student win. A Snitch win earns the Snitch 2 points per student; a correct Writer guess adds 1 point. Play again keeps the room and scores, and deals new roles and seats. For a session, try twice as many games as players; the highest score wins and ties share the win.</p></section>`;}
function recovery() {return session?.rejoinCode?`<details class="recovery"><summary>Your private rejoin key</summary><p>Save this key with room code <strong>${escape(session.code)}</strong> to recover this seat in a new tab or device. Anyone with both can use your seat.</p><code>${escape(session.rejoinCode.match(/.{1,4}/g).join('-'))}</code></details>`:'';}
function roundLog() {return `<section class="panel"><h2>Round log</h2>${view.roundLog.length?view.roundLog.map(entry=>`<article class="log-round"><h3>Round ${entry.round}</h3><ul>${entry.arrows.map(a=>`<li>${escape(playerName(a.playerId))} → ${escape(a.move==='keep'?'Keep':playerName(a.move))}</li>`).join('')}</ul><p>${entry.search?`Teacher searched <strong>${escape(playerName(entry.search.playerId))}</strong>: ${entry.search.found?'note found':'nothing found'}.`:entry.round===view.round && ['search'].includes(view.phase)?'Teacher search pending.':'No search: the game ended during passing.'}</p></article>`).join(''):'<p class="muted">Arrows appear here after each pass deadline. Search results are added after the search deadline.</p>'}</section>`;}
function bindNavigation() {
  app.querySelectorAll('[data-help]').forEach(el=>el.addEventListener('click',()=>{closePeek(false);helpOpen=true;lastRender='';render();}));
  app.querySelector('[data-help-close]')?.addEventListener('click',()=>{helpOpen=false;lastRender='';render();});
  app.querySelector('[data-leave]')?.addEventListener('click',leaveRoom);
  app.querySelector('[data-resume]')?.addEventListener('click',resume);
  app.querySelector('[data-peek]')?.addEventListener('click',()=>{peekOpen=!peekOpen;clearTimeout(peekTimer);if(peekOpen)peekTimer=setTimeout(()=>closePeek(),8000);lastRender='';render();tick();app.querySelector('[data-peek]')?.focus({preventScroll:true});});
}
function pencilArrows(){
  const paths=[];
  for(const arrow of view.arrows){
    if(arrow.move==='keep')continue;
    const from=view.players.find(p=>p.id===arrow.playerId)?.seat;
    const to=arrow.move==='deliver'?view.board.crush:view.players.find(p=>p.id===arrow.move)?.seat;
    if(!from || !to)continue;
    const x1=from.col*120+60,y1=from.row*120+60,x2=to.col*120+60,y2=to.row*120+60,dx=x2-x1,dy=y2-y1,len=Math.hypot(dx,dy),ux=dx/len,uy=dy/len;
    const ax=x1+ux*35,ay=y1+uy*35,bx=x2-ux*35,by=y2-uy*35,cx=(ax+bx)/2-uy*10,cy=(ay+by)/2+ux*10;
    paths.push(`<path d="M${ax},${ay} Q${cx},${cy} ${bx},${by}" marker-end="url(#pencil-tip)"/><path class="pencil-echo" d="M${ax+1},${ay+1} Q${cx-2},${cy+2} ${bx+1},${by+1}"/>`);
  }
  return `<svg class="pass-lines" viewBox="0 0 ${view.board.columns*120} 240" preserveAspectRatio="none" aria-hidden="true"><defs><marker id="pencil-tip" viewBox="0 0 10 10" markerWidth="8" markerHeight="8" refX="8" refY="5" orient="auto"><path d="M1 1 8 5 1 9"/></marker></defs>${paths.join('')}</svg>`;
}
function board() {
  const cells=[];
  for(let row=0;row<2;row++) for(let col=0;col<view.board.columns;col++) {
    const p=view.players.find(p=>p.seat?.row===row && p.seat?.col===col);
    const crush=view.board.crush.row===row && view.board.crush.col===col;
    if(crush){cells.push('<div class="desk crush"><span class="name">♥ Crush</span><small>Delivery target</small></div>');continue;}
    if(!p){cells.push('<div class="desk empty">Empty desk</div>');continue;}
    const delivery=!view.players.some(other=>other.seat.row===row && other.seat.col>col);
    const arrow=view.arrows.find(a=>a.playerId===p.id);
    const searched=view.searches.at(-1)?.playerId===p.id && ['result','talk','over'].includes(view.phase);
    cells.push(`<div class="desk ${p.id===view.me.id?'mine':''} ${searched?'searched':''}"><span class="name">${escape(p.name)}${delivery?' ★':''}</span><small>${p.id===view.me.id?'You':`Row ${row+1} · Seat ${col+1}`}${p.connected?'':' · Away'}</small>${arrow?`<span class="arrow">${escape(moveName(arrow.move))}</span>`:''}</div>`);
  }
  return `<div class="classroom-stage"><div class="board ${view.board.columns===4?'four':'three'}">${cells.join('')}</div>${pencilArrows()}</div><p class="small muted board-key">★ Can deliver · Highlighted desk is yours. Pencil arrows show the latest revealed passes.</p>`;
}
const button = (type,text,extra='',disabled=false) => `<button data-action="${type}" ${extra} ${disabled||reconnecting?'disabled':''}>${escape(text)}</button>`;
function render() {
  if(helpOpen){app.innerHTML=(view?header():entryHeader())+helpScreen();bindNavigation();tick();return;}
  if(!view && session && !session.away){app.innerHTML=`<div class="entry">${entryHeader()}<section class="panel"><p role="status">Reconnecting to your saved seat…</p><p>The game timer keeps running while your connection recovers.</p>${rules()}</section></div>`;bindNavigation();return;}
  if(!view) {
    app.innerHTML=`<div class="entry">${entryHeader()}<p class="entry-intro">Get the note to your Crush. Keep it from the Snitch.</p><section class="panel"><form id="entry"><label for="name">Your name</label><input id="name" name="name" maxlength="24" required autocomplete="off" placeholder="Alex"><div class="actions"><button name="mode" value="create">Create room</button></div><div class="divider"></div><label for="code">Four-letter room code</label><input id="code" name="code" maxlength="4" autocomplete="off" placeholder="ABCD"><button class="secondary" name="mode" value="join">Join room</button></form></section><section class="panel">${rules()}</section></div>`;
    if(session?.away)app.querySelector('.entry').insertAdjacentHTML('afterbegin',`<section class="panel"><h2>Your seat is saved</h2><p>You left ${escape(session.code)}. Return as ${escape(session.name || 'the same player')} with your role intact.</p><button data-resume>Rejoin your seat</button>${recovery()}</section>`);
    app.querySelector('.entry').insertAdjacentHTML('beforeend','<section class="panel"><details><summary>Rejoin an existing seat</summary><form id="rejoin"><p>Use your saved private key, not just your player name.</p><label for="rejoin-room">Room code</label><input id="rejoin-room" name="code" maxlength="4" required autocomplete="off"><label for="rejoin-key">Private rejoin key</label><input id="rejoin-key" name="rejoinCode" type="password" required autocomplete="off"><button>Rejoin seat</button></form></details></section>');
    document.querySelector('#entry').addEventListener('submit',enter);document.querySelector('#rejoin').addEventListener('submit',rejoin);bindNavigation(); return;
  }
  const signature=JSON.stringify({...view,serverTime:0,reconnecting,peekOpen});if(signature===lastRender)return;lastRender=signature;
  let content='';
  if(view.phase==='lobby') {
    content=`<section class="panel"><h2>Take a seat</h2><p class="muted">Share ${escape(view.code)}. Each player opens this address on their own device or tab.</p><ul class="roster">${view.players.map(p=>`<li><span>${escape(p.name)}${p.id===view.me.id?' (you)':''}</span><span>${p.host?'Host · ':''}${p.connected?'Connected':'Away · seat saved'}</span></li>`).join('')}</ul><p>${view.players.length}/6 players · At least 4 to start</p>${view.me.host?`<label class="check"><input id="solo" type="checkbox" ${view.solo?'checked':''}>Solo testing: 60-second passes, 30-second searches, short discussion</label>${button('start','Start game','',view.players.length<4)}`:`<p class="notice">Waiting for the host to start.${view.solo?' Solo-testing timers are on.':''}</p>`}</section>`;
  } else if(view.phase==='over') {
    const roles=id=>view.reveal.roles.find(r=>r.id===id);
    content=`<section class="panel"><div class="eyebrow">Game ${view.gameNumber} complete</div><h2>${view.outcome.winner==='students'?'Students win!':'Snitch wins!'}</h2><p>${escape(view.outcome.reason)}</p>${view.reveal.guess?`<p>Writer guess: ${view.reveal.guess.playerId?escape(playerName(view.reveal.guess.playerId)):'No guess'} · ${view.reveal.guess.correct?'Correct (+1 point)':'No bonus'}</p>`:''}${view.me.host?button('again','Play again'): '<p class="muted">Waiting for the host to play again.</p>'}</section><div class="columns"><section class="panel"><h2>The real note path</h2>${board()}<ol class="path">${view.reveal.path.map(s=>`<li>${s.round===0?`Start: ${escape(playerName(s.to))} writes the note`:`Round ${s.round}: ${escape(playerName(s.from))} ${s.from===s.to?'keeps the note':`→ ${escape(playerName(s.to))}`}`}</li>`).join('')}</ol></section><section class="panel"><h2>Roles & session scores</h2><table><thead><tr><th>Player</th><th>Role</th><th>Points</th></tr></thead><tbody>${[...view.players].sort((a,b)=>b.score-a.score).map(p=>`<tr><td>${escape(p.name)}</td><td>${escape(roles(p.id).role)}</td><td>${p.score}</td></tr>`).join('')}</tbody></table><p class="small muted">Student win: +2 each. Snitch win: +${2*(view.players.length-1)}. Correct Writer guess: +1. Scores carry into play again.</p></section></div>`;
  } else {
    let controls='';
    if(view.phase==='reveal') controls='<p>Check your role and find your seat. Passing starts when the timer ends.</p>';
    if(view.phase==='pass') controls=view.me.submitted?`<p class="notice">Locked: ${escape(moveName(view.me.submitted))}</p><p>Waiting for the deadline. All arrows reveal together.</p>`:`<p>Only the holder moves the note. Everyone else makes a fake pass.</p><div class="moves">${view.me.moves.map(move=>button('pass',moveName(move),`data-move="${escape(move)}"`)).join('')}</div>`;
    if(view.phase==='search') controls=peekOpen && view.me.role==='Snitch' ? view.me.submitted?`<p class="notice">Search locked: ${escape(playerName(view.me.submitted))}</p>`:`<p>Choose one occupied desk to search.</p><div class="moves">${view.players.map(p=>button('search',`Search ${p.name}`,`data-target="${p.id}"`)).join('')}</div>` : '<p>The Teacher is choosing a desk. Peek at your card if choosing the search is your secret job.</p>';
    if(['result','talk'].includes(view.phase)) controls=`<p class="notice">The Teacher searched ${escape(playerName(view.searches.at(-1).playerId))}. Nothing found.</p>${view.phase==='talk'?'<p>Who do you trust? Discuss on your call. Next pass starts when the timer ends.</p>':''}`;
    if(view.phase==='guess') controls=peekOpen && view.me.role==='Snitch'?`<p>Students won. Guess the original Writer for one bonus point.</p><div class="moves">${view.players.map(p=>button('guess',`Guess ${p.name}`,`data-target="${p.id}"`)).join('')}</div>`:'<p>The Snitch gets one Writer guess for a bonus point. Peek at your card if that’s your job. The student win is safe.</p>';
    content=`<div class="columns game-layout"><section class="panel classroom-panel"><div class="classroom-caption"><h3>The classroom</h3><span class="small">Act natural.</span></div>${board()}${view.phase==='pass'?`<p class="submission-count">${view.submittedCount}/${view.players.length} passes locked</p>`:''}${view.searches.length?`<p class="small muted">Search history: ${view.searches.map(s=>`R${s.round} ${escape(playerName(s.playerId))}${s.found?' (found)':' (miss)'}`).join(' · ')}</p>`:''}</section><aside class="desk-sidebar">${privateCard()}<section class="panel action-panel">${controls}</section></aside></div>`;
  }
  app.innerHTML=header()+content+(view.phase==='lobby'?`<section class="panel">${recovery()}</section>`:roundLog()+`<section class="panel">${recovery()}</section>`);
  app.querySelectorAll('[data-action]').forEach(el=>el.addEventListener('click',()=>action({type:el.dataset.action,...(el.dataset.move?{move:el.dataset.move}:{}),...(el.dataset.target?{target:el.dataset.target}:{})})));
  app.querySelector('#solo')?.addEventListener('change',event=>action({type:'settings',solo:event.target.checked}));
  bindNavigation();
}
async function enter(event) {
  event.preventDefault();if(busy)return;const form=event.currentTarget;const mode=event.submitter?.value||'create';const values=new FormData(form);
  if(mode==='join' && !/^[a-z]{4}$/i.test(String(values.get('code')))){notice('Enter a four-letter room code.');return;}
  busy=true;form.querySelectorAll('button').forEach(b=>b.disabled=true);
  try { const data=await request(mode,{name:values.get('name'),code:String(values.get('code')).toUpperCase()});saveSession(data);update(data.view); }
  catch(error){notice(error.message);form.querySelectorAll('button').forEach(b=>b.disabled=false);}finally{busy=false;}
}
async function action(input) {
  if(busy)return;busy=true;app.querySelectorAll('button').forEach(b=>b.disabled=true);
  try { const data=await request("action",{...input,round:view.round,gameNumber:view.gameNumber});lastRender='';update(data.view); }
  catch(error){if(error.name==='AbortError'||error instanceof TypeError)reconnecting=true;notice(reconnecting?'Connection lost. Your seat is saved; reconnecting…':error.message);lastRender='';render();}finally{busy=false;}
}
function saveSession(data){session={playerId:data.playerId,publicId:data.view.me.id,code:data.view.code,rejoinCode:data.rejoinCode,name:data.view.me.name,away:false};sessionStorage.setItem('pass-the-note',JSON.stringify(session));}
async function leaveRoom(){if(busy)return;busy=true;try{await request("leave",{});session.away=true;sessionStorage.setItem('pass-the-note',JSON.stringify(session));view=null;helpOpen=false;reconnecting=false;lastRender='';render();}catch(error){notice(error.message);}finally{busy=false;}}
async function resume(){if(busy || !session)return;busy=true;try{const data=await request("view");session.away=false;sessionStorage.setItem('pass-the-note',JSON.stringify(session));lastRender='';update(data.view);}catch(error){notice(error.message);}finally{busy=false;}}
async function rejoin(event){event.preventDefault();if(busy)return;busy=true;const form=event.currentTarget,values=new FormData(form);try{const data=await request('rejoin',{code:String(values.get('code')).toUpperCase(),rejoinCode:values.get('rejoinCode')});saveSession(data);lastRender='';update(data.view);}catch(error){notice(error.message);}finally{busy=false;}}
function tick(){const el=document.querySelector('#timer');if(el && view?.deadline)el.textContent=`${Math.max(0,Math.ceil((view.deadline-Date.now()-clockOffset)/1000))}s`;}
async function poll(){if(session && !session.away && !busy){try {const data=await request("view");update(data.view);}catch(error){if(session && (error.name==='AbortError'||error instanceof TypeError)){reconnecting=true;lastRender='';render();}else notice(error.message);}}setTimeout(poll,1400+Math.random()*200);}
// Browsers can copy sessionStorage when a tab is duplicated. An existing tab
// claims its public seat; a copied tab returns to Join instead of impersonating it.
// No credential or role is broadcast. Reloads retain identity because the old
// document's BroadcastChannel disappears on navigation.
const instance = crypto.randomUUID();
const channel = 'BroadcastChannel' in window ? new BroadcastChannel('pass-the-note-tabs') : null;
let initialized = false;
if(channel) channel.onmessage = ({data}) => {
  if(data.type==='claim' && initialized && !session?.away && session?.publicId===data.publicId) channel.postMessage({type:'occupied',publicId:data.publicId,to:data.instance});
  if(data.type==='occupied' && data.to===instance && session?.publicId===data.publicId){sessionStorage.removeItem('pass-the-note');session=null;view=null;lastRender='';render();notice('This is a separate tab. Join with a different player name.');}
};
async function initialize(){
  render();
  if(session?.publicId && channel){channel.postMessage({type:'claim',publicId:session.publicId,instance});await new Promise(resolve=>setTimeout(resolve,250));}
  initialized=true;poll();setInterval(tick,250);
}
initialize();
window.addEventListener('blur',()=>closePeek());
document.addEventListener('visibilitychange',()=>{if(document.hidden)closePeek();});
