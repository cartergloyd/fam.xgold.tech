(() => {
 const H=window.familyHub,{$,api,notice}=H,BASE='https://fam-api.xgold.tech/family';
 let following=!matchMedia('(prefers-reduced-motion: reduce)').matches,latest,lastTarget='',checking=false,frameTimer;
 const frame=$('live-map'),WORLDS={world:'Overworld',world_nether:'Nether',world_the_end:'The End'};
 let pins=[],pinTarget=null,picked=null,myNames=new Set(),signed=false,starred=new Set(),starsOn=false,lastSpot=null,wasOnline=false;
 // Dynmap shows Bedrock players as ".Name" with underscores for spaces; the whitelist keeps the gamertag as typed.
 const norm=s=>String(s||'').toLowerCase().replace(/^\./,'').replace(/[\s_]/g,'');
 const online=key=>latest?.players?.find(p=>norm(p.account)===key);
 const mine=()=>latest?.players?.find(p=>myNames.has(norm(p.account)));
 // A pin wins, then the player someone tapped, then the signed-in player (live if online, else the spot they were last seen), then whoever the server picked.
 function focus(){
  if(pinTarget)return pinTarget;
  if(following){const p=(picked&&online(picked))||mine();if(p)return{mode:'player',...p};if(lastSpot)return{mode:'last',name:H.user?.name,...lastSpot};}
  return latest.focus;
 }
 function ago(iso){const m=Math.round((Date.now()-new Date(iso))/60000),[n,unit]=m<60?[m,'minute']:m<1440?[Math.round(m/60),'hour']:[Math.round(m/1440),'day'];return m<1?'just now':`${n} ${unit}${n===1?'':'s'} ago`;}
 function showMap(){
  if(!latest?.online)return;showStatus();const f=focus(),follow=!pinTarget&&following&&f.mode==='player';
  const target=follow?'player:'+f.account:'area:'+f.world+':'+Math.round(f.x)+':'+Math.round(f.z);
  const params=new URLSearchParams({worldname:f.world||'world',mapname:f.world==='world'?'surface':'flat',x:Math.round(f.x||0),y:Math.round(f.y||64),z:Math.round(f.z||0),zoom:'5',nogui:'false',nopanel:'true',nocompass:'true'});
  if(follow)params.set('playername',f.account);
  if(target!==lastTarget){frame.src=BASE+'/mc-map/?'+params;lastTarget=target;$('map-placeholder').hidden=false;$('map-message').textContent='Opening the live map…';clearTimeout(frameTimer);frameTimer=setTimeout(()=>{$('map-message').textContent='The map is taking a little longer. Use “Open the map in a new tab” to try it directly.';},20000);}
  $('open-map').href=BASE+'/mc-map/?'+new URLSearchParams({...Object.fromEntries(params),nogui:'false',nopanel:'false'});
 }
 function followButton(){const b=$('map-follow'),label=following?'Pause following':'Follow players';b.setAttribute('aria-pressed',String(following));b.setAttribute('aria-label',label);b.title=label;}
 function showStatus(){
  const n=latest.players.length,f=focus();
  $('map-status').textContent=(n?`${n} player${n===1?'':'s'} online · `:'No one online · ')+(f.mode==='player'?(following?'Following ':'Near ')+(f.name||f.account):f.mode==='pin'?'Showing '+f.name:f.mode==='last'?`${f.name||'You'} last seen here · ${ago(f.seen_at)}`:f.mode==='activity'?'Most active area · past 3 weeks':f.mode==='chunks'?'Recently saved chunks · activity history is building':'World spawn · activity history is building');
 }
 async function mapStatus(){
  if(checking||document.hidden)return;checking=true;
  try{const r=await fetch(BASE+'/mc-status',{cache:'no-store',signal:AbortSignal.timeout(12000)});latest=await r.json();if(!r.ok||!latest.online)throw Error(latest.error||'The live map is temporarily unavailable.');
   // The moment my player leaves, fetch where they were last seen so the map moves there instead of to someone else.
   const on=!!mine();if(wasOnline&&!on)await loadLastSpot();wasOnline=on;
   showStatus();renderPeople();
   if(following||!lastTarget)showMap();
  }catch(e){$('map-status').textContent=e.message;if(!lastTarget){$('map-placeholder').hidden=false;$('map-message').textContent='Live map unavailable. Join instructions and the build board are still in the tabs below.';}}
  finally{checking=false;}
 }
 frame.addEventListener('load',()=>{if(frame.getAttribute('src')){clearTimeout(frameTimer);$('map-placeholder').hidden=true;}});
 // Pausing, or resuming, always drops a tapped player or location and goes back to the usual choice.
 $('map-follow').addEventListener('click',()=>{following=!following;pinTarget=null;picked=null;lastTarget='';followButton();showMap();});followButton();

 // The island expands into its sheet: one glass container grows from a pill into a card with the tabs staying at the bottom. One view
 // at a time; the tab that opened it closes it. Tapping a player or location on a narrow screen closes it too, so the map is what you see.
 const dock=$('dock'),sheet=$('sheet'),island=$('island'),tabs=[...document.querySelectorAll('.tab')],views=[...document.querySelectorAll('.sheet-view')],narrow=matchMedia('(max-width:760px)'),wrap=document.querySelector('.map-wrap'),probe=$('dock-probe');
 const TITLES={people:'People & Locations',build:'Construction',join:'Join the server'};let lastTab=null;
 const isOpen=()=>dock.hasAttribute('data-open');
 // Sheets stay short: the header plus the content, capped at 44% of the screen (or 420px), and the body scrolls past that.
 // The map is moved so its center sits halfway between the bottom of the site banner and the top of the sheet.
 function fit(){
  if(!isOpen())return;
  const head=sheet.querySelector('.sheet-head').offsetHeight,panel=Math.round(Math.min(head+sheet.querySelector('.sheet-body').scrollHeight,innerHeight*.44,420));
  dock.style.setProperty('--panel-h',panel+'px');
  const banner=document.querySelector('.family-ribbon')?.getBoundingClientRect().bottom||0,top=probe.getBoundingClientRect().bottom-panel-island.offsetHeight;
  wrap.style.top=(banner+top-innerHeight)+'px';
 }
 function openSheet(name){
  dock.dataset.view=name;$('sheet-title').textContent=TITLES[name];
  for(const v of views)v.hidden=v.dataset.for!==name;
  for(const t of tabs){t.setAttribute('aria-pressed',String(t.dataset.tab===name));if(t.dataset.tab===name)lastTab=t;}
  sheet.querySelector('.sheet-body').scrollTop=0;dock.setAttribute('data-open','');document.body.setAttribute('data-sheet','');fit();$('sheet-title').focus({preventScroll:true});
 }
 function closeSheet(){
  if(!isOpen())return;dock.removeAttribute('data-open');document.body.removeAttribute('data-sheet');wrap.style.top='';
  for(const t of tabs)t.setAttribute('aria-pressed','false');
  lastTab?.focus({preventScroll:true});
 }
 for(const t of tabs)t.addEventListener('click',()=>isOpen()&&dock.dataset.view===t.dataset.tab?closeSheet():openSheet(t.dataset.tab));
 $('sheet-close').addEventListener('click',closeSheet);$('sheet-grab').addEventListener('click',closeSheet);
 document.addEventListener('keydown',e=>{if(e.key==='Escape'&&isOpen()&&!document.querySelector('dialog[open]'))closeSheet();});
 const refit=new ResizeObserver(fit);for(const v of views)refit.observe(v);addEventListener('resize',fit);
 // Swiping the header down dismisses the sheet.
 const head=sheet.querySelector('.sheet-head');let swipe=null;
 head.addEventListener('pointerdown',e=>{if(e.target.closest('.sheet-close'))return;swipe={y:e.clientY,id:e.pointerId};head.setPointerCapture(e.pointerId);});
 head.addEventListener('pointermove',e=>{if(swipe&&e.pointerId===swipe.id&&e.clientY-swipe.y>60){swipe=null;closeSheet();}});
 head.addEventListener('pointerup',()=>{swipe=null;});head.addEventListener('pointercancel',()=>{swipe=null;});

 // People and Named Locations. Locations come from the Dynmap marker files, so a sign marker or anything else put on the map shows up.
 const STAR='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01z"/></svg>';
 const EMOJI=[[/spawn/i,'🌍'],[/home|house|base|cabin/i,'🏠'],[/farm|wheat|crop|garden/i,'🌾'],[/mine|cave|quarry/i,'⛏️'],[/village|town|city/i,'🏘️'],[/castle|tower|fort/i,'🏰'],[/ocean|sea|monument|lake|boat|dock/i,'🌊'],[/portal/i,'🌀']];
 const emoji=p=>EMOJI.find(([re])=>re.test(p.name))?.[1]||({world_nether:'🔥',world_the_end:'🌌'})[p.world]||'📍';
 const tint=s=>{let h=0;for(const c of String(s))h=(h*31+c.charCodeAt(0))%6;return `var(--bubble-${h+1})`;};
 // A player's family photo when the directory has one (their in-game name is their first name), else a colored initial.
 function playerBubble(p){
  const name=p.name||p.account,b=H.node('span',undefined,'bubble'),photo=window.familyAccount?.photo?.(name);b.style.setProperty('--bubble',tint(name));
  if(photo&&!photo.startsWith('data:')){const img=H.node('img');img.alt='';img.src=photo;img.addEventListener('error',()=>{img.remove();b.textContent=name.charAt(0).toUpperCase();});b.append(img);}else b.textContent=name.charAt(0).toUpperCase();
  return b;
 }
 function placeBubble(p){const b=H.node('span',emoji(p),'bubble');b.style.setProperty('--bubble',tint(p.name));return b;}
 function row({id,bubble,name,sub,go}){
  const item=H.node('div',undefined,'row-item'),main=H.node('button',undefined,'row-main'),text=H.node('span',undefined,'row-text');
  main.type='button';text.append(H.node('span',name,'row-name'),H.node('span',sub,'row-sub'));main.append(bubble,text);main.addEventListener('click',go);item.append(main);
  // The star only shows when the server can save it; without that the list still works.
  if(starsOn){const on=starred.has(id),star=H.node('button',undefined,'star');star.type='button';star.innerHTML=STAR;star.dataset.pin=id;star.setAttribute('aria-label','Star '+name);star.setAttribute('aria-pressed',String(on));star.addEventListener('click',()=>toggleStar(id,name,star));item.append(star);}
  return item;
 }
 const byStar=(a,b)=>starred.has(b.id)-starred.has(a.id);
 function renderPeople(){
  const list=$('people-list'),keep=document.activeElement?.dataset?.pin;list.replaceChildren();
  const players=(latest?.players||[]).map(p=>({...p,id:'player:'+norm(p.account)})).sort((a,b)=>byStar(a,b)||(a.name||a.account).localeCompare(b.name||b.account));
  list.append(H.node('p','Online now','rows-title'));
  if(!players.length)list.append(H.node('p','No one is online right now.','empty'));
  for(const p of players)list.append(row({id:p.id,bubble:playerBubble(p),name:p.name||p.account,sub:`${WORLDS[p.world]||p.world} · ${Math.round(p.x)}, ${Math.round(p.y)}, ${Math.round(p.z)}`,go:()=>goPlayer(p)}));
  list.append(H.node('p','Named Locations','rows-title'));
  if(!pins.length)list.append(H.node('p','No locations yet.','empty'));
  for(const p of pins)list.append(row({id:p.id,bubble:placeBubble(p),name:p.name,sub:`${WORLDS[p.world]} · ${p.x}, ${p.y}, ${p.z}`,go:()=>goTo(p)}));
  if(keep)list.querySelector(`[data-pin="${CSS.escape(keep)}"]`)?.focus();
 }
 // Going to a player follows them live; going to a location pauses following and shows that spot.
 function goPlayer(p){picked=norm(p.account);pinTarget=null;following=true;followButton();lastTarget='';showMap();if(narrow.matches)closeSheet();}
 function goTo(pin){pinTarget={mode:'pin',...pin};following=false;followButton();lastTarget='';showMap();if(narrow.matches)closeSheet();}
 // Starred ones come first for the signed-in member, then the rest by name.
 function sortPins(){pins.sort((a,b)=>byStar(a,b)||a.name.localeCompare(b.name)||a.world.localeCompare(b.world));}
 async function loadStars(){
  try{starred=new Set((await api('/hub/mc-stars')).stars);starsOn=true;}catch{starred=new Set();starsOn=false;}
  sortPins();renderPeople();
 }
 async function toggleStar(id,name,button){
  const on=!starred.has(id);button.disabled=true;
  try{await api('/hub/mc-stars',{method:'POST',body:{pin:id,starred:on}});on?starred.add(id):starred.delete(id);notice('places-message','');sortPins();renderPeople();document.querySelector(`[data-pin="${CSS.escape(id)}"]`)?.focus();}
  catch(e){notice('places-message',e.message,true);button.disabled=false;}
 }
 async function loadLastSpot(){
  if(!signed)return;
  try{lastSpot=(await api('/hub/mc-last-seen')).spot;}catch{lastSpot=null;}
  if(following)showMap();
 }
 // Runs when someone signs in or out: their stars and last spot belong to them alone.
 function userChanged(){
  starred=new Set();starsOn=false;lastSpot=null;wasOnline=false;
  if(signed){loadStars();loadLastSpot();}else{sortPins();renderPeople();}
 }
 async function loadPins(){
  const found=await Promise.allSettled(Object.keys(WORLDS).map(async world=>{
   const r=await fetch(BASE+'/mc-map/tiles/_markers_/marker_'+world+'.json',{cache:'no-store',signal:AbortSignal.timeout(8000)});if(!r.ok)throw Error('No markers');
   const data=await r.json();return Object.entries(data.sets||{}).flatMap(([setKey,set])=>Object.entries(set.markers||{}).map(([key,m])=>({id:`${world}:${setKey}:${key}`,name:String(m.label||key).replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim()||key,world,x:Math.round(m.x),y:Math.round(m.y),z:Math.round(m.z)})));
  }));
  // Keep what is showing if the markers cannot be read.
  if(!found.some(r=>r.status==='fulfilled'))return;
  pins=found.flatMap(r=>r.status==='fulfilled'?r.value:[]).filter(p=>[p.x,p.y,p.z].every(Number.isFinite));sortPins();renderPeople();
 }

 const instructions=$('platform-instructions'),platform=$('join-platform'),whitelistForm=$('whitelist-form');
 let accounts=[],whitelistPoll;
 const featured='Mineville, Lifeboat, Enchanted, Galaxite, or The Hive',JAVA='185.172.53.60:25565',BEDROCK='185.172.53.60',PS_DNS='45.55.68.52';
 function paragraph(text,cls){const p=H.node('p',text,cls);instructions.append(p);return p;}
 function steps(items,parent=instructions){const list=H.node('ol');for(const text of items)list.append(H.node('li',text));parent.append(list);}
 function address(bedrock=false){const p=H.node('p');p.append(H.node('code',bedrock?BEDROCK:JAVA));if(bedrock)p.append(document.createElement('br'),H.node('span','Port: 19133'));instructions.append(p);const b=H.node('button',bedrock?'Copy Bedrock address':'Copy Java address','quiet');b.type='button';b.addEventListener('click',async()=>{const text=bedrock?BEDROCK:JAVA;try{await navigator.clipboard.writeText(text);b.textContent='Copied';setTimeout(()=>b.textContent=bedrock?'Copy Bedrock address':'Copy Java address',2500);}catch{b.textContent=text;}});instructions.append(b);}
 function dns(kind,parent=instructions){
  const primary=kind==='playstation'?PS_DNS:'104.238.130.180';
  steps([kind==='switch'?'System Settings → Internet → Internet Settings → your network → Change Settings → DNS Settings → Manual.':'Open your console’s Internet Settings and choose manual DNS.',`Set primary DNS to ${primary} and secondary DNS to 8.8.8.8.`,`Save and reconnect. In Minecraft’s Servers tab, join ${featured}.`,'In BedrockConnect, enter 185.172.53.60, port 19133.'],parent);
 }
 function renderPlatform(){
  instructions.replaceChildren();const selected=platform.value;
  if(selected==='java'){paragraph('In Minecraft, choose Multiplayer → Add Server.');address();}
  else if(selected==='bedrock'){paragraph('In Minecraft, choose Servers → Add Server.');address(true);}
  else if(selected==='xbox'){paragraph('Add GoldServer2951 as an Xbox friend. The server will appear in Minecraft’s Friends tab.');const d=H.node('details');d.append(H.node('summary','Use the DNS option'));dns('xbox',d);instructions.append(d);}
  else if(selected==='switch'){
   paragraph('Join through Microsoft / Xbox friends. Custom DNS is not needed for this option.');
   steps(['Sign into Minecraft on Switch with your Microsoft account.','Add GoldServer2951 through Minecraft’s cross-platform friend search, or use the Xbox app signed into that same Microsoft account.','Look for GoldServer2951 in Minecraft’s Friends / Joinable Friends list and select it to join.']);
   paragraph('Use your Microsoft / Xbox friends inside Minecraft, not the Nintendo Switch friend list. If you previously changed DNS, you can restore DNS Settings to Automatic.','caption');
   const d=H.node('details');d.append(H.node('summary','Use the DNS option'));dns('switch',d);instructions.append(d);
  }
  else dns(selected);
  if(!['java','bedrock'].includes(selected))paragraph('If custom DNS stops working, restore automatic DNS and try again later.','caption');
  const edition=selected==='java'?'java':'bedrock';if(whitelistForm.elements.edition.value!==edition)whitelistForm.elements.username.value='';whitelistForm.elements.edition.value=edition;editionHint();renderAccounts();
 }
 function editionHint(){const bedrock=whitelistForm.elements.edition.value==='bedrock';$('whitelist-name-label').firstChild.textContent=bedrock?'Xbox gamertag':'Minecraft username';$('whitelist-hint').textContent=bedrock?'Enter your Xbox gamertag exactly, including spaces. Leave off the server’s dot prefix.':'Use your Java username, not your email.';}
 function renderAccounts(){const list=$('whitelist-accounts');list.replaceChildren();for(const r of accounts){list.append(H.node('p',`${r.edition==='java'?'Java':'Bedrock'} · ${r.username} · ${r.status==='added'?'Whitelisted':r.status==='failed'?(r.error||'Could not add this account. Try again.'):'Adding to the server…'}`));}
  const existing=accounts.find(r=>r.edition===whitelistForm.elements.edition.value&&['pending','processing','added'].includes(r.status));
  whitelistForm.querySelector('button').disabled=!!existing;whitelistForm.elements.username.disabled=!!existing;if(existing)whitelistForm.elements.username.value=existing.username;
 }
 function syncWhitelistAuth(){const ok=!!H.user&&!!window.familyAccount.current;$('whitelist-auth').hidden=ok;whitelistForm.hidden=!ok;if(!ok){accounts=[];myNames.clear();$('whitelist-accounts').replaceChildren();clearTimeout(whitelistPoll);}const changed=ok!==signed;signed=ok;if(changed)userChanged();if(following)showMap();}
 async function loadWhitelist(){
  try{const data=await api('/hub/mc-whitelist');accounts=data.accounts;myNames=new Set(accounts.map(r=>norm(r.username)));syncWhitelistAuth();renderAccounts();clearTimeout(whitelistPoll);if(accounts.some(r=>['pending','processing'].includes(r.status)))whitelistPoll=setTimeout(loadWhitelist,2500);}
  catch(e){notice('whitelist-message',e.message,true);}
 }
 platform.addEventListener('change',renderPlatform);whitelistForm.elements.edition.addEventListener('change',()=>{whitelistForm.elements.username.value='';editionHint();renderAccounts();});
 whitelistForm.addEventListener('submit',async e=>{e.preventDefault();const button=whitelistForm.querySelector('button');button.disabled=true;notice('whitelist-message','Verifying your account and adding it to the server…');try{await api('/hub/mc-whitelist',{method:'POST',body:{edition:whitelistForm.elements.edition.value,username:whitelistForm.elements.username.value.trim()}});await loadWhitelist();notice('whitelist-message','Your request is being processed. You can join as soon as your account says “Whitelisted”.');}catch(error){notice('whitelist-message',error.message,true);button.disabled=false;}});
 window.addEventListener('family-account-change',()=>{if(!window.familyAccount.current)syncWhitelistAuth();});renderPlatform();
 $('add-build').addEventListener('click',()=>H.openTask('build'));
 H.init(async()=>{const data=await api('/hub/builds');H.user=data.user;H.board('build-board',data.tasks,'build',data.user);await loadWhitelist();});
 // Family photos arrive with the directory, so draw the list again once it is ready.
 window.familyAccount.ready.then(renderPeople,()=>{});renderPeople();
 loadPins();setInterval(()=>{if(!document.hidden)loadPins();},60000);
 mapStatus();setInterval(mapStatus,15000);document.addEventListener('visibilitychange',()=>{if(!document.hidden)mapStatus();});
})();
