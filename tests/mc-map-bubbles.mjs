import {test} from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const dir=new URL('../deploy/family-hub/',import.meta.url).pathname;
const FACE='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"><rect width="8" height="8" fill="#e8c9a8"/></svg>';
// A page shaped like Dynmap's: markers are divs Dynmap builds later, with an icon image and a name label.
test('map-bubbles.js dresses locations as emoji pins and players as ringed photos, as Dynmap adds them',async()=>{
 const browser=await chromium.launch({args:['--no-sandbox']});
 try{
  const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('https://fam-api.xgold.tech/**',route=>{
   const p=new URL(route.request().url()).pathname;
   if(p==='/family/mc-map/')return route.fulfill({contentType:'text/html',body:'<!doctype html><html><head></head><body class="dynmap"><div id="pane"></div></body></html>'});
   if(p==='/family/users')return route.fulfill({json:{users:[{name:'Carter',photo_url:'https://fam-api.xgold.tech/family/photos/carter'}]}});
   if(p.startsWith('/family/photos/'))return route.fulfill({contentType:'image/svg+xml',body:FACE});
   return route.fulfill({status:404,body:''});
  });
  await page.goto('https://fam-api.xgold.tech/family/mc-map/?worldname=world_nether');
  await page.addStyleTag({path:dir+'map-bubbles.css'});await page.addScriptTag({path:dir+'map-bubbles.js'});
  // Dynmap adds these after load.
  await page.evaluate(()=>{
   const pane=document.getElementById('pane'),place=label=>{const d=document.createElement('div');d.className='Marker mapMarker';d.innerHTML=`<img class="markerIcon16x16" src="tiles/_markers_/sign.png"><span class="markerName markerName16x16">${label}</span>`;pane.append(d);};
   const player=name=>{const d=document.createElement('div');d.className='Marker playerMarker';d.innerHTML=`<span class="playerName" style="position:absolute">${name}</span><div class="healthContainer"><div class="playerHealthBackground"></div><div class="playerArmorBackground"></div></div>`;pane.append(d);const head=document.createElement('canvas');head.className='playerIcon';d.prepend(head);};
   place('Base');place('Spawn');place('Zzz');player('Carter');player('Alex');
  });
  await page.waitForFunction(()=>document.querySelectorAll('.fm-pin').length===3&&document.querySelector('.fm-photo'));
  const svgOf=async label=>decodeURIComponent((await page.locator('.mapMarker',{hasText:label}).locator('img').getAttribute('src')).replace('data:image/svg+xml,',''));
  assert((await svgOf('Base')).includes('🏠'));assert((await svgOf('Spawn')).includes('🌍'));assert((await svgOf('Zzz')).includes('🔥'),'the Nether default for an unknown name');
  const box=await page.locator('.mapMarker',{hasText:'Base'}).locator('img').evaluate(e=>({w:getComputedStyle(e).width,h:getComputedStyle(e).height}));assert.deepEqual(box,{w:'44px',h:'52px'});
  assert.equal(await page.locator('.mapMarker .markerName').first().evaluate(e=>getComputedStyle(e).backgroundColor),'rgba(30, 30, 33, 0.72)');
  // Carter is in the family directory: his photo shows in a ring and the head is hidden. Alex keeps a ringed head.
  const carter=page.locator('.playerMarker',{hasText:'Carter'}),alex=page.locator('.playerMarker',{hasText:'Alex'});
  assert.equal(await carter.locator('.fm-photo').count(),1);assert.equal(await carter.evaluate(e=>e.classList.contains('fm-has-photo')),true);
  assert.equal(await carter.locator('canvas').evaluate(e=>getComputedStyle(e).visibility),'hidden');
  assert.equal(await alex.locator('.fm-photo').count(),0);assert.equal(await alex.locator('canvas').evaluate(e=>getComputedStyle(e).visibility),'visible');
  assert.equal(await alex.locator('canvas').evaluate(e=>getComputedStyle(e).borderRadius),'50%');
  // Just the bubble and a name: the health and armor bars are hidden, and the name sits beside the bubble.
  for(const m of [carter,alex]){assert.equal(await m.locator('.healthContainer').evaluate(e=>getComputedStyle(e).display),'none');assert.equal(await m.locator('.playerName').evaluate(e=>getComputedStyle(e).top),'-12px');}
  for(const m of [carter,alex])assert.match(await m.evaluate(e=>e.style.getPropertyValue('--fm-ring')),/^#[0-9a-f]{6}$/);
  assert.deepEqual(errors,[]);
 }finally{await browser.close();}
});
