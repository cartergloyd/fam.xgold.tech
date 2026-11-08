import {test} from 'node:test';
import assert from 'node:assert/strict';
import {issueSession} from '../deploy/family-hub/hub-session.js';
import places,{accountKey} from '../deploy/family-hub/places.js';
// A just-big-enough stand-in for the few knex calls places.js makes, so this runs without PostgreSQL.
function fakeDatabase(tables){
 return table=>{
  const filters=[];let order=null,insert=null,remove=false;
  const rows=()=>{let r=tables[table].filter(row=>filters.every(f=>f(row)));if(order)r=[...r].sort((a,b)=>(a[order[0]]>b[order[0]]?1:-1)*(order[1]==='desc'?-1:1));return r;};
  const q={
   where(c){filters.push(r=>Object.entries(c).every(([k,v])=>r[k]===v));return q;},
   whereIn(k,vs){filters.push(r=>vs.includes(r[k]));return q;},
   orderBy(k,d='asc'){order=[k,d];return q;},
   pluck:async k=>rows().map(r=>r[k]),
   first:async(...cols)=>{const r=rows()[0];return r&&cols.length?Object.fromEntries(cols.map(c=>[c,r[c]])):r;},
   count:()=>({first:async()=>({count:rows().length})}),
   insert(row){insert=row;return q;},
   onConflict(){return q;},
   ignore(){return q;},
   del(){remove=true;return q;},
   then(resolve,reject){return Promise.resolve().then(()=>{
    if(insert){if(!tables[table].some(r=>r.user_id===insert.user_id&&r.pin_id===insert.pin_id))tables[table].push({...insert,date_created:tables[table].length});return 1;}
    if(remove){const gone=rows();tables[table]=tables[table].filter(r=>!gone.includes(r));return gone.length;}
    return rows();}).then(resolve,reject);},
  };
  return q;
 };
}
const secret='test-secret-only',uuid=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
function setup(){
 const tables={
  family_users:[{id:uuid(1),name:'Carter',status:'ready',pin_hash:'h1',mc_java_username:'Carter_G',mc_bedrock_username:'Carter G'},{id:uuid(2),name:'Member',status:'ready',pin_hash:'h2',mc_java_username:null,mc_bedrock_username:null}],
  family_mc_pin_stars:[],
  family_mc_last_seen:[{key:'carterg',world:'world',x:1,y:2,z:3,seen_at:'2026-11-08T10:00:00Z'},{key:'someoneelse',world:'world',x:9,y:9,z:9,seen_at:'2026-11-08T11:00:00Z'}],
 };
 const handlers={},router={};for(const m of ['get','post'])router[m]=(path,fn)=>handlers[m.toUpperCase()+' '+path]=fn;
 places(router,{database:fakeDatabase(tables)},{secret});
 const tokens={Carter:issueSession(tables.family_users[0],secret),Member:issueSession(tables.family_users[1],secret)};
 async function call(method,path,who='Carter',body={},origin='https://fam.xgold.tech'){
  const result={status:200};const res={set(){return res;},status(n){result.status=n;return res;},json(data){result.data=data;return res;}};
  await handlers[method+' '+path]({method,body,get:k=>k==='Origin'?origin:k==='X-Family-Session'?(tokens[who]||'forged'):null},res);return result;
 }
 return {tables,call};
}
test('account keys match what the collector writes',()=>{
 assert.equal(accountKey('.Player_One Z'),'playeronez');assert.equal(accountKey('Carter_G'),'carterg');assert.equal(accountKey(null),'');
});
test('stars: sign-in, origin and input checks, then star, list and unstar',async()=>{
 const {call}=setup();
 assert.equal((await call('GET','/hub/mc-stars','forged')).status,401);
 assert.equal((await call('POST','/hub/mc-stars','Carter',{pin:'world:markers:a',starred:true},'https://evil.example')).status,403);
 for(const body of [{},{pin:'',starred:true},{pin:'x'.repeat(201),starred:true},{pin:'world:markers:a',starred:'yes'}])assert.equal((await call('POST','/hub/mc-stars','Carter',body)).status,400);
 assert.equal((await call('POST','/hub/mc-stars','Carter',{pin:'world:markers:a',starred:true})).status,200);
 assert.equal((await call('POST','/hub/mc-stars','Carter',{pin:'world:markers:a',starred:true})).status,200,'starring twice is harmless');
 assert.equal((await call('POST','/hub/mc-stars','Carter',{pin:'world_nether:markers:b',starred:true})).status,200);
 assert.deepEqual((await call('GET','/hub/mc-stars','Carter')).data.stars,['world:markers:a','world_nether:markers:b']);
 assert.deepEqual((await call('GET','/hub/mc-stars','Member')).data.stars,[],'stars belong to one member');
 await call('POST','/hub/mc-stars','Carter',{pin:'world:markers:a',starred:false});
 assert.deepEqual((await call('GET','/hub/mc-stars','Carter')).data.stars,['world_nether:markers:b']);
});
test('stars are capped at 200 per member',async()=>{
 const {call,tables}=setup();
 for(let i=0;i<200;i++)tables.family_mc_pin_stars.push({user_id:uuid(1),pin_id:'world:markers:'+i,date_created:i});
 assert.equal((await call('POST','/hub/mc-stars','Carter',{pin:'world:markers:new',starred:true})).status,429);
 assert.equal((await call('POST','/hub/mc-stars','Carter',{pin:'world:markers:3',starred:false})).status,200);
});
test('last seen: only the member\'s own linked accounts, newest first',async()=>{
 const {call,tables}=setup();
 assert.equal((await call('GET','/hub/mc-last-seen','forged')).status,401);
 const mine=(await call('GET','/hub/mc-last-seen','Carter')).data.spot;
 assert.deepEqual(mine,{world:'world',x:1,y:2,z:3,seen_at:'2026-11-08T10:00:00Z'},'Java Carter_G and Bedrock Carter G share a key, and no one else\'s row comes back');
 assert.equal((await call('GET','/hub/mc-last-seen','Member')).data.spot,null,'no linked account, nothing to look up');
 tables.family_mc_last_seen.push({key:'carterg',world:'world_nether',x:7,y:8,z:9,seen_at:'2026-11-08T12:00:00Z'});
 assert.equal((await call('GET','/hub/mc-last-seen','Carter')).data.spot.world,'world_nether');
});
