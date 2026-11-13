import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
// Runs the awards endpoint against an in-memory PostgreSQL (pg-mem). pg-mem and knex are not project dependencies; install them
// somewhere and point AWARDS_TEST_MODULES at that node_modules folder, otherwise this test is skipped.
const modules = process.env.AWARDS_TEST_MODULES;
const { default: awards, issue, familyHash } = await import('../deploy/family-awards/endpoint.js');
const secret = 'test-secret-only', ORIGIN = 'https://fam.xgold.tech';
const sha = v => createHash('sha256').update(v).digest('hex');

test('awards: invite, family PIN, session, rsvp, ballot, upload, results', { skip: !modules && 'set AWARDS_TEST_MODULES' }, async () => {
  const require = createRequire(modules + '/x.js');
  const { newDb } = require('pg-mem');
  const mem = newDb();
  mem.public.none(`
   CREATE TABLE family_users (id uuid PRIMARY KEY, name text, first_name text, photo uuid, status text DEFAULT 'invited', email text, pin_hash text, pin_salt_name text);
   CREATE TABLE family_award_guests (user_id uuid PRIMARY KEY, token_hash text NOT NULL, is_admin boolean NOT NULL DEFAULT false,
    failed integer NOT NULL DEFAULT 0, locked_until timestamptz, rsvp boolean, rsvp_at timestamptz, ballot jsonb NOT NULL DEFAULT '{}',
    ballot_at timestamptz, upload bytea, upload_type text, upload_name text, upload_at timestamptz);`);
  const db = await mem.adapters.createKnex();
  const ids = { Carter: '00000000-0000-4000-8000-000000000001', Rick: '00000000-0000-4000-8000-000000000002', Pat: '00000000-0000-4000-8000-000000000003' };
  const tokens = { Carter: 'carter-token-0123456789', Rick: 'rick-token-0123456789ab', Pat: 'pat-token-0123456789abc' };
  for (const [name, id] of Object.entries(ids)) {
    // Carter is a registered member with a family PIN already; Rick and Pat are invited but have not registered.
    const member = name === 'Carter' ? { status: 'ready', email: 'c@example.com', pin_hash: familyHash(name, '4321'), pin_salt_name: name } : {};
    await db('family_users').insert({ id, name, first_name: name, ...member });
    await db('family_award_guests').insert({ user_id: id, token_hash: sha(tokens[name]), is_admin: name === 'Carter' });
  }
  const handlers = {}, router = {};
  for (const m of ['get', 'post', 'put', 'delete']) router[m] = (path, fn) => handlers[m.toUpperCase() + ' ' + path] = fn;
  awards(router, { database: db }, { secret, familySession: u => 'family-session-for-' + u.name });
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
  assert.equal((await call('GET', '/awards/invite', { query: { k: tokens.Carter } })).data.hasPin, true);
  // first visit: the passcode typed once becomes the family PIN
  assert.equal((await call('POST', '/awards/claim', { body: { k: tokens.Rick, pin: '12' } })).status, 400);
  assert.equal((await call('POST', '/awards/claim', { origin: 'https://evil.example', body: { k: tokens.Rick, pin: '1234' } })).status, 403);
  const made = await call('POST', '/awards/claim', { body: { k: tokens.Rick, pin: '1234' } });
  assert.equal(made.status, 201);
  const row = await db('family_users').where({ id: ids.Rick }).first();
  assert.deepEqual([row.pin_hash, row.pin_salt_name, row.status, row.email], [familyHash('Rick', '1234'), 'Rick', 'invited', null], 'family PIN set; registration state untouched');
  assert.equal(made.data.family, undefined, 'unregistered people get no family session');
  const rick = made.data.session;
  assert.equal((await call('POST', '/awards/claim', { body: { k: tokens.Rick, pin: '9999' } })).status, 401, 'wrong passcode');
  assert.equal((await call('GET', '/awards/invite', { query: { k: tokens.Rick } })).data.hasPin, true);
  assert.equal((await call('POST', '/awards/claim', { body: { k: tokens.Rick, pin: '1234' } })).data.session, rick, 'same passcode, same session');
  // registered members use the PIN they already have, and also get the family session
  assert.equal((await call('POST', '/awards/claim', { body: { k: tokens.Carter, pin: '1234' } })).status, 401);
  const carter = (await call('POST', '/awards/claim', { body: { k: tokens.Carter, pin: '4321' } })).data;
  assert.equal(carter.family, 'family-session-for-Carter');
  // sessions
  assert.equal((await call('GET', '/awards/me')).status, 401);
  assert.equal((await call('GET', '/awards/me', { session: rick + 'x' })).status, 401);
  assert.equal((await call('GET', '/awards/me', { session: issue({ id: ids.Rick, pin_hash: familyHash('Rick', '0000') }, secret) })).status, 401, 'signed with another PIN');
  const me = (await call('GET', '/awards/me', { session: rick })).data;
  assert.deepEqual([me.name, me.admin, me.rsvp, me.upload], ['Rick', false, null, null]);
  await db('family_users').where({ id: ids.Rick }).update({ pin_hash: familyHash('Rick', '5678') });
  assert.equal((await call('GET', '/awards/me', { session: rick })).status, 401, 'changing the family PIN ends the session');
  const rick2 = (await call('POST', '/awards/claim', { body: { k: tokens.Rick, pin: '5678' } })).data.session;
  assert.equal((await call('GET', '/awards/me', { session: rick2 })).status, 200);
  // lockout after five wrong passcodes (one was already used above)
  for (let i = 0; i < 4; i++) assert.equal((await call('POST', '/awards/claim', { body: { k: tokens.Carter, pin: '0000' } })).status, 401);
  assert.equal((await call('POST', '/awards/claim', { body: { k: tokens.Carter, pin: '4321' } })).status, 200, 'a right passcode resets the count');
  for (let i = 0; i < 5; i++) assert.equal((await call('POST', '/awards/claim', { body: { k: tokens.Carter, pin: '0000' } })).status, 401);
  assert.equal((await call('POST', '/awards/claim', { body: { k: tokens.Carter, pin: '4321' } })).status, 429, 'locked even for the right passcode');
  assert.equal((await call('GET', '/awards/me', { session: carter.session })).status, 200, 'an existing session survives the lock');
  // rsvp
  assert.equal((await call('PUT', '/awards/rsvp', { session: rick2, body: { going: 'yes' } })).status, 400);
  assert.equal((await call('PUT', '/awards/rsvp', { session: rick2, body: { going: true } })).status, 200);
  assert.deepEqual((await call('GET', '/awards/me', { session: rick2 })).data.going, ['Rick']);
  // ballot: one text answer per category; blanks dropped, text trimmed, shape checked
  for (const bad of [{ 'Bad Id': 'x' }, { mvp: 5 }, { mvp: 'x'.repeat(501) }]) assert.equal((await call('PUT', '/awards/ballot', { session: rick2, body: { ballot: bad } })).status, 400);
  const ballot = (await call('PUT', '/awards/ballot', { session: rick2, body: { ballot: { mvp: ' Josh Allen ', folly: '   ', leech: 'x'.repeat(500) } } })).data.ballot;
  assert.deepEqual(Object.keys(ballot), ['mvp', 'leech']);
  assert.equal(ballot.mvp, 'Josh Allen');
  assert.deepEqual((await call('GET', '/awards/me', { session: rick2 })).data.ballot, ballot);
  // paper ballot
  assert.equal((await call('PUT', '/awards/upload', { session: rick2, raw: Buffer.from('x'), type: 'text/html' })).status, 415);
  assert.equal((await call('PUT', '/awards/upload', { session: rick2, raw: Buffer.alloc(0), type: 'image/png' })).status, 400);
  const file = Buffer.from('PNG-bytes-for-test'); // ASCII only: pg-mem stores bytea as text, real PostgreSQL keeps any byte
  assert.equal((await call('PUT', '/awards/upload', { session: rick2, raw: file, type: 'image/png' })).data.upload.name, 'ballot.png');
  const back = await call('GET', '/awards/upload/:id', { session: rick2, params: { id: 'me' } });
  assert.deepEqual([back.headers['Content-Type'], Buffer.compare(back.bytes, file)], ['image/png', 0]);
  assert.equal((await call('GET', '/awards/upload/:id', { session: carter.session, params: { id: ids.Rick } })).status, 200, 'organizer reads any');
  const pat = (await call('POST', '/awards/claim', { body: { k: tokens.Pat, pin: '5555' } })).data.session;
  assert.equal((await call('GET', '/awards/upload/:id', { session: pat, params: { id: ids.Rick } })).status, 403, 'others cannot');
  // results are organizer-only
  assert.equal((await call('GET', '/awards/results', { session: rick2 })).status, 403);
  const results = (await call('GET', '/awards/results', { session: carter.session })).data.guests;
  assert.deepEqual(results.map(g => [g.name, g.rsvp, g.upload, g.joined]), [['Carter', null, null, true], ['Pat', null, null, true], ['Rick', true, 'ballot.png', true]]);
  assert.equal((await call('DELETE', '/awards/upload', { session: rick2 })).data.upload, null);
  assert.equal((await call('GET', '/awards/me', { session: rick2 })).data.upload, null);
  await db.destroy();
});
