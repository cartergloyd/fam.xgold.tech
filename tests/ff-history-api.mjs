import {test} from 'node:test';
import assert from 'node:assert/strict';
import {issueSession} from '../deploy/family-hub/hub-session.js';
import ffHistory from '../deploy/family-hub/ff-history.js';
const secret='test-secret-only',user={id:'00000000-0000-4000-8000-000000000001',name:'Carter',status:'ready',pin_hash:'h1'};
function setup(docs,broken){
 const tables={family_users:[user],family_ff_history:docs};
 const database=table=>{const f=[];const q={where(c){f.push(r=>Object.entries(c).every(([k,v])=>r[k]===v));return q;},first:async()=>{if(broken)throw Error('down');return tables[table].find(r=>f.every(x=>x(r)));}};return q;};
 let handler;ffHistory({get:(_p,fn)=>{handler=fn;}},{database},{secret});
 return async token=>{const out={status:200};const res={set(){return res;},status(n){out.status=n;return res;},json(d){out.data=d;return res;}};await handler({get:k=>k==='X-Family-Session'?token:null},res);return out;};
}
test('only a signed-in family session can read the history',async()=>{
 const doc={seasons:[],owners:[]},call=setup([{id:'league',doc}]);
 assert.equal((await call('')).status,401);
 assert.equal((await call('forged.token')).status,401);
 const ok=await call(issueSession(user,secret));
 assert.equal(ok.status,200);assert.deepEqual(ok.data,{history:doc});
});
test('no document yet is null, and a database failure is a 503 with no details',async()=>{
 assert.deepEqual((await setup([])(issueSession(user,secret))).data,{history:null});
 const down=await setup([],true)(issueSession(user,secret));
 assert.equal(down.status,503);assert.match(down.data.error,/temporarily unavailable/);
});
