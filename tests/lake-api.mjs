import {test} from 'node:test';
import assert from 'node:assert/strict';
import {issueSession} from '../deploy/family-hub/hub-session.js';
import lake from '../deploy/family-hub/lake.js';
import {roles} from '../deploy/family-hub/endpoint.js';
import {fakeDatabase} from './fake-database.mjs';
const secret='test-secret-only',uuid=n=>`00000000-0000-4000-9000-${String(n).padStart(12,'0')}`;
function setup({owner=true}={}){
 const users=[
  {id:uuid(1),name:'Chester',status:'ready',pin_hash:'h1',lake_schedule:true,lake_owner:owner},
  {id:uuid(2),name:'Carter',status:'ready',pin_hash:'h2',lake_schedule:true,lake_owner:false},
  {id:uuid(3),name:'Member',status:'ready',pin_hash:'h3',lake_schedule:false,lake_owner:false},
 ];
 const tables={family_users:users,family_properties:[{id:'6108',timezone:'America/Chicago'}],family_lake_days:[],family_lake_away:[],family_lake_weekends:[],family_lake_invites:[],family_lake_calendar:[]};
 const feed={text:''};
 const handlers={},router={};for(const m of ['get','put','post','patch','delete'])router[m]=(path,fn)=>handlers[m.toUpperCase()+' '+path]=fn;
 lake(router,{database:fakeDatabase(tables)},{secret,timers:false,fetchText:async()=>{if(feed.fail)throw Error(feed.fail);return feed.text;}});
 const tokens=Object.fromEntries(users.map(u=>[u.name,issueSession(u,secret)]));
 async function call(method,path,who='Carter',body={},origin='https://fam.xgold.tech'){
  const params={},pattern=Object.keys(handlers).find(k=>{const [m,p]=k.split(' ');if(m!==method)return false;const names=[];const re=new RegExp('^'+p.replace(/:(\w+)/g,(_,n)=>{names.push(n);return '([^/]+)';})+'$');const hit=re.exec(path);if(!hit)return false;names.forEach((n,i)=>params[n]=hit[i+1]);return true;});
  const result={status:200};const res={set(){return res;},status(n){result.status=n;return res;},json(data){result.data=data;return res;}};
  await handlers[pattern]({method,params,body,get:k=>k==='Origin'?origin:k==='X-Family-Session'?(tokens[who]||'forged'):null},res);return result;
 }
 return {tables,call,users,feed};
}
test('the user object tells the page who has the lake schedule',()=>{
 assert.equal(roles({id:'x',name:'Carter',lake_schedule:true}).lake_schedule,true);
 assert.equal(roles({id:'x',name:'Member'}).lake_schedule,false);
 assert.equal(roles({id:'x',name:'Member'}).calendar_feed,true,'the page shows Subscribe only when the server can serve the feed');
});
test('access: sign-in, lake flag, origin, and an owner must exist',async()=>{
 const {call}=setup();
 assert.equal((await call('GET','/hub/lake','forged')).status,401);
 assert.equal((await call('GET','/hub/lake','Member')).status,403);
 assert.equal((await call('PUT','/hub/lake/days/2026-07-04','Carter',{presence:'yes'},'https://evil.example')).status,403);
 assert.equal((await call('GET','/hub/lake','Carter')).status,200);
 assert.equal((await call('GET','/hub/lake','Chester')).status,200);
 const none=setup({owner:false});assert.equal((await none.call('GET','/hub/lake','Carter')).status,503);
});
test('Carter and Chester share one schedule, stored under the owner',async()=>{
 const {call,tables,users}=setup();
 const empty=(await call('GET','/hub/lake','Carter')).data;
 assert.deepEqual(empty,{owner:'Chester',days:[],weekends:[],away:[],invites:[],calendar:{linked:false}});
 assert.equal((await call('PUT','/hub/lake/days/2026-07-04','Carter',{presence:'yes'})).status,200);
 assert.deepEqual((await call('GET','/hub/lake','Chester')).data.days,[{day:'2026-07-04',presence:'yes'}]);
 assert(tables.family_lake_days.every(d=>d.user_id===users[0].id),'rows belong to the owner, not the editor');
});
test('days: mark, change, clear, reject bad input',async()=>{
 const {call,tables}=setup();
 await call('PUT','/hub/lake/days/2026-07-04','Carter',{presence:'yes'});
 await call('PUT','/hub/lake/days/2026-07-04','Carter',{presence:'no'});
 assert.deepEqual((await call('GET','/hub/lake')).data.days,[{day:'2026-07-04',presence:'no'}]);
 assert.equal(tables.family_lake_days.length,1,'marking a day twice keeps one row');
 await call('PUT','/hub/lake/days/2026-07-04','Carter',{presence:null});
 assert.deepEqual((await call('GET','/hub/lake')).data.days,[]);
 for(const [day,body] of [['2026-02-30',{presence:'yes'}],['not-a-day',{presence:'yes'}],['2026-07-04',{presence:'maybe'}],['2026-07-04',{}],['1999-01-01',{presence:'yes'}]])assert.equal((await call('PUT','/hub/lake/days/'+day,'Carter',body)).status,400,day+JSON.stringify(body));
});
test('weekends: keyed by Friday, revision counts saves, names are checked',async()=>{
 const {call}=setup();
 const body={title:'Memorial Day',notes:'GPMO',notes_9112:'Family',queen:['Rick','Cheryl'],bunks:[]};
 const first=await call('PUT','/hub/lake/weekends/2026-05-22','Carter',body);
 assert.equal(first.status,200);assert.deepEqual(first.data.weekend,{friday:'2026-05-22',...body,revision:1});
 assert.equal((await call('PUT','/hub/lake/weekends/2026-05-22','Chester',{...body,title:'Memorial Day weekend'})).data.weekend.revision,2);
 assert.equal((await call('GET','/hub/lake')).data.weekends.length,1);
 assert.equal((await call('PUT','/hub/lake/weekends/2026-05-23','Carter',body)).status,400,'a Saturday is not a weekend key');
 for(const bad of [{...body,queen:Array(11).fill('x')},{...body,bunks:['']},{...body,title:'x'.repeat(81)},{...body,queen:'Rick'}])assert.equal((await call('PUT','/hub/lake/weekends/2026-05-22','Carter',bad)).status,400);
});
test('away ranges: add, list, delete, and bad ids or dates',async()=>{
 const {call}=setup();
 assert.equal((await call('POST','/hub/lake/away','Carter',{start_date:'2026-07-17',end_date:'2026-07-16'})).status,400);
 assert.equal((await call('POST','/hub/lake/away','Carter',{start_date:'2026-01-01',end_date:'2027-06-01'})).status,400,'over a year is a typo');
 const made=await call('POST','/hub/lake/away','Carter',{start_date:'2026-07-17',end_date:'2026-07-19',reason:'Carter has 6108'});
 assert.equal(made.status,201);const id=made.data.away.id;assert.deepEqual(made.data.away,{id,start_date:'2026-07-17',end_date:'2026-07-19',reason:'Carter has 6108',source:'manual'});
 assert.deepEqual((await call('GET','/hub/lake')).data.away.map(a=>a.id),[id]);
 assert.equal((await call('DELETE','/hub/lake/away/not-a-uuid')).status,404);
 assert.equal((await call('DELETE','/hub/lake/away/'+id)).status,200);
 assert.equal((await call('DELETE','/hub/lake/away/'+id)).status,404);
});
test('invites: add in order, edit note and weekends, remove',async()=>{
 const {call}=setup();
 assert.equal((await call('POST','/hub/lake/invites','Carter',{name:'  '})).status,400);
 const a=(await call('POST','/hub/lake/invites','Carter',{name:'Rick/Cheryl',note:'booked'})).data.invite;
 const b=(await call('POST','/hub/lake/invites','Chester',{name:'Sam Fearn'})).data.invite;
 assert.deepEqual((await call('GET','/hub/lake')).data.invites.map(i=>i.name),['Rick/Cheryl','Sam Fearn']);
 const patched=await call('PATCH','/hub/lake/invites/'+a.id,'Carter',{weekends:['2026-09-18','2026-06-05','2026-06-05'],note:'booked twice'});
 assert.deepEqual([patched.data.invite.weekends,patched.data.invite.note],[['2026-06-05','2026-09-18'],'booked twice']);
 for(const bad of [{weekends:['2026-06-06']},{weekends:'2026-06-05'},{name:''},{}])assert.equal((await call('PATCH','/hub/lake/invites/'+a.id,'Carter',bad)).status,400,JSON.stringify(bad));
 assert.equal((await call('PATCH','/hub/lake/invites/'+uuid(99),'Carter',{note:'x'})).status,404);
 assert.equal((await call('DELETE','/hub/lake/invites/'+b.id)).status,200);
 assert.deepEqual((await call('GET','/hub/lake')).data.invites.map(i=>i.name),['Rick/Cheryl']);
});

