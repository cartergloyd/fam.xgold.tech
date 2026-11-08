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
async function mock(context,{mapUp=true}={}){
 await context.route('https://fam-api.xgold.tech/**',route=>{
  const p=new URL(route.request().url()).pathname.replace('/family','');
  if(p==='/mc-status')return mapUp?route.fulfill({json:{online:true,players:[],focus:{mode:'spawn',world:'world',x:0,y:64,z:0}}}):route.fulfill({status:503,json:{online:false,error:'The live map is temporarily unavailable.'}});
  if(p.startsWith('/mc-map/'))return route.fulfill({contentType:'text/html',body:'<!doctype html><title>Map</title><style>html,body{margin:0;height:100%;background:#222;touch-action:none}</style><script>window.wheels=window.downs=window.drags=0;addEventListener("wheel",e=>{e.preventDefault();window.wheels++},{passive:false});addEventListener("pointerdown",()=>window.downs++);addEventListener("pointermove",e=>{if(e.buttons)window.drags++})</script>'});
  if(p==='/users')return route.fulfill({json:{users:[]}});
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
