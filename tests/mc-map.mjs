import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {chromium} from 'playwright';
// /mc is one full-screen live map. Glass floats over it: map buttons, a status chip, a sheet, and the island of tabs.
const root=new URL('../',import.meta.url).pathname;
async function server(){const s=createServer(async(req,res)=>{try{let p=new URL(req.url,'http://local').pathname;if(p.endsWith('/'))p+='index.html';const f=resolve(root,'.'+p);if(!f.startsWith(root))throw Error();const b=await readFile(f);res.setHeader('Content-Type',f.endsWith('.js')?'text/javascript':f.endsWith('.css')?'text/css':f.endsWith('.png')?'image/png':'text/html');res.end(b);}catch{res.writeHead(404);res.end();}});await new Promise(r=>s.listen(0,'127.0.0.1',r));return s;}
// Dynmap's marker files, one per world: signs and anything else marked on the map.
const MARKERS={world:{_spawn_world:{label:'Spawn',x:0,y:64,z:0},sign_1:{label:'Base',x:100,y:70,z:-200}},world_nether:{portal:{label:'Portal',x:10,y:80,z:20}},world_the_end:{}};
const players=[{account:'Alex',name:'Alex',world:'world',x:50,y:70,z:60},{account:'Carter',name:'Carter',world:'world',x:300,y:70,z:400}];
const PNG=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==','base64');
// The stub map is cross-origin like the real one. Like Leaflet it consumes the wheel and touch (otherwise they would chain up),
// and it counts the wheel events, presses and drags that reach it.
// stars (a Set) and lastSeen (a spot, or null) switch on the two per-member endpoints; left out they answer 404 like a server without them.
async function mock(context,{mapUp=true,signed=false,online=[],stars,lastSeen}={}){
 if(signed)await context.addInitScript(()=>{localStorage.setItem('destin-who',JSON.stringify({name:'Carter',email:'test@example.com'}));localStorage.setItem('family-session',JSON.stringify({name:'Carter',token:'test-token'}));});
 await context.route('https://fam-api.xgold.tech/**',route=>{
  const p=new URL(route.request().url()).pathname.replace('/family','');
  if(p==='/mc-status')return mapUp?route.fulfill({json:{online:true,players:online,focus:online.length?{mode:'player',...online[0]}:{mode:'spawn',world:'world',x:0,y:64,z:0}}}):route.fulfill({status:503,json:{online:false,error:'The live map is temporarily unavailable.'}});
  const marker=p.match(/^\/mc-map\/tiles\/_markers_\/marker_(\w+)\.json$/);if(marker)return route.fulfill({json:{sets:{markers:{markers:MARKERS[marker[1]]||{}}},timestamp:1}});
  if(p.startsWith('/mc-map/'))return route.fulfill({contentType:'text/html',body:'<!doctype html><title>Map</title><style>html,body{margin:0;height:100%;background:#222;touch-action:none}</style><script>window.wheels=window.downs=window.drags=0;addEventListener("wheel",e=>{e.preventDefault();window.wheels++},{passive:false});addEventListener("pointerdown",()=>window.downs++);addEventListener("pointermove",e=>{if(e.buttons)window.drags++})</script>'});
  if(p.startsWith('/photos/'))return route.fulfill({contentType:'image/png',body:PNG});
  if(p==='/users')return route.fulfill({json:{users:[{id:'carter',name:'Carter',registered:true,photo_url:'https://fam-api.xgold.tech/family/photos/carter'}]}});
  if(p==='/hub/mc-stars'&&stars){if(route.request().method()==='POST'){const b=route.request().postDataJSON();b.starred?stars.add(b.pin):stars.delete(b.pin);return route.fulfill({json:{starred:b.starred}});}return route.fulfill({json:{stars:[...stars]}});}
  if(p==='/hub/mc-last-seen'&&lastSeen!==undefined)return route.fulfill({json:{spot:lastSeen}});
  if(p==='/hub/builds')return route.fulfill({json:{user:{id:'carter',name:'Carter'},tasks:[]}});
  if(p==='/hub/mc-whitelist')return route.fulfill({json:{accounts:[{edition:'java',username:'Carter',status:'added'}]}});
  return route.fulfill({status:404,json:{error:'Not mocked'}});
 });
}
const inMap=page=>page.frame({url:/mc-map/}).evaluate(()=>({wheels:window.wheels,downs:window.downs,drags:window.drags}));
async function until(check,what){for(let i=0;i<50;i++){if(await check())return;await new Promise(r=>setTimeout(r,100));}assert.fail('Timed out waiting for '+what);}
const scrollY=page=>page.evaluate(()=>window.scrollY);
const tab=(page,name)=>page.locator(`.tab[data-tab=${name}]`);
const sheetOpen=page=>page.locator('#sheet').isVisible();
const src=async page=>await page.locator('#live-map').getAttribute('src')||'';
async function launch(){const s=await server(),browser=await chromium.launch({args:['--no-sandbox']});return {s,browser,origin:`http://127.0.0.1:${s.address().port}`,done:async()=>{await browser.close();await new Promise(r=>s.close(r));}};}
const names=(page,section)=>page.locator(`#people-list .row-item:${section}`).locator('.row-name').allTextContents();

