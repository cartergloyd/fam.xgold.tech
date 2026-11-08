import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {chromium} from 'playwright';
// The /mc map fills the first screen. Left live it swallows the wheel, so the page could not be scrolled.
const root=new URL('../',import.meta.url).pathname;
async function server(){const s=createServer(async(req,res)=>{try{let p=new URL(req.url,'http://local').pathname;if(p.endsWith('/'))p+='index.html';const f=resolve(root,'.'+p);if(!f.startsWith(root))throw Error();const b=await readFile(f);res.setHeader('Content-Type',f.endsWith('.js')?'text/javascript':f.endsWith('.css')?'text/css':f.endsWith('.png')?'image/png':'text/html');res.end(b);}catch{res.writeHead(404);res.end();}});await new Promise(r=>s.listen(0,'127.0.0.1',r));return s;}
// The stub map is cross-origin like the real one. Like Leaflet it consumes the wheel (preventDefault), otherwise the event
// would chain up and scroll the page, and it counts the wheel events that reach it.
async function mock(context,{mapUp=true}={}){
 await context.route('https://fam-api.xgold.tech/**',route=>{
  const p=new URL(route.request().url()).pathname.replace('/family','');
  if(p==='/mc-status')return mapUp?route.fulfill({json:{online:true,players:[],focus:{mode:'spawn',world:'world',x:0,y:64,z:0}}}):route.fulfill({status:503,json:{online:false,error:'The live map is temporarily unavailable.'}});
  if(p.startsWith('/mc-map/'))return route.fulfill({contentType:'text/html',body:'<!doctype html><title>Map</title><body style="margin:0;background:#222"><script>window.wheels=0;addEventListener("wheel",e=>{e.preventDefault();window.wheels++},{passive:false})</script>'});
  if(p==='/users')return route.fulfill({json:{users:[]}});
  return route.fulfill({status:404,json:{error:'Not mocked'}});
 });
}
const wheelsInMap=page=>page.frame({url:/mc-map/}).evaluate(()=>window.wheels);
async function until(check,what){for(let i=0;i<50;i++){if(await check())return;await new Promise(r=>setTimeout(r,100));}assert.fail('Timed out waiting for '+what);}
test('the map scrolls the page until it is activated, then zooms and pans',async()=>{
 const s=await server(),browser=await chromium.launch({args:['--no-sandbox']}),origin=`http://127.0.0.1:${s.address().port}`;
 try{
  const context=await browser.newContext({viewport:{width:1280,height:800}});await mock(context);const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(origin+'/mc/');await page.locator('#map-explore').waitFor({state:'visible'});await until(()=>page.frame({url:/mc-map/}),'the map frame');
  const scrollY=()=>page.evaluate(()=>window.scrollY);
  // Inert by default: the wheel over the map scrolls the page and never reaches the map.
  await page.mouse.move(640,400);await page.mouse.wheel(0,500);await until(async()=>await scrollY()>0,'the page to scroll');assert.equal(await wheelsInMap(page),0);
  // A click on the map turns on zoom and pan: the wheel now goes to the map and the page stays put.
  await page.evaluate(()=>scrollTo(0,0));await until(async()=>await scrollY()===0,'the top of the page');
  await page.mouse.click(640,400);assert.equal(await page.locator('#map-explore').textContent(),'Done');assert.equal(await page.locator('#map-activate').isVisible(),false);
  await page.mouse.wheel(0,500);await until(async()=>await wheelsInMap(page)>0,'the map to get the wheel');await page.waitForTimeout(200);assert.equal(await scrollY(),0);
  // Done hands scrolling back to the page.
  await page.getByRole('button',{name:/^Done/}).click();assert.equal(await page.locator('#map-explore').textContent(),'Zoom and pan');
  await page.mouse.move(640,400);await page.mouse.wheel(0,500);await until(async()=>await scrollY()>0,'the page to scroll again');
  // Scrolling the map out of view, here with the Join link, also deactivates it.
  await page.evaluate(()=>scrollTo(0,0));await until(async()=>await scrollY()===0,'the top of the page');
  await page.mouse.click(640,400);assert.equal(await page.locator('#map-explore').textContent(),'Done');
  await page.getByRole('link',{name:'Join ↓'}).click();await until(()=>page.evaluate(()=>!document.querySelector('.map-wrap').hasAttribute('data-exploring')),'the map to deactivate');
  assert.equal(await page.locator('#map-explore').textContent(),'Zoom and pan');
  assert.deepEqual(errors,[]);await context.close();
  // A phone: a tap activates the map and nothing overflows.
  const phone=await browser.newContext({viewport:{width:375,height:700},hasTouch:true,isMobile:true});await mock(phone);const m=await phone.newPage();
  await m.goto(origin+'/mc/');await m.locator('#map-explore').waitFor({state:'visible'});await m.touchscreen.tap(190,300);assert.equal(await m.locator('#map-explore').textContent(),'Done');
  assert(await m.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));const caption=await m.locator('.map-caption').boundingBox();assert(caption.x>=0&&caption.x+caption.width<=375);await phone.close();
  // No map, no toggle: nothing to zoom or pan.
  const down=await browser.newContext({viewport:{width:1280,height:800}});await mock(down,{mapUp:false});const d=await down.newPage();
  await d.goto(origin+'/mc/');await d.getByText('The live map is temporarily unavailable.').waitFor();assert.equal(await d.locator('#map-explore').isVisible(),false);assert.equal(await d.locator('#map-activate').isVisible(),false);await down.close();
 }finally{await browser.close();await new Promise(r=>s.close(r));}
});
