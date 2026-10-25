import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
const dir=process.env.HUB_SOURCE || new URL('../deploy/family-hub/',import.meta.url).pathname;
const {issueSession,readSession}=await import(dir+'/hub-session.js');
const {default:endpoint,validDates}=await import(dir+'/endpoint.js');
const {default:whitelist,normalizeAccount}=await import(dir+'/whitelist.js');
const {chooseFocus}=await import(dir+'/minecraft.js');
const secret='test-secret-only';
test('whitelist account names reject commands and invalid editions',()=>{
 assert.equal(normalizeAccount('java',' TestUser '),'TestUser');assert.equal(normalizeAccount('bedrock','Player One'),'Player One');
 for(const [edition,name]of [['java','Name\nstop'],['bedrock','.Player'],['bedrock','A;op B'],['other','Test'],['java','x']])assert.equal(normalizeAccount(edition,name),null);
});
test('session expiry, signature forgery, invalid dates, and map focus',()=>{
 const user={id:'00000000-0000-4000-8000-000000000001',pin_hash:'hash'};
 const token=issueSession(user,secret,10);assert.equal(readSession(token,secret,11).id,user.id);
 assert.equal(readSession(token,secret,8*86400000),null);assert.equal(readSession(token+'x',secret,11),null);assert.equal(readSession(token,'wrong',11),null);
 assert.equal(readSession('payload.'+'é'.repeat(43),secret),null);
 assert(validDates('2027-01-01','2027-01-03'));for(const [a,b]of [['2027-02-30','2027-03-03'],['invalid','invalid'],['2027-13-01','2027-14-01'],['2027-01-02','2027-01-02']])assert.equal(validDates(a,b),false);
 assert.equal(chooseFocus([{account:'hidden',ishidden:true,x:1,z:2},{account:'z',x:2,z:3},{account:'a',x:3,z:4}]).account,'a');
 assert.equal(chooseFocus([],{source:'players',world:'world',x:2,z:4}).mode,'activity');assert.equal(chooseFocus([],{source:'chunks',x:2,z:3}).mode,'chunks');
});
test('real PostgreSQL: permissions, overlap races, adjacent stays, approvals, cancellation, cards and revisions', {skip:!process.env.HUB_TEST_DATABASE},async()=>{
 assert.match(process.env.HUB_TEST_DATABASE,/_test$/);
 const entries=await readdir('/directus/node_modules/.pnpm');const knexDir=entries.find(p=>p.startsWith('knex@'));
 const require=createRequire('/directus/node_modules/.pnpm/'+knexDir+'/node_modules/knex/package.json');const knex=require('knex');
 const db=knex({client:'pg',connection:{host:process.env.DB_HOST,user:process.env.DB_USER,password:process.env.DB_PASSWORD,database:process.env.HUB_TEST_DATABASE},pool:{min:0,max:6}});
 const users={};for(const [index,name]of ['Carter','Chester','Jaime','Member','Instant','Disabled'].entries()){
  const user={id:`00000000-0000-4000-8000-${String(index+1).padStart(12,'0')}`,name,status:name==='Disabled'?'disabled':'ready',pin_hash:'hash',condo_manager:['Carter','Chester'].includes(name),maintenance_manager:name==='Jaime',instant_booking:name==='Instant'};
  await db('family_users').insert(user);users[name]={...user,token:issueSession(user,secret)};
 }
 const handlers={};const router={};for(const method of ['get','post','patch','delete'])router[method]=(path,fn)=>handlers[method.toUpperCase()+' '+path]=fn;
 endpoint(router,{database:db},{secret});whitelist(router,{database:db},{secret});
 async function call(method,path,user='Member',body={},params={},origin='https://fam.xgold.tech'){
  const result={status:200};const res={set(){return res;},status(n){result.status=n;return res;},json(data){result.data=data;return res;}};
  await handlers[method+' '+path]({method,params,body,get:k=>k==='Origin'?origin:k==='X-Family-Session'?(users[user]?users[user].token:'forged'):null},res);return result;
 }
 const stay=(start='2027-01-01',end='2027-01-04')=>({start_date:start,end_date:end,guests:2,note:'Test'});
 try{
  assert.equal((await call('GET','/hub/me','forged')).status,401);
  assert.equal((await call('GET','/hub/me','Disabled')).status,401);
  assert.equal((await call('POST','/hub/reservations','Member',stay(),{},'https://evil.example')).status,403);
  assert.equal((await call('POST','/hub/reservations','Member',{...stay(),status:'blocked'})).status,403);
  const race=await Promise.all([call('POST','/hub/reservations','Member',stay()),call('POST','/hub/reservations','Instant',stay())]);assert.deepEqual(race.map(x=>x.status).sort(),[201,409]);
  const first=race.find(x=>x.status===201).data.reservation;
  assert.equal(first.status,first.user_id===users.Member.id?'pending':'confirmed');
  const adjacent=await call('POST','/hub/reservations','Member',stay('2027-01-04','2027-01-06'));assert.equal(adjacent.status,201);assert.equal(adjacent.data.reservation.status,'pending');
  const id=adjacent.data.reservation.id;
  assert.equal((await call('PATCH','/hub/reservations/:id','Member',{status:'confirmed',revision:1},{id})).status,403);
  assert.equal((await call('PATCH','/hub/reservations/:id','Chester',{status:'confirmed',revision:1},{id})).status,200);
  assert.equal((await call('PATCH','/hub/reservations/:id','Carter',{status:'cancelled',revision:1},{id})).status,409);
  assert.equal((await call('PATCH','/hub/reservations/:id','Instant',{status:'cancelled',revision:2},{id})).status,403);
  assert.equal((await call('PATCH','/hub/reservations/:id','Member',{status:'cancelled',revision:2},{id})).status,200);
  const instant=await call('POST','/hub/reservations','Instant',stay('2027-01-04','2027-01-06'));assert.equal(instant.status,201);assert.equal(instant.data.reservation.status,'confirmed');
  const blocked=await call('POST','/hub/reservations','Carter',{...stay('2027-03-01','2027-03-03'),status:'blocked'});assert.equal(blocked.status,201);
  assert.equal((await call('POST','/hub/reservations','Instant',stay('2027-03-02','2027-03-04'))).status,409);
  const before=await call('GET','/hub/condo','Member');assert.equal(before.data.user.condo_manager,false);assert(!JSON.stringify(before.data).includes('pin_hash'));
  assert.equal((await call('GET','/hub/booking-access','Member')).status,403);
  assert.equal((await call('PATCH','/hub/booking-access/:id','Chester',{instant_booking:true},{id:users.Member.id})).status,200);
  assert.equal((await call('POST','/hub/reservations','Member',stay('2027-04-01','2027-04-03'))).data.reservation.status,'confirmed');
  const property={...before.data.property,check_in:'16:00',check_out:'10:00',max_guests:4,max_nights:7,advance_days:0};
  assert.equal((await call('PATCH','/hub/property','Jaime',property)).status,403);
  assert.equal((await call('PATCH','/hub/property','Carter',property)).status,200);
  assert.equal((await call('PATCH','/hub/property','Chester',property)).status,409);
  assert.equal((await call('POST','/hub/reservations','Member',{...stay('2027-05-01','2027-05-04'),guests:5})).status,400);
  assert.equal((await call('POST','/hub/reservations','Member',stay('2027-05-01','2027-05-10'))).status,400);
  assert.equal((await call('POST','/hub/reservations','Member',stay('2027-02-30','2027-03-04'))).status,400);
  const card={kind:'maintenance',title:'Fix door',description:'Test',status:'todo'};
  const task=(await call('POST','/hub/tasks','Member',card)).data.task;assert.equal(task.assigned_to,users.Jaime.id);
  assert.equal((await call('PATCH','/hub/tasks/:id','Member',{...card,revision:1,status:'done'},{id:task.id})).status,403);
  assert.equal((await call('PATCH','/hub/tasks/:id','Jaime',{...card,revision:1,status:'doing'},{id:task.id})).status,200);
  assert.equal((await call('PATCH','/hub/tasks/:id','Jaime',{...card,revision:1,status:'done'},{id:task.id})).status,409);
  const build=(await call('POST','/hub/tasks','Member',{...card,kind:'build',x:1,y:64,z:2})).data.task;
  assert.equal((await call('PATCH','/hub/tasks/:id','Instant',{...build,status:'doing'},{id:build.id})).status,200);
  assert.equal((await call('POST','/hub/tasks','Member',{...card,kind:'build',x:1})).status,400);
  assert.equal((await call('DELETE','/hub/tasks/:id','Member',{revision:2},{id:build.id})).status,200);
  assert.equal((await call('GET','/hub/mc-whitelist','forged')).status,401);
  assert.equal((await call('POST','/hub/mc-whitelist','Member',{edition:'java',username:'TestUser'},{},'https://evil.example')).status,403);
  assert.equal((await call('POST','/hub/mc-whitelist','Member',{edition:'java',username:'Bad\nstop'})).status,400);
  const account={edition:'java',username:'TestUser',user_id:users.Carter.id};
  assert.equal((await call('POST','/hub/mc-whitelist','Member',account)).status,202);
  assert.equal((await call('POST','/hub/mc-whitelist','Member',account)).status,200);
  assert.equal((await call('POST','/hub/mc-whitelist','Member',{edition:'java',username:'OtherUser'})).status,409);
  assert.equal((await call('POST','/hub/mc-whitelist','Member',{edition:'bedrock',username:'Player One'})).status,202);
  const own=(await call('GET','/hub/mc-whitelist','Member')).data.accounts;assert.equal(own.length,2);assert.equal(own[0].status,'pending');
  assert.equal((await call('GET','/hub/mc-whitelist','Carter')).data.accounts.length,0);
  assert.equal((await db('family_mc_whitelist').where({user_id:users.Member.id})).length,2);
  await db('family_mc_whitelist').where({user_id:users.Member.id}).update({status:'failed'});
  for(let i=0;i<4;i++)await db('family_mc_whitelist').insert({user_id:users.Member.id,edition:'java',username:'TestUser',status:'failed'});
  assert.equal((await call('POST','/hub/mc-whitelist','Member',account)).status,429);
  await db('family_users').where({id:users.Member.id}).update({pin_hash:'changed'});assert.equal((await call('GET','/hub/me','Member')).status,401);
 } finally{await db.destroy();}
});
