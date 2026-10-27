import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs/promises';

const script = await fs.readFile(new URL('./directus-db.js', import.meta.url), 'utf8');
const rows = new Map(); const calls = []; const sockets = []; const intervals = [];
let failNetwork = false;
class Socket {
  constructor(url) { this.url = url; sockets.push(this); }
  send(value) { this.sent = JSON.parse(value); }
  close() { this.onclose?.(); }
}
const context = vm.createContext({
  window: { addEventListener() {} }, document: { addEventListener() {} },
  localStorage: { getItem: () => 'existing-family-browser-id' },
  AbortController, WebSocket: Socket, setTimeout, clearTimeout,
  setInterval(fn, ms) { intervals.push({ fn, ms }); return intervals.length; }, clearInterval() {},
  async fetch(url, options) {
    calls.push({ url, options });
    if (failNetwork) throw new TypeError('fixture network failure');
    const u = new URL(url), encoded = u.pathname.slice('/items/kv/'.length), key = decodeURIComponent(encoded);
    let status = 200, value;
    const body = options.body ? JSON.parse(options.body) : null;
    const trip = u.searchParams.get('filter[trip][_eq]');
    if (options.method === 'GET') value = [...rows.values()].filter(r => r.coll === u.searchParams.get('filter[coll][_eq]') && (!trip || r.trip === trip));
    if (options.method === 'PATCH') { if (!rows.has(key)) status = 403; else { rows.get(key).data = body.data; value = rows.get(key); } }
    if (options.method === 'POST') { rows.set(body.key, body); value = body; }
    if (options.method === 'DELETE') { rows.delete(key); status = 204; }
    return { ok: status < 400, status, async json() { return status < 400 ? { data: value } : { errors: [{ message: 'Not found', extensions: { code: 'FORBIDDEN' } }] }; } };
  }
});
vm.runInContext(script, context);
const db = await context.window.claude.use('db');
assert.equal(await (await context.window.claude.use('user')).id(), 'existing-family-browser-id');
await db.doc('plans/path/with slash & #').set({ ts: 2, label: 'first' });
assert.ok(rows.has('plans/path/with slash & #'));
assert.ok(calls.some(c => c.url.includes(encodeURIComponent('plans/path/with slash & #'))));
await db.collection('groceries').doc('path/with slash & #').set({ ts: 1 });
assert.equal(rows.size, 2, 'same id in different colls is independent');
await db.doc('plans/path/with slash & #').set({ ts: 3 });
assert.equal(rows.get('plans/path/with slash & #').data.ts, 3);
const loaded = await db.collection('plans').get(); assert.equal(loaded[0].data().ts, 3);
let snapshot;
const stop = db.collection('plans').orderBy('ts').onSnapshot(s => { snapshot = s; });
await new Promise(r => setImmediate(r)); assert.equal(snapshot.docs.length, 1);
sockets[0].onopen(); assert.equal(sockets[0].sent.type, 'subscribe');
assert.equal(intervals[0].ms, 15000, 'poll fallback remains active');
sockets[0].onmessage({ data: JSON.stringify({ type: 'ping' }) }); assert.equal(sockets[0].sent.type, 'pong');
rows.get('plans/path/with slash & #').data = { ts: 8 };
sockets[0].onmessage({ data: JSON.stringify({ type: 'subscription', uid: 'family-kv' }) });
await new Promise(r => setImmediate(r)); assert.equal(snapshot.docs[0].data().ts, 8);
const before = calls.length; failNetwork = true;
await assert.rejects(db.doc('plans/no-replay').set({ fixture: true }), /network failure/);
assert.equal(calls.length, before + 1, 'uncertain network failure never retries a write');
failNetwork = false;
await db.doc('plans/path/with slash & #').delete(); assert.ok(!rows.has('plans/path/with slash & #'));
assert.throws(() => db.collection('private'), /Unknown collection/);
// Trip scoping: stored ids carry the trip prefix and the trip column; callers keep plain ids.
assert.throws(() => db.trip('Bad Trip!'), /Invalid trip id/);
db.trip('destin-2027');
await db.collection('bedrooms').doc('b1').set({ name: 'Carter' });
assert.ok(rows.has('bedrooms/destin-2027:b1'));
assert.equal(rows.get('bedrooms/destin-2027:b1').trip, 'destin-2027');
assert.equal(rows.get('bedrooms/destin-2027:b1').id, 'destin-2027:b1');
const scopedDocs = await db.collection('bedrooms').get();
assert.deepEqual(scopedDocs.map(d => d.id), ['b1'], 'the trip prefix is stripped on read');
assert.ok(calls.at(-1).url.includes('filter[trip][_eq]=destin-2027'));
await db.collection('bedrooms').doc('b1').set({ name: 'Marisa' });
assert.equal(rows.get('bedrooms/destin-2027:b1').data.name, 'Marisa', 'updates target the prefixed document');
db.trip('summer-2028');
assert.equal((await db.collection('bedrooms').get()).length, 0, 'another trip starts with free bedrooms');
await db.collection('bedrooms').doc('b1').set({ name: 'Chester' });
assert.equal(rows.size, 3, 'the same bedroom id is independent per trip');
await db.collection('bedrooms').doc('b1').delete();
assert.ok(!rows.has('bedrooms/summer-2028:b1') && rows.has('bedrooms/destin-2027:b1'));
db.trip(null);
assert.equal((await db.collection('bedrooms').get())[0].id, 'destin-2027:b1', 'unscoped reads expose stored ids');
for (const call of calls) assert.equal(call.options.credentials, 'omit');
stop();
console.log('Directus shim passed: preserved browser identity, reads, create/update/delete, path encoding, coll isolation, snapshots, heartbeat, polling, unsubscribe, trip scoping and no uncertain write replay.');
