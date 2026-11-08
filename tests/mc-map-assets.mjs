import {test} from 'node:test';
import assert from 'node:assert/strict';
import minecraft,{injectBubbles} from '../deploy/family-hub/minecraft.js';
// The /mc-map proxy: Find My style bubbles are injected into the Dynmap page only when the script and stylesheet are installed.
const HTML='<html><head><title>Map</title></head><body>dynmap</body></html>';
function proxy(options={}){
 const routes={},router={get(p,f){routes['GET '+p]=f;},use(p,f){routes['USE '+p]=f;}};
 minecraft(router,{database:()=>{throw Error('not used');}},{fetch:async url=>({ok:true,status:200,headers:{get:()=>url.endsWith('.js')?'text/javascript':'text/html'},arrayBuffer:async()=>Buffer.from(url.includes('/js/')?'var x=1;':HTML)}),...options});
 return async(url,method='GET')=>{const out={status:200,headers:{}};const res={status(n){out.status=n;return res;},sendStatus(n){out.status=n;return res;},set(k,v){out.headers[k]=v;return res;},removeHeader(){return res;},send(b){out.body=Buffer.isBuffer(b)?b.toString('utf8'):b;return res;}};await routes['USE /mc-map']({method,url},res);return out;};
}
test('with the bubble files installed, the map page links them and they are served',async()=>{
 const get=proxy({assets:{js:'/* bubbles */',css:'/* glass */'}});
 const page=await get('/?worldname=world&x=1');
 assert.match(page.body,/<link rel="stylesheet" href="family-map\.css"><\/head>/);assert.match(page.body,/<script src="family-map\.js"><\/script><\/body>/);
 assert.equal((await get('/index.html')).body.includes('family-map.js'),true);
 const js=await get('/family-map.js'),css=await get('/family-map.css');
 assert.deepEqual([js.status,js.body,js.headers['Content-Type']],[200,'/* bubbles */','text/javascript']);assert.deepEqual([css.status,css.body,css.headers['Content-Type']],[200,'/* glass */','text/css']);
 assert.equal((await get('/js/map.js')).body,'var x=1;','other Dynmap files pass through untouched');
});
test('without the files the map is plain Dynmap and nothing is injected',async()=>{
 const get=proxy({assets:{js:null,css:null}});
 assert.equal((await get('/')).body,HTML);assert.equal((await get('/family-map.js')).status,404);assert.equal((await get('/family-map.css')).status,404);
 assert.equal(proxy({assets:{js:'x',css:null}}) instanceof Function,true);assert.equal((await proxy({assets:{js:'x',css:null}})('/')).body,HTML,'both files are needed');
});
test('the proxy still only serves its fixed read-only paths',async()=>{
 const get=proxy({assets:{js:'x',css:'y'}});
 for(const url of ['/../etc/passwd','/js/%2e%2e/x','/admin','/up/sendmessage'])assert.equal((await get(url)).status,404,url);
 assert.equal((await get('/',"POST")).status,405);
 assert.equal(injectBubbles('<head></head><body></body>'),'<head><link rel="stylesheet" href="family-map.css"></head><body><script src="family-map.js"></script></body>');
});
