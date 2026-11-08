(() => {
 const H=window.familyHub,{$,api,notice}=H,BASE='https://fam-api.xgold.tech/family';
 let following=!matchMedia('(prefers-reduced-motion: reduce)').matches,latest,lastTarget='',checking=false,frameTimer;
 const frame=$('live-map');
 function showMap(){
  if(!latest?.online)return;const f=latest.focus;
  const target=following&&f.mode==='player'?'player:'+f.account:'area:'+f.world+':'+Math.round(f.x)+':'+Math.round(f.z);
  const params=new URLSearchParams({worldname:f.world||'world',mapname:f.world==='world'?'surface':'flat',x:Math.round(f.x||0),y:Math.round(f.y||64),z:Math.round(f.z||0),zoom:'5',nogui:'false',nopanel:'true',nocompass:'true'});
  if(following&&f.mode==='player')params.set('playername',f.account);
  if(target!==lastTarget){frame.src=BASE+'/mc-map/?'+params;lastTarget=target;$('map-placeholder').hidden=false;$('map-message').textContent='Opening the live map…';clearTimeout(frameTimer);frameTimer=setTimeout(()=>{$('map-message').textContent='The map is taking a little longer. Use “Open map” to try it directly.';},20000);}
  $('open-map').href=BASE+'/mc-map/?'+new URLSearchParams({...Object.fromEntries(params),nogui:'false',nopanel:'false'});
 }
 function followButton(){$('map-follow').textContent=following?'Pause following':'Follow players';$('map-follow').setAttribute('aria-pressed',String(following));}
 async function mapStatus(){
  if(checking||document.hidden)return;checking=true;
  try{const r=await fetch(BASE+'/mc-status',{cache:'no-store',signal:AbortSignal.timeout(12000)});latest=await r.json();if(!r.ok||!latest.online)throw Error(latest.error||'The live map is temporarily unavailable.');
   const n=latest.players.length,f=latest.focus;
   $('map-status').textContent=(n?`${n} player${n===1?'':'s'} online · `:'No one online · ')+(f.mode==='player'?(following?'Following ':'Near ')+(f.name||f.account):f.mode==='activity'?'Most active area · past 3 weeks':f.mode==='chunks'?'Recently saved chunks · activity history is building':'World spawn · activity history is building');
   if(following||!lastTarget)showMap();
  }catch(e){$('map-status').textContent=e.message;if(!lastTarget){$('map-placeholder').hidden=false;$('map-message').textContent='Live map unavailable. Join instructions and the build board are ready below.';}}
  finally{checking=false;}
 }
 frame.addEventListener('load',()=>{if(frame.getAttribute('src')){clearTimeout(frameTimer);$('map-placeholder').hidden=true;}});
 $('map-follow').addEventListener('click',()=>{following=!following;lastTarget='';followButton();showMap();});followButton();

 const instructions=$('platform-instructions'),platform=$('join-platform'),whitelistForm=$('whitelist-form');
 let accounts=[],whitelistPoll;
 const featured='Mineville, Lifeboat, Enchanted, Galaxite, or The Hive',JAVA='185.172.53.60:25565',BEDROCK='185.172.53.60',FRIEND='GoldServer2951',PS_DNS='45.55.68.52';
 function paragraph(text,cls){const p=H.node('p',text,cls);instructions.append(p);return p;}
 function steps(items,parent=instructions){const list=H.node('ol');for(const text of items)list.append(H.node('li',text));parent.append(list);}
 function address(bedrock=false){const p=H.node('p');p.append(H.node('code',bedrock?BEDROCK:JAVA));if(bedrock)p.append(document.createElement('br'),H.node('span','Port: 19133'));instructions.append(p);const b=H.node('button',bedrock?'Copy Bedrock address':'Copy Java address','quiet');b.type='button';b.addEventListener('click',async()=>{const text=bedrock?BEDROCK:JAVA;try{await navigator.clipboard.writeText(text);b.textContent='Copied';setTimeout(()=>b.textContent=bedrock?'Copy Bedrock address':'Copy Java address',2500);}catch{b.textContent=text;}});instructions.append(b);}
 function dns(kind,parent=instructions){
  const primary=kind==='playstation'?PS_DNS:'104.238.130.180';
  steps([kind==='switch'?'System Settings → Internet → Internet Settings → your network → Change Settings → DNS Settings → Manual.':'Open your console’s Internet Settings and choose manual DNS.',`Set primary DNS to ${primary} and secondary DNS to 8.8.8.8.`,`Save and reconnect. In Minecraft’s Servers tab, join ${featured}.`,'In BedrockConnect, enter 185.172.53.60, port 19133.'],parent);
 }
 // The join grab bar sits on the bottom of the live map, so the map itself can be dragged freely.
 // Tapping the bar, or pulling it up, scrolls to the full instructions below.
 const peeks={java:[JAVA,'Multiplayer → Add Server'],bedrock:[BEDROCK,'Port 19133 · Servers → Add Server'],xbox:[FRIEND,'Add as an Xbox friend'],switch:[FRIEND,'Add as a Microsoft / Xbox friend'],playstation:[PS_DNS,'Primary DNS · secondary 8.8.8.8']};
 const bar=$('join-bar'),peekSelect=$('join-peek-platform'),peekLine=$('join-line'),peekCopy=$('join-copy');let peekValue='',peekTimer;
 peekSelect.append(...[...platform.options].map(o=>o.cloneNode(true)));
 function renderPeek(kind){const [value,hint]=peeks[kind];peekValue=value;peekSelect.value=kind;peekLine.replaceChildren(H.node('code',value),H.node('span',hint,'hint'));clearTimeout(peekTimer);peekCopy.textContent='Copy';peekCopy.setAttribute('aria-label','Copy '+value);bar.hidden=false;}
 peekSelect.addEventListener('change',()=>{platform.value=peekSelect.value;renderPlatform();});
 peekCopy.addEventListener('click',async()=>{try{await navigator.clipboard.writeText(peekValue);peekCopy.textContent='Copied';}catch{peekCopy.textContent='Could not copy';}clearTimeout(peekTimer);peekTimer=setTimeout(()=>peekCopy.textContent='Copy',2500);});
 const reduced=matchMedia('(prefers-reduced-motion: reduce)'),behavior=()=>reduced.matches?'auto':'smooth',goJoin=()=>$('join-server').scrollIntoView({behavior:behavior(),block:'start'});
 let drag=null,dragged=false;
 bar.addEventListener('pointerdown',e=>{if(e.button||e.target.closest('[data-no-grab]'))return;drag={y:e.clientY,top:scrollY,id:e.pointerId,at:e.timeStamp,moved:false};bar.setPointerCapture(e.pointerId);});
 bar.addEventListener('pointermove',e=>{
  if(!drag||e.pointerId!==drag.id)return;const dy=drag.y-e.clientY;
  if(!drag.moved){if(Math.abs(dy)<6)return;drag.moved=dragged=true;bar.setAttribute('data-dragging','');}
  scrollTo({top:Math.max(0,drag.top+dy),behavior:'instant'});
 });
 // The bar stays under the pointer while the page follows it. On release the page settles on the map or on the instructions.
 function release(e){
  if(!drag||e.pointerId!==drag.id)return;const d=drag,dy=d.y-e.clientY;drag=null;bar.removeAttribute('data-dragging');
  if(!d.moved)return;setTimeout(()=>dragged=false,50);
  if(e.type==='pointerup'&&(dy>90||(dy>24&&dy/Math.max(1,e.timeStamp-d.at)>.6)))goJoin();else scrollTo({top:0,behavior:behavior()});
 }
 bar.addEventListener('pointerup',release);bar.addEventListener('pointercancel',release);
 bar.addEventListener('click',e=>{if(dragged||e.target.closest('[data-no-grab]'))return;goJoin();});
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
  renderPeek(selected);
  const edition=selected==='java'?'java':'bedrock';if(whitelistForm.elements.edition.value!==edition)whitelistForm.elements.username.value='';whitelistForm.elements.edition.value=edition;editionHint();renderAccounts();
 }
 function editionHint(){const bedrock=whitelistForm.elements.edition.value==='bedrock';$('whitelist-name-label').firstChild.textContent=bedrock?'Xbox gamertag':'Minecraft username';$('whitelist-hint').textContent=bedrock?'Enter your Xbox gamertag exactly, including spaces. Leave off the server’s dot prefix.':'Use your Java username, not your email.';}
 function renderAccounts(){const list=$('whitelist-accounts');list.replaceChildren();for(const r of accounts){list.append(H.node('p',`${r.edition==='java'?'Java':'Bedrock'} · ${r.username} · ${r.status==='added'?'Whitelisted':r.status==='failed'?(r.error||'Could not add this account. Try again.'):'Adding to the server…'}`));}
  const existing=accounts.find(r=>r.edition===whitelistForm.elements.edition.value&&['pending','processing','added'].includes(r.status));
  whitelistForm.querySelector('button').disabled=!!existing;whitelistForm.elements.username.disabled=!!existing;if(existing)whitelistForm.elements.username.value=existing.username;
 }
 function syncWhitelistAuth(){const ok=!!H.user&&!!window.familyAccount.current;$('whitelist-auth').hidden=ok;whitelistForm.hidden=!ok;if(!ok){accounts=[];$('whitelist-accounts').replaceChildren();clearTimeout(whitelistPoll);}}
 async function loadWhitelist(){
  try{const data=await api('/hub/mc-whitelist');accounts=data.accounts;syncWhitelistAuth();renderAccounts();clearTimeout(whitelistPoll);if(accounts.some(r=>['pending','processing'].includes(r.status)))whitelistPoll=setTimeout(loadWhitelist,2500);}
  catch(e){notice('whitelist-message',e.message,true);}
 }
 platform.addEventListener('change',renderPlatform);whitelistForm.elements.edition.addEventListener('change',()=>{whitelistForm.elements.username.value='';editionHint();renderAccounts();});
 whitelistForm.addEventListener('submit',async e=>{e.preventDefault();const button=whitelistForm.querySelector('button');button.disabled=true;notice('whitelist-message','Verifying your account and adding it to the server…');try{await api('/hub/mc-whitelist',{method:'POST',body:{edition:whitelistForm.elements.edition.value,username:whitelistForm.elements.username.value.trim()}});await loadWhitelist();notice('whitelist-message','Your request is being processed. You can join as soon as your account says “Whitelisted”.');}catch(error){notice('whitelist-message',error.message,true);button.disabled=false;}});
 window.addEventListener('family-account-change',()=>{if(!window.familyAccount.current)syncWhitelistAuth();});renderPlatform();
 $('add-build').addEventListener('click',()=>H.openTask('build'));
 H.init(async()=>{const data=await api('/hub/builds');H.user=data.user;H.board('build-board',data.tasks,'build',data.user);await loadWhitelist();});
 mapStatus();setInterval(mapStatus,15000);document.addEventListener('visibilitychange',()=>{if(!document.hidden)mapStatus();});
})();
