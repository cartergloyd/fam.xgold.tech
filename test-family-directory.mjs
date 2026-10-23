import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs/promises';
const source=await fs.readFile(new URL('./family-directory.js',import.meta.url),'utf8');
const calls=[];
let fail=false;
const window={};
vm.runInNewContext(source,{window,AbortController,setTimeout,clearTimeout,fetch:async(url,init)=>{
 calls.push({url,init});
 if(fail)return {ok:false,json:async()=>({error:'The email or PIN does not match.'})};
 return {ok:true,json:async()=>url.endsWith('/users')?{users:[{id:'one',name:'Example',registered:false}]}:{user:{id:'one',name:'Example'}}};
}});
const directory=window.familyDirectory;
assert.equal((await directory.ready)[0].name,'Example');
await directory.lookup('example@example.invalid');
await directory.login('example@example.invalid','0012');
await directory.register('one','example@example.invalid','0012');
assert.ok(calls.every(c=>c.init.credentials==='omit'&&c.init.cache==='no-store'));
assert.deepEqual(JSON.parse(calls[2].init.body),{email:'example@example.invalid',pin:'0012'});
assert.deepEqual(JSON.parse(calls[3].init.body),{id:'one',email:'example@example.invalid',pin:'0012'});
fail=true;await assert.rejects(directory.login('example@example.invalid','0013'),/does not match/);
console.log('Directory client: live roster, exact lookup, server PIN login, registration payload, no credentials in URLs and error handling passed.');

const fantasySource=await fs.readFile(new URL('./ff/index.html',import.meta.url),'utf8');
const start=fantasySource.indexOf('  var familyTeams = {}');
const end=fantasySource.indexOf('  function buildTeams(',start);
const teamsContext={window:{familyDirectory:{ready:Promise.resolve([
 {name:'Scott',fantasy_team:'Boone County Goones'},
 {name:'Carter',fantasy_team:'Bridgeton Fire'},
 {name:'Chester',fantasy_team:'Kronke Sux'},
 {name:'Rick',fantasy_team:'OtherSmith'}
])}}};
vm.createContext(teamsContext);vm.runInContext(fantasySource.slice(start,end),teamsContext);await teamsContext.familyReady;
assert.equal(teamsContext.familyTeam('Boone County Goons').name,'Scott');
assert.equal(teamsContext.familyTeam('The Bridgeton Fire').name,'Carter');
assert.equal(teamsContext.familyTeam('Kroenke Sux').name,'Chester');
assert.equal(teamsContext.familyTeam('TheOtherSmith').name,'Rick');
assert.equal(teamsContext.familyTeam('Completely different').name,undefined);
console.log('Fantasy directory mapping: exact names, leading articles, unique single-letter spelling differences and unmatched teams passed.');