test('calendar link: read before saving, travel events become Away, typed Away stays, unlink clears',async()=>{
 const {call,feed,tables}=setup();
 const ics=(...events)=>'BEGIN:VCALENDAR\r\nVERSION:2.0\r\n'+events.map(([summary,start,end])=>`BEGIN:VEVENT\r\nSUMMARY:${summary}\r\nDTSTART;VALUE=DATE:${start}\r\nDTEND;VALUE=DATE:${end}\r\nEND:VEVENT\r\n`).join('')+'END:VCALENDAR\r\n';
 await call('POST','/hub/lake/away','Carter',{start_date:'2099-01-01',end_date:'2099-01-02',reason:'typed'});
 for(const url of ['','http://calendar.example.com/a.ics','https://127.0.0.1/a.ics','https://localhost/a.ics','https://user:pw@calendar.example.com/a.ics','not a link'])assert.equal((await call('PUT','/hub/lake/calendar','Carter',{url})).status,400,url);
 feed.text='<html>not a calendar</html>';
 const bad=await call('PUT','/hub/lake/calendar','Carter',{url:'https://calendar.example.com/a.ics'});
 assert.equal(bad.status,400);assert(bad.data.error.includes('not a calendar'));assert.equal(tables.family_lake_calendar.length,0,'a bad link is never saved');
 feed.fail='fetch failed';assert.equal((await call('PUT','/hub/lake/calendar','Carter',{url:'https://calendar.example.com/a.ics'})).status,400);feed.fail=null;
 feed.text=ics(['Flight to Denver','20990310','20990313'],['Mom birthday','20990311','20990312'],['Out of town','20990401','20990402']);
 const saved=await call('PUT','/hub/lake/calendar','Carter',{url:'webcal://calendar.example.com/a.ics'});
 assert.equal(saved.status,200);assert.equal(saved.data.count,2);
 assert.equal(tables.family_lake_calendar[0].url,'https://calendar.example.com/a.ics','webcal is stored as https');
 const got=(await call('GET','/hub/lake','Chester')).data;
 assert.deepEqual(got.away.map(a=>[a.start_date,a.end_date,a.reason,a.source]),[['2099-01-01','2099-01-02','typed','manual'],['2099-03-10','2099-03-12','Flight to Denver','calendar'],['2099-04-01','2099-04-01','Out of town','calendar']]);
 assert.deepEqual([got.calendar.linked,got.calendar.error],[true,''],'the stored link is never sent back');
 assert(!JSON.stringify(got).includes('calendar.example.com'));
 feed.text=ics(['Trip to Austin','20990501','20990503']);
 await call('PUT','/hub/lake/calendar','Chester',{url:'https://calendar.example.com/a.ics'});
 assert.deepEqual((await call('GET','/hub/lake')).data.away.map(a=>a.reason),['typed','Trip to Austin'],'each sync replaces the calendar ranges');
 assert.equal((await call('DELETE','/hub/lake/calendar','Carter')).status,200);
 assert.deepEqual((await call('GET','/hub/lake')).data.away.map(a=>a.reason),['typed']);assert.equal((await call('GET','/hub/lake')).data.calendar.linked,false);
});
