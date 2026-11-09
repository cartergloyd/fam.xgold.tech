import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
// install-backend.py copies each hub module into the extension under a target name. A module that imports a sibling by its
// source name breaks the whole family API once installed, even though it works from the repository (this happened once).
const dir=new URL('../deploy/family-hub/',import.meta.url);
const installer=readFileSync(new URL('install-backend.py',dir),'utf8');
const pairs=[...installer.matchAll(/\('([\w.-]+)','([\w.-]+)'\)/g)].map(m=>[m[1],m[2]]);
const installedAs=new Map(pairs);
const targets=new Set(pairs.map(p=>p[1]));
test('every sibling import resolves to a file the installer creates',()=>{
 for(const [source,target] of pairs){
  for(const m of readFileSync(new URL(source,dir),'utf8').matchAll(/from\s+'\.\/([\w.-]+\.js)'/g))assert(targets.has(m[1]),`${source} (installed as ${target}) imports ./${m[1]}, which the installer does not create`);
 }
 assert(installedAs.get('lake.js')&&installedAs.get('lake-sync.js')&&installedAs.get('calendar.js')&&installedAs.get('notify.js'),'the new modules are in the install list');
});
