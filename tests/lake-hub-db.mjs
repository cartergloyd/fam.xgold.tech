import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readdir} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
// Real-PostgreSQL run for the lake schedule, guest links, manager edits and the calendar feed. Same setup as the integration
// test in family-hub-api.mjs: HUB_TEST_DATABASE, HUB_SOURCE, the Directus container's knex and DB_* environment.
// The database must already hold the schema (schema.sql, lake-schema.sql, booking-schema.sql), the 6108 property row, users named
// Chester and Carter, and the rows from `python3 load-lake.py` applied once.
// Everything runs inside ONE transaction that is always rolled back (routes open savepoints inside it), so it is safe to point at the
// live database: nothing it creates, edits or locks survives, and no email or calendar request leaves the process.
const dir=process.env.HUB_SOURCE||new URL('../deploy/family-hub/',import.meta.url).pathname;
const {issueSession}=await import(dir+'/hub-session.js');
const {default:endpoint}=await import(dir+'/endpoint.js');
const {default:lake}=await import(dir+'/lake.js');
const {default:calendar}=await import(dir+'/calendar.js');
const secret='test-secret-only';
test('real PostgreSQL: loaded schedule, lake routes, guest links, manager edits, calendar feed',{skip:!process.env.HUB_TEST_DATABASE},async()=>{
 const entries=await readdir('/directus/node_modules/.pnpm');const knexDir=entries.find(p=>p.startsWith('knex@'));
 const require=createRequire('/directus/node_modules/.pnpm/'+knexDir+'/node_modules/knex/package.json');const knex=require('knex');
 const pool=knex({client:'pg',connection:{host:process.env.DB_HOST,user:process.env.DB_USER,password:process.env.DB_PASSWORD,database:process.env.HUB_TEST_DATABASE},pool:{min:0,max:2}});
 const db=await pool.transaction();
 try{
  // Chester has not registered yet on the live server; in this transaction he has, so his session can be issued.
  await db('family_users').where({name:'Chester'}).update({status:'ready',pin_hash:'a'.repeat(64)});
  for(const [i,name] of ['Member','Outsider'].entries())await db('family_users').insert({id:`00000000-0000-4000-8000-0000000000${30+i}`,name,status:'ready',pin_hash:'a'.repeat(64)}).onConflict('id').ignore();
  const users={};for(const name of ['Chester','Carter','Member','Outsider']){const u=await db('family_users').where({name}).first();assert(u,name+' exists');users[name]={...u,token:issueSession(u,secret)};}
  assert(users.Chester.lake_owner&&users.Chester.lake_schedule&&users.Carter.lake_schedule&&!users.Carter.lake_owner,'lake-schema.sql applied');
  // ---- the loaded CSV data ----
  const n=async(table,where={})=>Number((await db(table).where(where).count('* as n').first()).n);
  assert.deepEqual([await n('family_lake_days',{user_id:users.Chester.id}),await n('family_lake_weekends',{user_id:users.Chester.id}),await n('family_lake_away',{user_id:users.Chester.id}),await n('family_lake_invites',{user_id:users.Chester.id}),await n('family_reservations',{property_id:'6108',status:'confirmed'})],[91,35,2,19,13]);
  const events=[],handlers={},router={};for(const method of ['get','post','put','patch','delete'])router[method]=(path,fn)=>handlers[method.toUpperCase()+' '+path]=fn;
  const feed={text:''};
  endpoint(router,{database:db},{secret,notify:(event,row,token)=>events.push([event,row.status,token?'token':''])});
  lake(router,{database:db},{secret,timers:false,fetchText:async()=>feed.text});calendar(router,{database:db},{secret});
  async function call(method,path,user='Member',body={},{params={},query={},origin='https://fam.xgold.tech'}={}){
   const result={status:200};const res={set(){return res;},status(c){result.status=c;return res;},json(d){result.data=d;return res;},type(t){result.type=t;return res;},send(s){result.text=s;return res;}};
   await handlers[method+' '+path]({method,params,query,body,ip:'1.2.3.4',get:k=>k==='Origin'?origin:k==='X-Family-Session'?(users[user]?users[user].token:'forged'):null},res);return result;
  }
  // ---- lake routes ----
  assert.equal((await call('GET','/hub/lake','Member')).status,403);
  const lakeNow=(await call('GET','/hub/lake','Carter')).data;
  assert.deepEqual([lakeNow.owner,lakeNow.days.length,lakeNow.weekends.length,lakeNow.away.length,lakeNow.invites.length,lakeNow.calendar.linked],['Chester',91,35,2,19,false]);
  assert(lakeNow.days.every(d=>/^\d{4}-\d{2}-\d{2}$/.test(d.day)),'dates are plain strings');
  const memorial=lakeNow.weekends.find(w=>w.friday==='2026-05-22');assert.deepEqual([memorial.title,memorial.notes_9112,memorial.revision],['Memorial Day weekend','Family',1]);
  const saved=await call('PUT','/hub/lake/weekends/:friday','Carter',{title:'Memorial Day weekend',notes:memorial.notes,notes_9112:'Family',queen:['Rick','Cheryl'],bunks:['Kids']},{params:{friday:'2026-05-22'}});
  assert.deepEqual([saved.data.weekend.queen,saved.data.weekend.bunks,saved.data.weekend.revision],[['Rick','Cheryl'],['Kids'],2]);
  assert.equal((await call('PUT','/hub/lake/weekends/:friday','Carter',{},{params:{friday:'2026-05-23'}})).status,400);
  assert.equal((await call('PUT','/hub/lake/days/:day','Chester',{presence:'no'},{params:{day:'2026-04-09'}})).status,200);
  assert.equal((await db('family_lake_days').where({user_id:users.Chester.id,day:'2026-04-09'}).first()).presence,'no');
  assert.equal((await call('PUT','/hub/lake/days/:day','Chester',{presence:null},{params:{day:'2026-04-09'}})).status,200);
  assert.equal(await n('family_lake_days',{user_id:users.Chester.id}),90);
  const invite=(await call('POST','/hub/lake/invites','Carter',{name:'New Guest',note:'hi'})).data.invite;
  assert.equal((await db('family_lake_invites').where({id:invite.id}).first()).position,19);
  assert.deepEqual((await call('PATCH','/hub/lake/invites/:id','Chester',{weekends:['2026-06-05']},{params:{id:invite.id}})).data.invite.weekends,['2026-06-05']);
  assert.equal((await call('DELETE','/hub/lake/invites/:id','Chester',{},{params:{id:invite.id}})).status,200);
  const away=(await call('POST','/hub/lake/away','Carter',{start_date:'2099-02-01',end_date:'2099-02-03',reason:'typed'})).data.away;assert.equal(away.source,'manual');
  feed.text='BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nSUMMARY:Flight to Denver\r\nDTSTART;VALUE=DATE:20990310\r\nDTEND;VALUE=DATE:20990313\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n';
  assert.equal((await call('PUT','/hub/lake/calendar','Chester',{url:'https://calendar.example.com/c.ics'})).data.count,1);
  assert.deepEqual((await db('family_lake_away').where({user_id:users.Chester.id,source:'calendar'})).map(r=>[r.reason]),[['Flight to Denver']]);
  assert.equal((await db('family_lake_calendar').where({user_id:users.Chester.id}).first()).url,'https://calendar.example.com/c.ics');
  assert.equal((await call('GET','/hub/lake','Carter')).data.calendar.linked,true);
  await call('DELETE','/hub/lake/calendar','Chester');assert.equal(await n('family_lake_away',{user_id:users.Chester.id,source:'calendar'}),0);
  assert.equal((await call('DELETE','/hub/lake/away/:id','Carter',{},{params:{id:away.id}})).status,200);
  // ---- visitor requests, private links, and what each role may see ----
  const stay=(a,b,extra={})=>({start_date:a,end_date:b,suites:{master:['Pat Visitor'],disney:[]},title:'Pat',...extra});
  assert.equal((await call('POST','/hub/reservations','forged',stay('2027-06-04','2027-06-07',{email:'not-an-email'}))).status,400);
  const made=await call('POST','/hub/reservations','forged',stay('2027-06-04','2027-06-07',{email:'pat@example.com'}));
  assert.equal(made.status,201);const token=made.data.manage_token;assert(token&&token.length>=30);
  assert(!('manage_token_hash' in made.data.reservation)&&!('guest_email' in made.data.reservation));
  const row=await db('family_reservations').where({id:made.data.reservation.id}).first();
  assert.deepEqual([row.manage_token_hash,row.guest_email,row.status,row.title,row.user_id],[createHash('sha256').update(token).digest('hex'),'pat@example.com','pending','Pat',null]);
  assert.deepEqual(events.at(-1),['requested','pending','token']);
  assert.equal((await call('POST','/hub/reservations','Member',stay('2027-07-01','2027-07-03'))).data.manage_token,undefined,'members use their account, not a link');
  const open=(await call('GET','/hub/availability','forged')).data;assert.equal(open.guest_links,true);assert(!JSON.stringify(open).includes('Pat'));
  const member=(await call('GET','/hub/condo','Member')).data,manager=(await call('GET','/hub/condo','Chester')).data;
  assert(!JSON.stringify(member).includes('manage_token_hash')&&!JSON.stringify(member).includes('pat@example.com'));
  assert(manager.reservations.some(r=>r.guest_email==='pat@example.com')&&!JSON.stringify(manager).includes('manage_token_hash'));
  assert.deepEqual(manager.user.calendar_feed,true);
  const mine=(k=token)=>({query:{k}});
  assert.equal((await call('GET','/hub/stay','forged',{},mine('wrong'))).status,404);assert.equal((await call('GET','/hub/stay','forged',{},{query:{}})).status,404);
  const got=(await call('GET','/hub/stay','forged',{},mine())).data;assert.deepEqual([got.stay.start_date,got.stay.end_date,got.stay.status,got.stay.guest_name,got.property.timezone],['2027-06-04','2027-06-07','pending','Pat Visitor','America/Chicago']);
  assert(!('manage_token_hash' in got.stay)&&!('guest_email' in got.stay)&&!('id' in got.stay));
  // reschedule: conflicts, stale revisions, back to pending after approval
  await call('POST','/hub/reservations','Chester',stay('2027-06-10','2027-06-12',{title:'Held'}));
  assert.equal((await call('POST','/hub/stay/reschedule','forged',{start_date:'2027-06-11',end_date:'2027-06-14',revision:1},mine())).status,409,'overlaps a held stay');
  assert.equal((await call('POST','/hub/stay/reschedule','forged',{start_date:'2027-06-20',end_date:'2027-06-22',revision:9},mine())).status,409,'stale revision');
  assert.equal((await call('POST','/hub/stay/reschedule','forged',{start_date:'2027-06-22',end_date:'2027-06-20',revision:1},mine())).status,400);
  assert.equal((await call('PATCH','/hub/reservations/:id','Chester',{status:'confirmed',revision:1},{params:{id:row.id}})).status,200);
  assert.equal(events.at(-1)[0],'confirmed');
  const moved=await call('POST','/hub/stay/reschedule','forged',{start_date:'2027-06-20',end_date:'2027-06-22',revision:2},mine());
  assert.deepEqual([moved.status,moved.data.stay.status,moved.data.stay.revision,moved.data.stay.start_date],[200,'pending',3,'2027-06-20']);assert.equal(events.at(-1)[0],'guest-rescheduled');
  assert.equal((await call('POST','/hub/stay/cancel','forged',{revision:2},mine())).status,409,'stale revision');
  assert.equal((await call('POST','/hub/stay/cancel','forged',{revision:3},mine())).data.stay.status,'cancelled');assert.equal(events.at(-1)[0],'guest-cancelled');
  assert.equal((await call('POST','/hub/stay/cancel','forged',{revision:4},mine())).status,409,'already closed');
  assert.equal((await call('POST','/hub/stay/cancel','forged',{revision:1},mine('nope'))).status,404);
  assert.equal((await call('POST','/hub/stay/cancel','forged',{revision:1},{...mine(),origin:'https://evil.example'})).status,403);
  // a stay that has started cannot be changed by link; a manager can still edit its title
  const started=await db('family_reservations').insert({property_id:'6108',user_id:null,guest_name:'Walker',start_date:db.raw("current_date - 3"),end_date:db.raw("current_date + 4"),guests:1,status:'confirmed',manage_token_hash:createHash('sha256').update('started-token').digest('hex')}).returning('*');
  assert.equal((await call('POST','/hub/stay/cancel','forged',{revision:1},mine('started-token'))).status,403);
  assert.equal((await call('POST','/hub/stay/reschedule','forged',{start_date:'2028-01-01',end_date:'2028-01-03',revision:1},mine('started-token'))).status,403);
  // manager edits
  const edit=(r,extra)=>({revision:r.revision,start_date:String(r.start_date.toISOString?r.start_date.toISOString().slice(0,10):r.start_date).slice(0,10),end_date:String(r.end_date.toISOString?r.end_date.toISOString().slice(0,10):r.end_date).slice(0,10),title:'Renamed',suites:{master:['Walker'],disney:['Friend']},note:'edited',...extra});
  assert.equal((await call('PATCH','/hub/reservations/:id','Member',edit(started[0]),{params:{id:started[0].id}})).status,403,'only managers edit');
  const renamed=await call('PATCH','/hub/reservations/:id','Carter',edit(started[0]),{params:{id:started[0].id}});
  assert.deepEqual([renamed.status,renamed.data.reservation.title,renamed.data.reservation.guests,renamed.data.reservation.revision],[200,'Renamed',2,2],'a title change on a stay under way skips the notice rule');assert.equal(events.at(-1)[0],'changed');
  assert.equal((await call('PATCH','/hub/reservations/:id','Carter',edit(started[0]),{params:{id:started[0].id}})).status,409,'stale revision');
  assert.equal((await call('PATCH','/hub/reservations/:id','Carter',edit({...renamed.data.reservation},{start_date:'2027-06-10',end_date:'2027-06-12'}),{params:{id:started[0].id}})).status,409,'moving onto a held stay');
  assert.equal((await call('PATCH','/hub/reservations/:id','Carter',edit({...renamed.data.reservation},{title:'x'.repeat(81)}),{params:{id:started[0].id}})).status,400);
  assert.equal((await call('POST','/hub/reservations','Chester',{...stay('2027-08-01','2027-08-03'),title:'x'.repeat(81)})).status,400);
  // ---- the subscribe feed ----
  assert.equal((await call('GET','/hub/calendar-link','forged')).status,401);
  const link=(await call('GET','/hub/calendar-link','Member')).data.token;
  const ics=await call('GET','/hub/calendar.ics','forged',{},{query:{k:link}});
  assert.equal(ics.status,200);assert(ics.type.startsWith('text/calendar'));
  assert(ics.text.startsWith('BEGIN:VCALENDAR')&&ics.text.includes('SUMMARY:6108 · Quello/Talir')&&ics.text.includes('SUMMARY:6108 · Held'));
  assert(!ics.text.includes('Away'),'members do not see the lake owner\'s away days');
  const chesterFeed=(await call('GET','/hub/calendar.ics','forged',{},{query:{k:(await call('GET','/hub/calendar-link','Chester')).data.token}})).text;
  assert(chesterFeed.includes('SUMMARY:Away: Carter has 6108'),'lake users also get the away ranges');
  assert.equal((await call('GET','/hub/calendar.ics','forged',{},{query:{k:link+'x'}})).status,401);
  await db('family_users').where({id:users.Member.id}).update({pin_hash:'b'.repeat(64)});
  assert.equal((await call('GET','/hub/calendar.ics','forged',{},{query:{k:link}})).status,401,'a new PIN revokes the link');
 }finally{await db.rollback().catch(()=>{});await pool.destroy();}
});
