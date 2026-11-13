import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
// Runs the awards endpoint against an in-memory PostgreSQL (pg-mem). pg-mem and knex are not project dependencies; install them
// somewhere and point AWARDS_TEST_MODULES at that node_modules folder, otherwise this test is skipped.
const modules = process.env.AWARDS_TEST_MODULES;
const { default: awards, issue, pinHash } = await import('../deploy/family-awards/endpoint.js');
const secret = 'test-secret-only', ORIGIN = 'https://fam.xgold.tech';
const sha = v => createHash('sha256').update(v).digest('hex');

test('awards: invite, passcode, session, rsvp, ballot, upload, results', { skip: !modules && 'set AWARDS_TEST_MODULES' }, async () => {
  const require = createRequire(modules + '/x.js');
  const { newDb } = require('pg-mem');
  const mem = newDb();
  mem.public.none(`
   CREATE TABLE family_users (id uuid PRIMARY KEY, name text, first_name text, photo uuid, fantasy_team text, status text DEFAULT 'ready');
   CREATE TABLE family_award_guests (user_id uuid PRIMARY KEY, token_hash text NOT NULL, pin_hash text, is_admin boolean NOT NULL DEFAULT false,
    failed integer NOT NULL DEFAULT 0, locked_until timestamptz, rsvp boolean, rsvp_at timestamptz, ballot jsonb NOT NULL DEFAULT '{}',
    ballot_at timestamptz, upload bytea, upload_type text, upload_name text, upload_at timestamptz);`);
  const db = await mem.adapters.createKnex();
  const ids = { Carter: '00000000-0000-4000-8000-000000000001', Rick: '00000000-0000-4000-8000-000000000002', Pat: '00000000-0000-4000-8000-000000000003' };
  const tokens = { Carter: 'carter-token-0123456789', Rick: 'rick-token-0123456789ab', Pat: 'pat-token-0123456789abc' };
  for (const [name, id] of Object.entries(ids)) {
    await db('family_users').insert({ id, name, first_name: name, fantasy_team: name === 'Pat' ? null : name + ' FC' });
    await db('family_award_guests').insert({ user_id: id, token_hash: sha(tokens[name]), is_admin: name === 'Carter' });
  }
  const handlers = {}, router = {};
  for (const m of ['get', 'post', 'put', 'delete']) router[m] = (path, fn) => handlers[m.toUpperCase() + ' ' + path] = fn;
  awards(router, { database: db }, { secret });
  async function call(method, path, { session, body, query = {}, params = {}, raw, type, origin = ORIGIN } = {}) {
    const result = { status: 200, headers: {} };
    const res = { set(k, v) { result.headers[k] = v; return res; }, status(c) { result.status = c; return res; }, json(d) { result.data = d; return res; }, end(b) { result.bytes = b; return res; } };
    const req = Object.assign(Readable.from(raw ? [raw] : []), { method, query, params, body, ip: '1.1.1.1',
      get: k => ({ Origin: origin, 'X-Family-Session': session, 'Content-Type': type })[k] ?? null });
    await handlers[method + ' ' + path](req, res);
    return result;
  }
  // invitation link
  assert.equal((await call('GET', '/awards/invite', { query: { k: 'nope' } })).status, 404);
  assert.deepEqual((await call('GET', '/awards/invite', { query: { k: tokens.Rick } })).data, { name: 'Rick', first_name: 'Rick', hasPin: false, photo_url: null });
  // creating a passcode
  assert.equal((await call('POST', '/awards/claim', { body: { k: tokens.Rick, pin: '12' } })).status, 400);
  assert.equal((await call('POST', '/awards/claim', { origin: 'https://evil.example', body: { k: tokens.Rick, pin: '1234' } })).status, 403);
  const made = await call('POST', '/awards/claim', { body: { k: tokens.Rick, pin: '1234' } });
  assert.equal(made.status, 201);
  const rick = made.data.session;
  assert.equal((await call('POST', '/awards/claim', { body: { k: tokens.Rick, pin: '9999' } })).status, 401, 'wrong passcode');
  assert.equal((await call('GET', '/awards/invite', { query: { k: tokens.Rick } })).data.hasPin, true);
  assert.equal((await call('POST', '/awards/claim', { body: { k: tokens.Rick, pin: '1234' } })).status, 200, 'returning with the passcode');
  // sessions
  assert.equal((await call('GET', '/awards/me')).status, 401);
  assert.equal((await call('GET', '/awards/me', { session: rick + 'x' })).status, 401);
  assert.equal((await call('GET', '/awards/me', { session: issue({ user_id: ids.Rick, pin_hash: pinHash(ids.Rick, '0000') }, secret) })).status, 401, 'signed with another passcode');
  assert.equal((await call('GET', '/awards/me', { session: issue({ user_id: ids.Rick, pin_hash: pinHash(ids.Rick, '1234') }, secret, Date.now() - 31 * 86400000) })).status, 401, 'expired');
  const me = (await call('GET', '/awards/me', { session: rick })).data;
  assert.deepEqual([me.name, me.admin, me.rsvp, me.upload, me.managers.map(m => m.name)], ['Rick', false, null, null, ['Carter', 'Rick']]);
  // lockout after five wrong passcodes
  const carter = (await call('POST', '/awards/claim', { body: { k: tokens.Carter, pin: '4321' } })).data;
  for (let i = 0; i < 5; i++) assert.equal((await call('POST', '/awards/claim', { body: { k: tokens.Carter, pin: '0000' } })).status, 401);
  assert.equal((await call('POST', '/awards/claim', { body: { k: tokens.Carter, pin: '4321' } })).status, 429, 'locked even for the right passcode');
  assert.equal((await call('GET', '/awards/me', { session: carter.session })).status, 200, 'an existing session survives the lock');
  // rsvp
  assert.equal((await call('PUT', '/awards/rsvp', { session: rick, body: { going: 'yes' } })).status, 400);
  assert.equal((await call('PUT', '/awards/rsvp', { session: rick, body: { going: true } })).status, 200);
  assert.deepEqual((await call('GET', '/awards/me', { session: rick })).data.going, ['Rick']);
  // ballot: blanks dropped, text trimmed, shape checked
  assert.equal((await call('PUT', '/awards/ballot', { session: rick, body: { ballot: { 'Bad Id': { nominee: 'x' } } } })).status, 400);
  assert.equal((await call('PUT', '/awards/ballot', { session: rick, body: { ballot: { trade: { nominee: 'x'.repeat(81) } } } })).status, 400);
  const ballot = (await call('PUT', '/awards/ballot', { session: rick, body: { ballot: { manager: { nominee: ' Rick FC (Rick) ', reason: ' ran away with it ' }, trade: { nominee: '', reason: 'ignored' } } } })).data.ballot;
  assert.deepEqual(ballot, { manager: { nominee: 'Rick FC (Rick)', reason: 'ran away with it' } });
  assert.deepEqual((await call('GET', '/awards/me', { session: rick })).data.ballot, ballot);
  // paper ballot
  assert.equal((await call('PUT', '/awards/upload', { session: rick, raw: Buffer.from('x'), type: 'text/html' })).status, 415);
  assert.equal((await call('PUT', '/awards/upload', { session: rick, raw: Buffer.alloc(0), type: 'image/png' })).status, 400);
  const file = Buffer.from('PNG-bytes-for-test'); // ASCII only: pg-mem stores bytea as text, real PostgreSQL keeps any byte
  assert.equal((await call('PUT', '/awards/upload', { session: rick, raw: file, type: 'image/png' })).data.upload.name, 'ballot.png');
  const back = await call('GET', '/awards/upload/:id', { session: rick, params: { id: 'me' } });
  assert.deepEqual([back.headers['Content-Type'], Buffer.compare(back.bytes, file)], ['image/png', 0]);
  assert.equal((await call('GET', '/awards/upload/:id', { session: carter.session, params: { id: ids.Rick } })).status, 200, 'organizer reads any');
  await call('POST', '/awards/claim', { body: { k: tokens.Pat, pin: '5555' } });
  const pat = (await call('POST', '/awards/claim', { body: { k: tokens.Pat, pin: '5555' } })).data.session;
  assert.equal((await call('GET', '/awards/upload/:id', { session: pat, params: { id: ids.Rick } })).status, 403, 'others cannot');
  // results are organizer-only
  assert.equal((await call('GET', '/awards/results', { session: rick })).status, 403);
  const results = (await call('GET', '/awards/results', { session: carter.session })).data.guests;
  assert.deepEqual(results.map(g => [g.name, g.rsvp, g.upload, g.joined]), [['Carter', null, null, true], ['Pat', null, null, true], ['Rick', true, 'ballot.png', true]]);
  assert.equal((await call('DELETE', '/awards/upload', { session: rick })).data.upload, null);
  assert.equal((await call('GET', '/awards/me', { session: rick })).data.upload, null);
  await db.destroy();
});
