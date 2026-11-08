import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {chromium} from 'playwright';
// The /mc map fills the first screen and is live: it takes drags, the wheel and touch directly.
// Nothing on it scrolls the page, so the join grab bar on its bottom edge is the way down: tap it, or pull it up.
const root=new URL('../',import.meta.url).pathname;
async function server(){const s=createServer(async(req,res)=>{try{let p=new URL(req.url,'http://local').pathname;if(p.endsWith('/'))p+='index.html';const f=resolve(root,'.'+p);if(!f.startsWith(root))throw Error();const b=await readFile(f);res.setHeader('Content-Type',f.endsWith('.js')?'text/javascript':f.endsWith('.css')?'text/css':f.endsWith('.png')?'image/png':'text/html');res.end(b);}catch{res.writeHead(404);res.end();}});await new Promise(r=>s.listen(0,'127.0.0.1',r));return s;}
// The stub map is cross-origin like the real one. Like Leaflet it consumes the wheel and touch (otherwise they would chain up
// and scroll the page), and it counts the wheel events, presses and drags that reach it.
// Dynmap's marker files, one per world: signs and anything else marked on the map.
const MARKERS={world:{_spawn_world:{label:'Spawn',x:0,y:64,z:0},sign_1:{label:'Base',x:100,y:70,z:-200}},world_nether:{portal:{label:'Portal',x:10,y:80,z:20}},world_the_end:{}};
const players=[{account:'Alex',name:'Alex',world:'world',x:50,y:70,z:60},{account:'Carter',name:'Carter',world:'world',x:300,y:70,z:400}];
// stars (a Set) and lastSeen (a spot, or null) switch on the two per-member endpoints; left out they answer 404 like a server without them.
async function mock(context,{mapUp=true,signed=false,online=[],stars,lastSeen}={}){
 if(signed)await context.addInitScript(()=>{localStorage.setItem('destin-who',JSON.stringify({name:'Carter',email:'test@example.com'}));localStorage.setItem('family-session',JSON.stringify({name:'Carter',token:'test-token'}));});
 await context.route('https://fam-api.xgold.tech/**',route=>{
  const p=new URL(route.request().url()).pathname.replace('/family','');
  if(p==='/mc-status')return mapUp?route.fulfill({json:{online:true,players:online,focus:online.length?{mode:'player',...online[0]}:{mode:'spawn',world:'world',x:0,y:64,z:0}}}):route.fulfill({status:503,json:{online:false,error:'The live map is temporarily unavailable.'}});
  const marker=p.match(/^\/mc-map\/tiles\/_markers_\/marker_(\w+)\.json$/);if(marker)return route.fulfill({json:{sets:{markers:{markers:MARKERS[marker[1]]||{}}},timestamp:1}});
  if(p.startsWith('/mc-map/'))return route.fulfill({contentType:'text/html',body:'<!doctype html><title>Map</title><style>html,body{margin:0;height:100%;background:#222;touch-action:none}</style><script>window.wheels=window.downs=window.drags=0;addEventListener("wheel",e=>{e.preventDefault();window.wheels++},{passive:false});addEventListener("pointerdown",()=>window.downs++);addEventListener("pointermove",e=>{if(e.buttons)window.drags++})</script>'});
  if(p==='/users')return route.fulfill({json:{users:[{id:'carter',name:'Carter',registered:true}]}});
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
// The page rests with the join instructions at the top of the screen (just under the 48px scroll padding).
const atJoin=async page=>{const b=await page.locator('#join-server').boundingBox();return b.y>=0&&b.y<=60;};
// A wheel or smooth scroll can still be settling, so keep returning to the top until the page stays there.
async function toTop(page){for(let i=0,still=0;i<50&&still<3;i++){await page.evaluate(()=>scrollTo({top:0,behavior:'instant'}));await new Promise(r=>setTimeout(r,60));still=await scrollY(page)===0?still+1:0;}assert.equal(await scrollY(page),0,'the top of the page');}
const barTop=async page=>(await page.locator('#join-bar').boundingBox()).y;
const barHeight=async page=>(await page.locator('#join-bar').boundingBox()).height;
test('the map is live and the grab bar is the way down',async()=>{
 const s=await server(),browser=await chromium.launch({args:['--no-sandbox']}),origin=`http://127.0.0.1:${s.address().port}`;
 try{
  const context=await browser.newContext({viewport:{width:1280,height:800}});await context.grantPermissions(['clipboard-read','clipboard-write'],{origin});await mock(context);const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(origin+'/mc/');await page.locator('#join-bar').waitFor({state:'visible'});await until(()=>page.frame({url:/mc-map/}),'the map frame');
  assert.equal(await page.locator('#map-explore').count(),0);assert.equal(await page.locator('#map-activate').count(),0);
  // The map takes the mouse directly, with no click first: a drag and the wheel both reach it, and the page stays put.
  await page.mouse.move(640,300);await page.mouse.down();await page.mouse.move(700,340,{steps:6});await page.mouse.up();
  const seen=await inMap(page);assert(seen.downs>0&&seen.drags>0,'the map to get the drag');
  await page.mouse.wheel(0,500);await until(async()=>(await inMap(page)).wheels>0,'the map to get the wheel');await page.waitForTimeout(200);assert.equal(await scrollY(page),0);
  // The grab bar is small, sits on the bottom edge, and shows the Java address.
  const box=await page.locator('#join-bar').boundingBox();assert(Math.abs(box.y+box.height-800)<=1,'the bar to sit on the bottom edge');assert(box.height<=130,`a small bar, got ${box.height}px`);
  assert.match(await page.locator('#join-line').textContent(),/185\.172\.53\.60:25565/);
  // The wheel over the bar scrolls the page.
  await page.mouse.move(640,box.y+10);await page.mouse.wheel(0,400);await until(async()=>await scrollY(page)>0,'the page to scroll');await toTop(page);
  // A tap on the bar goes to the instructions.
  await page.mouse.click(640,await barTop(page)+10);await until(()=>atJoin(page),'the instructions');await toTop(page);
  // Pulling the bar up carries the page with it, and letting go far enough settles on the instructions.
  const pull=async rise=>{const y=await barTop(page)+10;await page.mouse.move(640,y);await page.mouse.down();await page.mouse.move(640,y-rise,{steps:10});};
  await pull(300);const followed=await scrollY(page);assert(Math.abs(followed-300)<=2,`the page to follow the bar, got ${followed}`);await page.mouse.up();await until(()=>atJoin(page),'the instructions after a pull');await toTop(page);
  // A short pull falls back to the map, and does not count as a tap.
  await pull(40);const short=await scrollY(page);assert(Math.abs(short-40)<=2,`a short pull to follow the bar, got ${short}`);await page.mouse.up();await until(async()=>await scrollY(page)===0,'the map after a short pull');await page.waitForTimeout(400);assert.equal(await scrollY(page),0);
  // The keyboard works too.
  await page.locator('#join-grab').focus();await page.keyboard.press('Enter');await until(()=>atJoin(page),'the instructions from the keyboard');await toTop(page);
  // The platform picker on the bar and the one in the instructions stay in step.
  await page.selectOption('#join-peek-platform','bedrock');assert.equal(await page.locator('#join-platform').inputValue(),'bedrock');
  assert.match(await page.locator('#join-line').textContent(),/185\.172\.53\.60.*Port 19133/);assert.match(await page.locator('#platform-instructions').textContent(),/Port: 19133/);
  await page.selectOption('#join-platform','xbox');assert.equal(await page.locator('#join-peek-platform').inputValue(),'xbox');assert.match(await page.locator('#join-line').textContent(),/GoldServer2951/);
  // Copy puts the address on the clipboard and leaves the page where it is.
  await page.selectOption('#join-peek-platform','java');await page.locator('#join-copy').click();
  await until(async()=>await page.locator('#join-copy').textContent()==='Copied','the Copy button to confirm');assert.equal(await page.evaluate(()=>navigator.clipboard.readText()),'185.172.53.60:25565');await page.waitForTimeout(400);assert.equal(await scrollY(page),0);
  assert.deepEqual(errors,[]);await context.close();
  // A phone: nothing overflows, a tap or a swipe up on the bar reaches the instructions, and the map takes touch.
  const phone=await browser.newContext({viewport:{width:375,height:700},hasTouch:true,isMobile:true});await mock(phone);const m=await phone.newPage();
  await m.goto(origin+'/mc/');await m.locator('#join-bar').waitFor({state:'visible'});await until(()=>m.frame({url:/mc-map/}),'the map frame on the phone');
  assert(await m.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  const bar=await m.locator('#join-bar').boundingBox();assert(Math.abs(bar.y+bar.height-700)<=1&&bar.x>=0&&bar.x+bar.width<=375&&bar.height<=190,`a bar that fits the phone, got ${JSON.stringify(bar)}`);
  const caption=await m.locator('.map-caption').boundingBox();assert(caption.x>=0&&caption.x+caption.width<=375);
  const cdp=await phone.newCDPSession(m),touch=(type,y,x=190)=>cdp.send('Input.dispatchTouchEvent',{type,touchPoints:type==='touchEnd'?[]:[{x,y}]});
  await touch('touchStart',200);for(let y=200;y<=260;y+=10)await touch('touchMove',y);await touch('touchEnd',0);
  const touched=await inMap(m);assert(touched.downs>0&&touched.drags>0,'the map to get the touch drag');assert.equal(await scrollY(m),0);
  await m.touchscreen.tap(190,await barTop(m)+8);await until(()=>atJoin(m),'the instructions after a tap');await toTop(m);
  const y0=await barTop(m)+8;await touch('touchStart',y0);for(let y=y0;y>=y0-250;y-=25)await touch('touchMove',y);await m.waitForTimeout(150);const carried=await scrollY(m);assert(Math.abs(carried-250)<=2,`the page to follow the finger, got ${carried}`);await touch('touchEnd',0);await until(()=>atJoin(m),'the instructions after a swipe');
  await phone.close();
  // No map, no problem: the bar still shows how to join and still opens the instructions.
  const down=await browser.newContext({viewport:{width:1280,height:800}});await mock(down,{mapUp:false});const d=await down.newPage();
  await d.goto(origin+'/mc/');await d.getByText('The live map is temporarily unavailable.').waitFor();assert.equal(await d.locator('#join-bar').isVisible(),true);assert.match(await d.locator('#join-line').textContent(),/185\.172\.53\.60:25565/);
  await d.mouse.click(640,await barTop(d)+10);await until(()=>atJoin(d),'the instructions with no map');await down.close();
 }finally{await browser.close();await new Promise(r=>s.close(r));}
});
// Places are the Dynmap markers. Signed out they sit under the join instructions; signed in they come first and ride on the grab bar.
test('places: signed out they sit under the join instructions, and a tap takes the map there',async()=>{
 const s=await server(),browser=await chromium.launch({args:['--no-sandbox']}),origin=`http://127.0.0.1:${s.address().port}`;
 try{
  const context=await browser.newContext({viewport:{width:1280,height:800}});await mock(context);const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(origin+'/mc/');await until(async()=>await page.locator('#places-list .place').count()===3,'the places to load');
  assert.deepEqual(await page.locator('#places-list .place-name').allTextContents(),['Base','Portal','Spawn']);
  assert.equal(await page.evaluate(()=>document.getElementById('join-server').nextElementSibling.id),'places');
  assert.equal(await page.locator('#places-bar-title').isVisible(),false);assert.equal(await page.locator('#join-peek').isVisible(),true);
  assert.equal(await page.locator('#places-title').textContent(),'Named Locations.');
  // The how-to link opens the in-game steps.
  assert.equal(await page.locator('.how-to li').first().isVisible(),false);await page.getByText('How to name a location!').click();assert.equal(await page.locator('.how-to li').first().isVisible(),true);assert.match(await page.locator('.how-to').textContent(),/\[dynmap\]/);
  // A place takes the map there, pauses following, says so, and brings the map back into view.
  await page.locator('#places-list .place',{hasText:'Base'}).click();
  await until(async()=>(await page.locator('#live-map').getAttribute('src')).includes('x=100'),'the map to move');
  const src=await page.locator('#live-map').getAttribute('src');assert(src.includes('z=-200')&&src.includes('worldname=world&'),src);
  assert.equal(await page.locator('#map-follow').textContent(),'Follow players');assert.match(await page.locator('#map-status').textContent(),/Showing Base/);
  await until(async()=>await scrollY(page)===0,'the map to come back into view');
  // The Nether is its own map.
  await page.locator('#places-list .place',{hasText:'Portal'}).click();
  await until(async()=>(await page.locator('#live-map').getAttribute('src')).includes('worldname=world_nether'),'the Nether map');assert((await page.locator('#live-map').getAttribute('src')).includes('mapname=flat'));
  assert.deepEqual(errors,[]);await context.close();
 }finally{await browser.close();await new Promise(r=>s.close(r));}
});
test('places: signed in they come first, ride on the grab bar, and the map follows my player',async()=>{
 const s=await server(),browser=await chromium.launch({args:['--no-sandbox']}),origin=`http://127.0.0.1:${s.address().port}`;
 try{
  const context=await browser.newContext({viewport:{width:1280,height:800}});await mock(context,{signed:true,online:players});const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(origin+'/mc/');await until(()=>page.locator('#places-bar-title').isVisible(),'the title on the grab bar');assert.equal(await page.locator('#places-bar-title').textContent(),'Named Locations.');
  assert.equal(await page.evaluate(()=>document.getElementById('places').nextElementSibling.id),'join-server');assert.equal(await page.locator('#join-peek').isVisible(),false);
  // A server without stars or last-seen still gets a working page, just without those extras.
  assert.equal(await page.locator('#places-list .star').count(),0);
  // The server would pick Alex (first alphabetically); a signed-in Carter gets his own player.
  await until(async()=>(await page.locator('#live-map').getAttribute('src')||'').includes('playername=Carter'),'the map to follow Carter');assert.match(await page.locator('#map-status').textContent(),/Following Carter/);
  // The bar is only the title: tapping it opens the list, not the join instructions. A location there takes the map up and over.
  assert(await barHeight(page)<=80,'a small title bar');await page.mouse.click(640,await barTop(page)+10);
  await until(async()=>{const b=await page.locator('#places').boundingBox();return b.y>=0&&b.y<=60;},'the list');
  await page.locator('#places-list .place',{hasText:'Base'}).click();await until(async()=>(await page.locator('#live-map').getAttribute('src')).includes('x=100'),'the map to move');assert.match(await page.locator('#map-status').textContent(),/Showing Base/);
  await until(async()=>await scrollY(page)===0,'the map to come back into view');
  // Following again goes back to my player.
  await toTop(page);await page.locator('#map-follow').click();await until(async()=>(await page.locator('#live-map').getAttribute('src')).includes('playername=Carter'),'the map to follow Carter again');
  assert.deepEqual(errors,[]);await context.close();
 }finally{await browser.close();await new Promise(r=>s.close(r));}
});
// Stars are per account and live on the server; they put a place first on the page and on the grab bar.
test('stars: starring puts a location first, in gold, and it is remembered',async()=>{
 const s=await server(),browser=await chromium.launch({args:['--no-sandbox']}),origin=`http://127.0.0.1:${s.address().port}`;
 try{
  const stars=new Set(),context=await browser.newContext({viewport:{width:1280,height:800}});await mock(context,{signed:true,online:players,stars});const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const names=()=>page.locator('#places-list .place-name').allTextContents();
  await page.goto(origin+'/mc/');await until(async()=>await page.locator('#places-list .star').count()===3,'the star buttons');
  assert.deepEqual(await names(),['Base','Portal','Spawn']);
  await page.getByRole('button',{name:'Star Spawn'}).click();
  await until(async()=>(await names())[0]==='Spawn','Spawn to move first');assert.deepEqual([...stars],['world:markers:_spawn_world']);
  assert.equal(await page.getByRole('button',{name:'Star Spawn'}).getAttribute('aria-pressed'),'true');
  // Gold when starred, a gray outline when not.
  const fill=name=>page.getByRole('button',{name}).locator('svg').evaluate(e=>getComputedStyle(e).fill);
  assert.equal(await fill('Star Spawn'),'rgb(255, 196, 0)');assert.equal(await fill('Star Base'),'none');
  assert.equal(await page.evaluate(()=>document.activeElement.dataset.pin),'world:markers:_spawn_world','focus stays on the star after it moves');
  await page.reload();await until(async()=>(await names())[0]==='Spawn','the star to be remembered');
  await page.getByRole('button',{name:'Star Spawn'}).click();await until(async()=>(await names())[0]==='Base','the star to come off');assert.equal(stars.size,0);
  assert.deepEqual(errors,[]);await context.close();
 }finally{await browser.close();await new Promise(r=>s.close(r));}
});
// The last spot is sampled while someone is online. Signed in and offline, the map shows it; online, the map follows them.
test('last seen: offline the map shows where I was, online it follows me, and it goes back after I leave',async()=>{
 const s=await server(),browser=await chromium.launch({args:['--no-sandbox']}),origin=`http://127.0.0.1:${s.address().port}`;
 try{
  const online=[players[0]],seen_at=new Date(Date.now()-2*3600000).toISOString();
  const context=await browser.newContext({viewport:{width:1280,height:800}});await mock(context,{signed:true,online,lastSeen:{world:'world',x:777,y:70,z:-333,seen_at}});const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const src=async()=>await page.locator('#live-map').getAttribute('src')||'';
  const poll=()=>page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));
  await page.goto(origin+'/mc/');await until(async()=>(await src()).includes('x=777'),'the map to show the last spot');
  assert(!(await src()).includes('playername'),'not following Alex');assert((await src()).includes('z=-333'));
  assert.match(await page.locator('#map-status').textContent(),/Carter last seen here · 2 hours ago/);
  online.push(players[1]);await poll();await until(async()=>(await src()).includes('playername=Carter'),'the map to follow Carter');assert.match(await page.locator('#map-status').textContent(),/Following Carter/);
  online.pop();await poll();await until(async()=>(await src()).includes('x=777'),'the map to go back to the last spot');
  assert.deepEqual(errors,[]);await context.close();
 }finally{await browser.close();await new Promise(r=>s.close(r));}
});
