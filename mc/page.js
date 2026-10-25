(() => {
 const H=window.familyHub,{$,api,notice}=H,BASE='https://fam-api.xgold.tech/family';
 let following=!matchMedia('(prefers-reduced-motion: reduce)').matches,latest,lastTarget='',checking=false,frameTimer;
 const frame=$('live-map');
 function showMap(){
  if(!latest?.online)return;const f=latest.focus;
  const target=following&&f.mode==='player'?'player:'+f.account:'area:'+f.world+':'+Math.round(f.x)+':'+Math.round(f.z);
  const params=new URLSearchParams({worldname:f.world||'world',mapname:f.world==='world'?'surface':'flat',x:Math.round(f.x||0),y:Math.round(f.y||64),z:Math.round(f.z||0),zoom:'5',nogui:'true',nocompass:'true'});
  if(following&&f.mode==='player')params.set('playername',f.account);
  if(target!==lastTarget){frame.src=BASE+'/mc-map/?'+params;lastTarget=target;$('map-placeholder').hidden=false;$('map-message').textContent='Opening the live map…';clearTimeout(frameTimer);frameTimer=setTimeout(()=>{$('map-message').textContent='The map is taking a little longer. Use “Open map” to try it directly.';},20000);}
  $('open-map').href=BASE+'/mc-map/?'+new URLSearchParams({...Object.fromEntries(params),nogui:'false'});
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
 for(const b of document.querySelectorAll('.copy-address'))b.addEventListener('click',async()=>{try{await navigator.clipboard.writeText(b.dataset.copy);const before=b.textContent;b.textContent='Copied';setTimeout(()=>b.textContent=before,2500);}catch{b.textContent=b.dataset.copy;}});
 $('add-build').addEventListener('click',()=>H.openTask('build'));
 H.init(async()=>{const data=await api('/hub/builds');H.user=data.user;H.board('build-board',data.tasks,'build',data.user);});
 mapStatus();setInterval(mapStatus,15000);document.addEventListener('visibilitychange',()=>{if(!document.hidden)mapStatus();});
})();
