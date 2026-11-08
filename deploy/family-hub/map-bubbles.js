// Runs inside the proxied Dynmap page (minecraft.js injects it). Draws named locations and players as Find My style bubbles:
// a location gets a colored pin with an emoji, a player gets a ring in their color around their family photo (or Minecraft head).
// Dynmap builds its markers with jQuery after load, so a MutationObserver dresses them as they appear.
(() => {
 'use strict';
 // Keep these two tables in step with mc/page.js, which draws the same bubbles in the sheet.
 const EMOJI=[[/spawn/i,'🌍'],[/home|house|base|cabin/i,'🏠'],[/farm|wheat|crop|garden/i,'🌾'],[/mine|cave|quarry/i,'⛏️'],[/village|town|city/i,'🏘️'],[/castle|tower|fort/i,'🏰'],[/ocean|sea|monument|lake|boat|dock/i,'🌊'],[/portal/i,'🌀']];
 const TINTS=['#a0638a','#d9506e','#4f9a2a','#2f7fd0','#c97a12','#7b6bc4'];
 const tint=s=>{let h=0;for(const c of String(s))h=(h*31+c.charCodeAt(0))%6;return TINTS[h];};
 const world=()=>(window.dynmap&&window.dynmap.world&&window.dynmap.world.name)||new URLSearchParams(location.search).get('worldname')||'world';
 const emojiFor=name=>{const hit=EMOJI.find(([re])=>re.test(name));return hit?hit[1]:({world_nether:'🔥',world_the_end:'🌌'})[world()]||'📍';};
 const pin=(emoji,color)=>'data:image/svg+xml,'+encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="44" height="52" viewBox="0 0 44 52"><path d="M22 51l-7-13h14z" fill="#fff"/><circle cx="22" cy="22" r="19" fill="${color}" stroke="#fff" stroke-width="3"/><text x="22" y="29.5" text-anchor="middle" font-size="20" font-family="Apple Color Emoji,Segoe UI Emoji,Noto Color Emoji,sans-serif">${emoji}</text></svg>`);
 let photos={};
 function dressPlace(el){
  if(el.dataset.fm)return;el.dataset.fm='1';
  const img=el.querySelector('img'),label=(el.querySelector('.markerName,.markerName-show')||{}).textContent||'';
  if(!img)return;img.src=pin(emojiFor(label),tint(label));img.classList.add('fm-pin');
 }
 // A player's in-game name is their first name, so the family directory gives their photo.
 function dressPlayer(el){
  const named=el.querySelector('.playerName,.playerNameSm,.playerNameLg');if(!named)return;
  const name=named.textContent.trim();el.style.setProperty('--fm-ring',tint(name));
  if(photos[name]&&!el.querySelector('.fm-photo')){const img=document.createElement('img');img.className='fm-photo';img.alt='';img.src=photos[name];el.insertBefore(img,el.firstChild);el.classList.add('fm-has-photo');}
 }
 function scan(root){
  if(!root||root.nodeType!==1)return;
  const found=[...root.querySelectorAll('.mapMarker,.playerMarker')];
  if(root.matches('.mapMarker,.playerMarker'))found.push(root);
  else{const own=root.closest('.playerMarker');if(own)found.push(own);}
  for(const el of found)el.classList.contains('mapMarker')?dressPlace(el):dressPlayer(el);
 }
 new MutationObserver(list=>{for(const m of list)for(const n of m.addedNodes)scan(n);}).observe(document.body,{childList:true,subtree:true});
 scan(document.body);
 fetch('/family/users',{credentials:'omit'}).then(r=>r.json()).then(data=>{photos={};for(const u of data.users||[])if(u.photo_url)photos[u.name]=u.photo_url;scan(document.body);}).catch(()=>{});
})();
