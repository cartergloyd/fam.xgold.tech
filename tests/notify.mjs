import {test} from 'node:test';
import assert from 'node:assert/strict';
import {compose,notifier} from '../deploy/family-hub/notify.js';
const stay={id:'r1',start_date:'2026-07-10',end_date:'2026-07-16',status:'pending',title:'Quello/Talir',guest_name:'Quello',guest_email:'g@example.com',user_id:null,revision:1};
const ctx={property:{check_in:'16:00:00',check_out:'10:00:00'},managers:['carter@example.com','chester@example.com'],memberEmail:'',link:'https://fam.xgold.tech/6108/?stay=abc'};
const subjects=mails=>mails.map(m=>m.to+' | '+m.subject);
test('a visitor request mails the visitor a private link and tells both managers',()=>{
 const mails=compose('requested',stay,ctx);
 assert.deepEqual(subjects(mails),['g@example.com | Request received: 6108, Jul 10 to Jul 16','carter@example.com | New request: Quello/Talir, Jul 10 to Jul 16','chester@example.com | New request: Quello/Talir, Jul 10 to Jul 16']);
 assert(mails[0].text.includes('https://fam.xgold.tech/6108/?stay=abc'));
 assert(!mails[1].text.includes('?stay='),'managers never get the visitor link');
});
test('no email on file means nobody to confirm to, but managers still hear about it',()=>{
 assert.deepEqual(subjects(compose('requested',{...stay,guest_email:null},ctx)).map(s=>s.split(' | ')[0]),['carter@example.com','chester@example.com']);
});
test('confirmed stays carry a calendar file with check-in and check-out times',()=>{
 const [mail]=compose('confirmed',{...stay,status:'confirmed'},ctx);
 assert.equal(mail.subject,'Confirmed: 6108, Jul 10 to Jul 16');
 assert(mail.text.includes('Check-in 4:00 pm, check-out 10:00 am.'));
 assert(mail.ics.includes('DTSTART;VALUE=DATE:20260710')&&mail.ics.includes('DTEND;VALUE=DATE:20260716')&&mail.ics.includes('UID:stay-r1@fam.xgold.tech'));
 assert.equal(compose('declined',stay,ctx)[0].ics,undefined);
});
test('members are mailed at their account address; guest changes also reach the managers',()=>{
 const member={...stay,guest_email:null,user_id:'u1'};
 assert.deepEqual(subjects(compose('declined',member,{...ctx,memberEmail:'m@example.com'})),['m@example.com | Not available: 6108, Jul 10 to Jul 16']);
 assert.equal(compose('guest-cancelled',stay,ctx).length,3);
 assert.equal(compose('guest-rescheduled',stay,ctx).length,3);
 assert.equal(compose('reminder',{...stay,status:'confirmed'},{...ctx,managers:[]}).length,1);
});
// Just enough database for notify.js: users and properties by filter, reservations to remind.
function fakeDatabase(){
 const tables={family_users:[{id:'u1',email:'m@example.com',condo_manager:false,status:'ready'},{id:'m1',email:'carter@example.com',condo_manager:true,status:'ready'}],family_properties:[{id:'6108',timezone:'America/Chicago',check_in:'16:00:00',check_out:'10:00:00'}],
  family_reservations:[{...stay,id:'soon',status:'confirmed',start_date:'2026-11-12',end_date:'2026-11-14',reminded_at:null},{...stay,id:'later',status:'confirmed',start_date:'2026-12-20',end_date:'2026-12-22',reminded_at:null},{...stay,id:'done',status:'confirmed',start_date:'2026-11-11',end_date:'2026-11-13',reminded_at:new Date()},{...stay,id:'asked',status:'pending',start_date:'2026-11-12',end_date:'2026-11-14',reminded_at:null}]};
 return table=>{const filters=[];let patch=null;
  const rows=()=>tables[table].filter(r=>filters.every(f=>f(r)));
  const q={where(c,op,v){filters.push(typeof c==='object'?r=>Object.entries(c).every(([k,x])=>r[k]===x):op==='>='?r=>r[c]>=v:r=>r[c]<=v);return q;},
   first:async()=>rows()[0],pluck:async k=>rows().map(r=>r[k]),update(p){patch=p;return q;},
   then(res,rej){return Promise.resolve().then(()=>patch?(rows().forEach(r=>Object.assign(r,patch)),1):rows()).then(res,rej);}};
  return q;};
}
test('reminders: one per confirmed stay starting within a week, never repeated',async()=>{
 const sent=[],database=fakeDatabase(),notify=notifier({database,send:async m=>sent.push(m)});
 const now=new Date('2026-11-09T15:00:00Z');
 assert.equal(await notify.reminders(now),1);
 assert.deepEqual(sent.map(m=>m.subject),['Coming up: 6108, Nov 12 to Nov 14'],'not the later stay, the already reminded one, or the unapproved request');
 assert.equal(await notify.reminders(now),0,'reminded_at stops a second reminder');
});
test('with no email transport configured, notifications do nothing',async()=>{
 const notify=notifier({database:fakeDatabase(),env:{EMAIL_TRANSPORT:'sendmail'}});
 assert.equal(await notify('requested',stay,'tok'),undefined);assert.equal(await notify.reminders(),0);
});
test('a failing mail server is logged and never throws into the booking',async()=>{
 const warnings=[],notify=notifier({database:fakeDatabase(),send:async()=>{throw Error('smtp down');},logger:{warn:m=>warnings.push(m)}});
 await notify('requested',stay,'tok');
 assert(warnings.length>=1&&warnings[0].includes('smtp down'));
});
