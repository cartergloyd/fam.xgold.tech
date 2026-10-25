import { test } from 'node:test';
import assert from 'node:assert/strict';
import endpoint, { normalizeResults, signSelection, readSelection } from '../deploy/streaming-requests/endpoint.js';
const item={id:'95396',type:'tv',title:'Severance',year:2022,poster:null};
const secret='test-only-secret';
test('title selections cannot be edited or replayed after expiry',()=>{
 const token=signSelection(item,secret,100);
 assert.equal(readSelection(token,secret,101).title,item.title);
 assert.throws(()=>readSelection(token,'wrong-key',101));
 assert.throws(()=>readSelection(token,secret,3600101));
 const [payload,signature]=token.split('.');
 const forged=Buffer.from(JSON.stringify({...item,title:'Forged',expires:99999999})).toString('base64url')+'.'+signature;
 assert.throws(()=>readSelection(forged,secret,101));
 assert.throws(()=>readSelection(undefined,secret));
 assert.throws(()=>readSelection(payload+'.'+'é'.repeat(43),secret,101));
});
test('provider results are deduplicated and external poster URLs are restricted to TMDB',()=>{
 const rows=[{Name:'Severance',ProviderIds:{Tmdb:'95396'},PremiereDate:'2022-02-17',ImageUrl:'https://image.tmdb.org/t/p/original/poster.jpg'},
 {Name:'Duplicate',ProviderIds:{Tmdb:'95396'}}, {Name:'Missing identifier'},
 {Name:'Other',ProviderIds:{Tmdb:'12'},ImageUrl:'http://localhost/private'}];
 const found=normalizeResults(rows,'tv');assert.equal(found.length,2);
 assert.equal(found[0].year,2022);assert.equal(found[0].poster,'https://image.tmdb.org/t/p/w154/poster.jpg');assert.equal(found[1].poster,null);
});
function harness() {
 const handlers={},saved=[];
 const database=table=>{
  if(table==='family_users')return {where:()=>({whereNot:()=>({first:async()=>({name:'Carter'})})})};
  return {insert:row=>({onConflict:()=>({ignore:()=>({returning:async()=>{
   const duplicate=saved.some(x=>x.media_type===row.media_type&&x.tmdb_id===row.tmdb_id&&x.requester_key===row.requester_key);
   if(duplicate)return [];saved.push(row);return [{id:'saved'}];
  }})})})};
 };
 let calls=0;
 endpoint({get:(p,fn)=>handlers['GET '+p]=fn,post:(p,fn)=>handlers['POST '+p]=fn},{database},{config:async()=>({url:'http://jellyfin',api_key:secret}),fetch:async(url,options)=>{
  calls++;assert.equal(options.headers['X-Emby-Token'],secret);
  return {ok:true,json:async()=>[{Name:'Severance',ProviderIds:{Tmdb:url.endsWith('Movie')?'5072':'95396'},ProductionYear:2022}]};
 }});
 const call=async(method,path,body={},q='Severance',origin='https://fam.xgold.tech')=>{
  let result={status:200};const res={set(){},status(code){result.status=code;return res;},json(data){result.data=data;return res;}};
  await handlers[method+' '+path]({body,query:{q},ip:'test',get:()=>origin},res);return result;
 };
 return {call,saved,calls:()=>calls};
}
test('search works for both types, caches repeated queries and never returns credentials',async()=>{
 const h=harness();const first=await h.call('GET','/streaming-search');
 assert.equal(first.status,200);assert.equal(first.data.results.length,2);assert.equal(h.calls(),2);
 assert(!JSON.stringify(first).includes(secret));
 await h.call('GET','/streaming-search');assert.equal(h.calls(),2);
 assert.equal((await h.call('GET','/streaming-search',{},'x')).status,400);
});
test('requests persist canonical selections, retry idempotently, and reject forgeries and cross-origin submissions',async()=>{
 const h=harness();const selection=signSelection(item,secret);
 const body={selection,client_id:'12345678-1234-1234-1234-123456789012',requested_by:'Carter'};
 assert.equal((await h.call('POST','/streaming-requests',body)).status,201);
 assert.equal((await h.call('POST','/streaming-requests',body)).status,200);
 assert.equal(h.saved.length,1);assert.equal(h.saved[0].title,'Severance');assert.equal(h.saved[0].requested_by,'Carter');
 assert(!h.saved[0].requester_key.includes(body.client_id));
 assert.equal((await h.call('POST','/streaming-requests',{...body,selection:'forged'})).status,400);
 assert.equal((await h.call('POST','/streaming-requests',body,'','https://evil.test')).status,403);
 assert.equal(h.saved.length,1);
});
