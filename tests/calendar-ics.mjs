import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {buildIcs,feedToken,feedUser,stayEvents,awayEvents} from '../deploy/family-hub/calendar.js';
const now=new Date('2026-11-09T12:00:00Z'),secret='test-secret-only';
const clientIcs=()=>{const sandbox={window:{},TextEncoder,Blob,URL};vm.runInNewContext(readFileSync(new URL('../ics.js',import.meta.url),'utf8'),sandbox);return sandbox.window.famIcs;};
const events=[{uid:'a@x',start:'2026-07-17',end:'2026-07-20',summary:'6108 · Quello, Talir; "family"',sequence:2},{uid:'b@x',start:'2026-08-01',summary:'Requested: Kayla',status:'TENTATIVE'}];
const vevents=text=>text.slice(text.indexOf('BEGIN:VEVENT'),text.lastIndexOf('END:VEVENT')+'END:VEVENT'.length);
test('the feed is a valid all-day calendar: CRLF, escapes, short lines, exclusive end',()=>{
 const ics=buildIcs('6108',events,now);
 assert(ics.startsWith('BEGIN:VCALENDAR\r\n')&&ics.endsWith('END:VCALENDAR\r\n'));
 assert(ics.includes('DTSTART;VALUE=DATE:20260717\r\nDTEND;VALUE=DATE:20260720\r\n'));
 assert(ics.includes('SUMMARY:6108 · Quello\\, Talir\\; "family"'));
 assert(ics.includes('STATUS:TENTATIVE')&&ics.includes('SEQUENCE:2')&&ics.includes('DTSTAMP:20261109T120000Z'));
 assert(!/[^\r]\n/.test(ics),'every line break is CRLF');
 const long=buildIcs('6108',[{uid:'c@x',start:'2026-07-17',summary:'é'.repeat(80)}],now);
 for(const line of long.split('\r\n'))assert(Buffer.byteLength(line)<=75,line);
 assert.equal(long.replace(/\r\n /g,'').match(/SUMMARY:(.*)\r\n/)[1],'SUMMARY:'.slice(8)+'é'.repeat(80),'folded lines unfold to the original');
});
test('the browser builder and the server builder write the same events',()=>{
 const client=clientIcs().build('6108',events,now);
 assert.equal(vevents(client),vevents(buildIcs('6108',events,now)));
 const timed=clientIcs().build('Trip',[{uid:'t@x',start:'2027-03-28T16:00',summary:'Check-in',location:'3491 Scenic Highway 98, Destin, FL'}],now);
 assert(timed.includes('DTSTART:20270328T160000\r\nDTEND:20270328T170000\r\n'),'a timed event with no end lasts an hour');
 assert(events[1].end===undefined&&vevents(buildIcs('6108',[events[1]],now)).includes('DTSTART;VALUE=DATE:20260801\r\nDTEND;VALUE=DATE:20260802\r\n'),'an all-day event with no end lasts a day');
 assert(timed.includes('LOCATION:3491 Scenic Highway 98\\, Destin\\, FL'));
});
test('stays and away dates become events',()=>{
 const rows=[{id:'1',start_date:'2026-07-10',end_date:'2026-07-16',status:'confirmed',title:'Quello/Talir',name:'Quello/Talir',revision:3},
  {id:'2',start_date:new Date('2026-08-07T00:00:00Z'),end_date:'2026-08-10',status:'pending',title:'',name:'Kayla',revision:1},
  {id:'3',start_date:'2026-09-01',end_date:'2026-09-02',status:'blocked',title:'',name:null,revision:1}];
 const [a,b,c]=stayEvents(rows);
 assert.deepEqual([a.summary,a.status,a.start,a.end,a.sequence],['6108 · Quello/Talir','CONFIRMED','2026-07-10','2026-07-16',3]);
 assert.deepEqual([b.summary,b.status,b.start],['6108 · Requested: Kayla','TENTATIVE','2026-08-07']);
 assert.equal(c.summary,'6108 · Unavailable');
 assert.deepEqual(awayEvents([{id:'9',start_date:'2026-07-17',end_date:'2026-07-19',reason:'Carter has 6108'}]).map(e=>[e.start,e.end,e.summary]),[['2026-07-17','2026-07-20','Away: Carter has 6108']]);
});
test('feed links: valid for the member, dead after a PIN change, forged or cut-off tokens fail',async()=>{
 const user={id:'00000000-0000-4000-8000-000000000001',status:'ready',pin_hash:'hash-1'};
 let current=user;const database=()=>({where:()=>({first:async()=>current})});
 const token=feedToken(user,secret);
 assert.equal((await feedUser(database,token,secret)).id,user.id);
 assert.equal(await feedUser(database,token,'other-secret'),null);
 assert.equal(await feedUser(database,token+'x',secret),null);
 assert.equal(await feedUser(database,user.id,secret),null);
 assert.equal(await feedUser(database,'',secret),null);
 assert.equal(await feedUser(database,undefined,secret),null);
 current={...user,pin_hash:'hash-2'};
 assert.equal(await feedUser(database,token,secret),null,'changing the PIN revokes the link');
 current=null;assert.equal(await feedUser(database,token,secret),null,'a disabled or missing member has no feed');
});