test('the map fills the screen and is live; the island opens and closes the sheets',async()=>{
 const {browser,origin,done}=await launch();
 try{
  const context=await browser.newContext({viewport:{width:1280,height:800}});await context.grantPermissions(['clipboard-read','clipboard-write'],{origin});await mock(context);const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(origin+'/mc/');await page.locator('#island').waitFor({state:'visible'});await until(()=>page.frame({url:/mc-map/}),'the map frame');
  // The map covers the whole screen and the page itself never scrolls.
  const map=await page.locator('#live-map').boundingBox();assert.deepEqual([map.x,map.y,map.width,map.height],[0,0,1280,800]);
  assert(await page.evaluate(()=>document.documentElement.scrollHeight<=innerHeight&&getComputedStyle(document.body).overflow==='hidden'));
  // The map takes the mouse directly: a drag and the wheel both reach it.
  await page.mouse.move(640,300);await page.mouse.down();await page.mouse.move(700,340,{steps:6});await page.mouse.up();
  const seen=await inMap(page);assert(seen.downs>0&&seen.drags>0,'the map to get the drag');
  await page.mouse.wheel(0,500);await until(async()=>(await inMap(page)).wheels>0,'the map to get the wheel');assert.equal(await scrollY(page),0);
  // The island: three tabs, centered at the bottom, each at least 44px tall, over glass.
  const island=await page.locator('#island').boundingBox();assert(Math.abs(island.x+island.width/2-640)<=1&&island.y+island.height<=800&&island.y+island.height>=770,JSON.stringify(island));
  assert.deepEqual(await page.locator('.tab span').allTextContents(),['Locations','Construction','Join']);
  for(const t of await page.locator('.tab').all())assert((await t.boundingBox()).height>=44);
  assert((await page.locator('#island').evaluate(e=>getComputedStyle(e).backdropFilter||'')).includes('blur'),'glass blur on the island');
  // A tab opens its sheet, titled for it; the same tab, Escape or the close button closes it.
  assert.equal(await sheetOpen(page),false);assert.match(await page.locator('#map-status').textContent(),/No one online/);assert.equal(await page.locator('#map-status').isVisible(),true);
  await tab(page,'people').click();assert.equal(await sheetOpen(page),true);assert.equal(await page.locator('#sheet-title').textContent(),'People & Locations');assert.equal(await tab(page,'people').getAttribute('aria-pressed'),'true');assert.equal(await page.locator('#map-status').isVisible(),false);
  await tab(page,'people').click();assert.equal(await sheetOpen(page),false);assert.equal(await page.locator('#map-status').isVisible(),true);
  await tab(page,'people').click();await page.keyboard.press('Escape');assert.equal(await sheetOpen(page),false);
  await tab(page,'people').click();await page.locator('#sheet-close').click();assert.equal(await sheetOpen(page),false);
  // Pulling the header down dismisses it too.
  await tab(page,'people').click();const title=await page.locator('#sheet-title').boundingBox();await page.mouse.move(title.x+title.width+40,title.y+10);await page.mouse.down();await page.mouse.move(title.x+title.width+40,title.y+120,{steps:8});await page.mouse.up();assert.equal(await sheetOpen(page),false);
  // Join: the platform picker, the address and Copy.
  await tab(page,'join').click();assert.equal(await page.locator('#sheet-title').textContent(),'Join the server');assert.equal(await page.locator('#join-platform').isVisible(),true);assert.match(await page.locator('#platform-instructions').textContent(),/185\.172\.53\.60:25565/);
  await page.getByRole('button',{name:'Copy Java address'}).click();await until(async()=>await page.evaluate(()=>navigator.clipboard.readText())==='185.172.53.60:25565','the address on the clipboard');
  await page.selectOption('#join-platform','bedrock');assert.match(await page.locator('#platform-instructions').textContent(),/Port: 19133/);
  // Switching tabs swaps the sheet instead of stacking another.
  await tab(page,'build').click();assert.equal(await page.locator('#sheet-title').textContent(),'Construction');assert.equal(await page.locator('.sheet-view:visible').count(),1);assert.equal(await page.locator('#auth-panel').isVisible(),true,'signed out, the board asks for a sign-in');
  assert.equal(await tab(page,'join').getAttribute('aria-pressed'),'false');
  assert.deepEqual(errors,[]);await context.close();
  // No map, no problem: the island and its sheets still work.
  const down=await browser.newContext({viewport:{width:1280,height:800}});await mock(down,{mapUp:false});const d=await down.newPage();
  await d.goto(origin+'/mc/');await d.getByText('The live map is temporarily unavailable.').waitFor();await tab(d,'join').click();assert.match(await d.locator('#platform-instructions').textContent(),/185\.172\.53\.60:25565/);await down.close();
 }finally{await done();}
});
test('on a phone the island and sheet fit, the map takes touch, and a tapped place closes the sheet',async()=>{
 const {browser,origin,done}=await launch();
 try{
  const phone=await browser.newContext({viewport:{width:375,height:700},hasTouch:true,isMobile:true});await mock(phone,{online:players});const m=await phone.newPage();
  await m.goto(origin+'/mc/');await m.locator('#island').waitFor({state:'visible'});await until(()=>m.frame({url:/mc-map/}),'the map frame on the phone');
  assert(await m.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  const island=await m.locator('#island').boundingBox();assert(island.x>=0&&island.x+island.width<=375&&island.y+island.height<=700,JSON.stringify(island));
  const cdp=await phone.newCDPSession(m),touch=(type,y,x=190)=>cdp.send('Input.dispatchTouchEvent',{type,touchPoints:type==='touchEnd'?[]:[{x,y}]});
  await touch('touchStart',250);for(let y=250;y<=310;y+=10)await touch('touchMove',y);await touch('touchEnd',0);
  const touched=await inMap(m);assert(touched.downs>0&&touched.drags>0,'the map to get the touch drag');assert.equal(await scrollY(m),0);
  await tab(m,'people').tap();await until(()=>sheetOpen(m),'the sheet');await m.waitForTimeout(700);// let the rise animation finish before measuring
  const sheet=await m.locator('#sheet').boundingBox();assert(sheet.x>=0&&sheet.x+sheet.width<=375&&sheet.y>=95&&sheet.y+sheet.height<=island.y,`a sheet that fits between the ribbon and the island, got ${JSON.stringify(sheet)}`);
  assert(await m.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await m.locator('#people-list .row-main',{hasText:'Base'}).tap();await until(async()=>(await src(m)).includes('x=100'),'the map to move');assert.equal(await sheetOpen(m),false,'the sheet closes so the map shows');
  await phone.close();
 }finally{await done();}
});
test('people and locations: online players first, photo or initial or emoji bubbles, tap to go',async()=>{
 const {browser,origin,done}=await launch();
 try{
  const context=await browser.newContext({viewport:{width:1280,height:800}});await mock(context,{online:players});const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(origin+'/mc/');await tab(page,'people').click();await until(async()=>await page.locator('#people-list .row-item').count()===5,'the rows');
  assert.deepEqual(await page.locator('#people-list .rows-title').allTextContents(),['Online now','Named Locations']);
  assert.deepEqual(await page.locator('#people-list .row-name').allTextContents(),['Alex','Carter','Base','Portal','Spawn'],'players, then locations');
  assert.equal(await page.locator('#people-list .star').count(),0,'no stars when signed out');
  // Carter is in the family directory, so he gets his photo; Alex is not, so he gets a colored initial; places get emoji.
  const bubble=text=>page.locator('#people-list .row-item',{hasText:text}).locator('.bubble');
  await until(async()=>await bubble('Carter').locator('img').count()===1,'the directory photo');
  assert.equal(await bubble('Alex').textContent(),'A');assert.equal(await bubble('Alex').locator('img').count(),0);
  assert.deepEqual([await bubble('Base').textContent(),await bubble('Portal').textContent(),await bubble('Spawn').textContent()],['🏠','🌀','🌍']);
  assert.equal((await bubble('Alex').evaluate(e=>e.style.getPropertyValue('--bubble'))).startsWith('var(--bubble-'),true);
  assert.match(await page.locator('#people-list .row-item',{hasText:'Base'}).locator('.row-sub').textContent(),/Overworld · 100, 70, -200/);
  assert.match(await page.locator('#people-list .row-item',{hasText:'Carter'}).locator('.row-sub').textContent(),/Overworld · 300, 70, 400/);
  // A place takes the map there and pauses following; the sheet stays open on a wide screen.
  await page.locator('#people-list .row-main',{hasText:'Base'}).click();await until(async()=>(await src(page)).includes('x=100'),'the map to move');
  assert((await src(page)).includes('z=-200')&&(await src(page)).includes('worldname=world&'));
  assert.equal(await page.locator('#map-follow').getAttribute('aria-pressed'),'false');assert.equal(await page.locator('#map-follow').getAttribute('aria-label'),'Follow players');
  assert.equal(await sheetOpen(page),true);await tab(page,'people').click();assert.match(await page.locator('#map-status').textContent(),/Showing Base/);await tab(page,'people').click();
  await page.locator('#people-list .row-main',{hasText:'Portal'}).click();await until(async()=>(await src(page)).includes('worldname=world_nether'),'the Nether map');assert((await src(page)).includes('mapname=flat'));
  // A player is followed live.
  await page.locator('#people-list .row-main',{hasText:'Alex'}).click();await until(async()=>(await src(page)).includes('playername=Alex'),'the map to follow Alex');
  assert.equal(await page.locator('#map-follow').getAttribute('aria-pressed'),'true');assert.equal(await page.locator('#map-follow').getAttribute('aria-label'),'Pause following');
  await tab(page,'people').click();assert.match(await page.locator('#map-status').textContent(),/Following Alex/);await tab(page,'people').click();
  // The how-to opens the in-game steps.
  assert.equal(await page.locator('.how-to li').first().isVisible(),false);await page.getByText('How to name a location!').click();assert.equal(await page.locator('.how-to li').first().isVisible(),true);assert.match(await page.locator('.how-to').textContent(),/\[dynmap\]/);
  assert.deepEqual(errors,[]);await context.close();
 }finally{await done();}
});
test('signed in: the map follows my player, and a server without stars still works',async()=>{
 const {browser,origin,done}=await launch();
 try{
  const context=await browser.newContext({viewport:{width:1280,height:800}});await mock(context,{signed:true,online:players});const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(origin+'/mc/');
  // The server would pick Alex (first alphabetically); a signed-in Carter gets his own player.
  await until(async()=>(await src(page)).includes('playername=Carter'),'the map to follow Carter');
  await tab(page,'people').click();assert.match(await page.locator('#map-status').textContent(),/Following Carter/);assert.equal(await page.locator('#people-list .star').count(),0,'no star buttons when the server cannot save them');
  assert.equal(await page.locator('#people-list .row-item').count(),5);
  await tab(page,'build').click();await until(()=>page.locator('#signed-content').isVisible(),'the board when signed in');assert.equal(await page.locator('#auth-panel').isVisible(),false);
  assert.deepEqual(errors,[]);await context.close();
 }finally{await done();}
});
// Stars are per account and live on the server; they put a player or a location first in its group.
test('stars: gold when starred, first in their group, and remembered',async()=>{
 const {browser,origin,done}=await launch();
 try{
  const stars=new Set(),context=await browser.newContext({viewport:{width:1280,height:800}});await mock(context,{signed:true,online:players,stars});const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const order=async()=>await page.locator('#people-list .row-name').allTextContents();
  await page.goto(origin+'/mc/');await tab(page,'people').click();await until(async()=>await page.locator('#people-list .star').count()===5,'the star buttons');
  assert.deepEqual(await order(),['Alex','Carter','Base','Portal','Spawn']);
  const fill=name=>page.getByRole('button',{name}).locator('svg').evaluate(e=>getComputedStyle(e).fill);
  await page.getByRole('button',{name:'Star Spawn'}).click();await until(async()=>(await order()).indexOf('Spawn')===2,'Spawn to move first among locations');
  assert.deepEqual(await order(),['Alex','Carter','Spawn','Base','Portal']);assert.deepEqual([...stars],['world:markers:_spawn_world']);
  assert.equal(await page.getByRole('button',{name:'Star Spawn'}).getAttribute('aria-pressed'),'true');
  assert.equal(await fill('Star Spawn'),'rgb(255, 196, 0)');assert.equal(await fill('Star Base'),'none');
  assert.equal(await page.evaluate(()=>document.activeElement.dataset.pin),'world:markers:_spawn_world','focus stays on the star after it moves');
  await page.getByRole('button',{name:'Star Carter'}).click();await until(async()=>(await order())[0]==='Carter','Carter to move first among players');assert(stars.has('player:carter'));
  await page.reload();await tab(page,'people').click();await until(async()=>(await order())[0]==='Carter','the stars to be remembered');assert.deepEqual(await order(),['Carter','Alex','Spawn','Base','Portal']);
  await page.getByRole('button',{name:'Star Spawn'}).click();await until(async()=>(await order()).indexOf('Base')===2,'the star to come off');assert.equal(stars.size,1);
  assert.deepEqual(errors,[]);await context.close();
 }finally{await done();}
});
// The last spot is sampled while someone is online. Signed in and offline, the map shows it; online, the map follows them.
test('last seen: offline the map shows where I was, online it follows me, and it goes back after I leave',async()=>{
 const {browser,origin,done}=await launch();
 try{
  const online=[players[0]],seen_at=new Date(Date.now()-2*3600000).toISOString();
  const context=await browser.newContext({viewport:{width:1280,height:800}});await mock(context,{signed:true,online,lastSeen:{world:'world',x:777,y:70,z:-333,seen_at}});const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const poll=()=>page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));
  await page.goto(origin+'/mc/');await until(async()=>(await src(page)).includes('x=777'),'the map to show the last spot');
  assert(!(await src(page)).includes('playername'),'not following Alex');assert((await src(page)).includes('z=-333'));
  assert.match(await page.locator('#map-status').textContent(),/Carter last seen here · 2 hours ago/);
  online.push(players[1]);await poll();await until(async()=>(await src(page)).includes('playername=Carter'),'the map to follow Carter');assert.match(await page.locator('#map-status').textContent(),/Following Carter/);
  online.pop();await poll();await until(async()=>(await src(page)).includes('x=777'),'the map to go back to the last spot');
  assert.deepEqual(errors,[]);await context.close();
 }finally{await done();}
});
