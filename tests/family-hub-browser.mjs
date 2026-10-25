import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {resolve,sep} from 'node:path';
import {chromium} from 'playwright';
const root=new URL('../',import.meta.url).pathname;
async function server(){const s=createServer(async(req,res)=>{try{let p=new URL(req.url,'http://local').pathname;if(p.endsWith('/'))p+='index.html';const f=resolve(root,'.'+p);if(!f.startsWith(root))throw Error();const b=await readFile(f);res.setHeader('Content-Type',f.endsWith('.js')?'text/javascript':f.endsWith('.css')?'text/css':f.endsWith('.png')?'image/png':'text/html');res.end(b);}catch{res.writeHead(404);res.end();}});await new Promise(r=>s.listen(0,'127.0.0.1',r));return s;}
const property={id:'6108',title:'6108',description:'Our place by the water.',house_rules:'Leave it ready for family.',check_in:'16:00:00',check_out:'10:00:00',max_guests:8,max_nights:14,advance_days:0,timezone:'America/Chicago',revision:1};
const users=[{id:'carter',name:'Carter',registered:true},{id:'member',name:'Member',registered:true}];
async function mock(context,name='Carter',signed=true){
 const user={id:name==='Carter'?'carter':'member',name,condo_manager:name==='Carter',maintenance_manager:false,instant_booking:name==='Carter'};let reservations=[],tasks=[],writes=[];
 await context.addInitScript(({name,signed})=>{localStorage.setItem('destin-who',JSON.stringify({name,email:'test@example.com'}));if(signed)localStorage.setItem('family-session',JSON.stringify({name,token:'test-token'}));},{name,signed});
 await context.route('https://fam-api.xgold.tech/**',async route=>{
  const req=route.request(),url=new URL(req.url()),p=url.pathname.replace('/family',''),body=req.postDataJSON?.()||{};let data={},status=200;
  if(p==='/users')data={users};
  else if(p==='/hub/condo')data={user,property,reservations,tasks:tasks.filter(t=>t.kind==='maintenance')};
  else if(p==='/hub/builds')data={user,tasks:tasks.filter(t=>t.kind==='build')};
  else if(p==='/hub/booking-access')data={users:users.map(u=>({...u,instant_booking:u.name==='Carter',condo_manager:u.name==='Carter'}))};
  else if(p==='/hub/reservations'&&req.method()==='POST'){writes.push(body);const r={...body,id:'reservation',user_id:user.id,name,revision:1,status:body.status==='blocked'?'blocked':user.instant_booking?'confirmed':'pending'};reservations.push(r);data={reservation:r};status=201;}
  else if(p.startsWith('/hub/reservations/')&&req.method()==='PATCH'){writes.push(body);Object.assign(reservations.find(r=>r.id===p.split('/').at(-1)),body);data={saved:true};}
  else if(p==='/hub/tasks'&&req.method()==='POST'){writes.push(body);const task={...body,id:'task'+tasks.length,user_id:user.id,name,revision:1};tasks.push(task);data={task};status=201;}
  else if(p.startsWith('/hub/tasks/')&&req.method()==='PATCH'){writes.push(body);const task=tasks.find(t=>t.id===p.split('/').at(-1));Object.assign(task,body,{revision:task.revision+1});data={task};}
  else if(p==='/hub/property'){writes.push(body);Object.assign(property,body,{revision:body.revision+1});data={property};}
  else if(p==='/mc-status')data={online:true,players:[{account:'PlayerOne',name:'PlayerOne',x:1,y:64,z:2,world:'world'}],focus:{mode:'player',account:'PlayerOne',name:'PlayerOne',x:1,y:64,z:2,world:'world'}};
  else if(p.startsWith('/mc-map/'))return route.fulfill({status:200,contentType:'text/html',body:'<!doctype html><title>Map</title><body>Map</body>'});
  else if(p.startsWith('/hub/booking-access/'))writes.push(body);
  else {status=404;data={error:'Unexpected test request '+p};}
  await route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)});
 });return {writes,reservations,tasks};
}
test('booking, approval access, maintenance, mobile layout and Minecraft board',async()=>{
 const s=await server(),browser=await chromium.launch({args:['--no-sandbox']});const origin=`http://127.0.0.1:${s.address().port}`;
 try{
  for(const width of [390,1440]){
   const context=await browser.newContext({viewport:{width,height:1000},reducedMotion:'reduce'});const data=await mock(context);const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
   await page.goto(origin+'/6108/');await page.locator('#signed-content').waitFor({state:'visible'});
   assert.equal(await page.locator('#book-submit').textContent(),'Book stay');
   await page.locator('input[name=start_date]').fill('2027-01-01');await page.locator('input[name=end_date]').fill('2027-01-04');await page.locator('#book-submit').click();await page.getByText('Your stay is confirmed.').waitFor();assert.equal(data.writes[0].guests,1);
   await page.getByRole('button',{name:'Cancel stay',exact:true}).click();await page.getByText('Reservation cancelled. Dates are available again.').waitFor();
   await page.getByRole('button',{name:'Manage',exact:true}).click();assert.equal(await page.locator('#property-form input[name=check_in]').inputValue(),'16:00');
   await page.locator('#property-form input[name=title]').fill('6108');await page.getByRole('button',{name:'Save property',exact:true}).click();await page.getByText('Property details saved.').waitFor();
   await page.getByRole('button',{name:'Maintenance',exact:true}).click();await page.getByRole('button',{name:'Report an issue',exact:true}).click();await page.locator('#task-form input[name=title]').fill('Check the sink');await page.getByRole('button',{name:'Save card',exact:true}).click();await page.getByRole('heading',{name:'Check the sink'}).waitFor();
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   if(width===1440){await page.getByRole('button',{name:'Reservations',exact:true}).click();await page.screenshot({path:'/tmp/fam-6108-desktop.png',fullPage:true});}
   await page.goto(origin+'/mc/');await page.locator('#signed-content').waitFor({state:'visible'});await page.getByRole('button',{name:'Follow players',exact:true}).click();assert.match(await page.locator('#live-map').getAttribute('src'),/playername=PlayerOne/);
   await page.getByRole('button',{name:'Pause following',exact:true}).click();assert.doesNotMatch(await page.locator('#live-map').getAttribute('src'),/playername=/);
   await page.getByRole('button',{name:'Add a build',exact:true}).click();await page.locator('#task-form input[name=title]').fill('The Grand Library');for(const [k,v]of [['x','123'],['y','64'],['z','-456']])await page.locator(`#task-form input[name=${k}]`).fill(v);
   await page.getByRole('button',{name:'Save card',exact:true}).click();await page.getByRole('heading',{name:'The Grand Library'}).waitFor();assert.match(await page.getByRole('link',{name:/Overworld/}).getAttribute('href'),/z=-456/);
   await page.getByRole('button',{name:'Start',exact:true}).click();await page.getByRole('heading',{name:'In progress · 1'}).waitFor();
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.deepEqual(errors,[]);
   if(width===390)await page.screenshot({path:'/tmp/fam-mc-mobile.png',fullPage:true});await context.close();
  }
  const context=await browser.newContext();await mock(context,'Member');const page=await context.newPage();await page.goto(origin+'/6108/');await page.locator('#signed-content').waitFor({state:'visible'});assert.equal(await page.locator('#manage-tab').isVisible(),false);assert.equal(await page.locator('#book-submit').textContent(),'Request stay');await context.close();
  const guest=await browser.newContext();await mock(guest,'Member',false);const p=await guest.newPage();await p.goto(origin+'/6108/');await p.locator('#auth-panel').waitFor({state:'visible'});assert.equal(await p.locator('#signed-content').isVisible(),false);await guest.close();
 }finally{await browser.close();await new Promise(r=>s.close(r));}
});
