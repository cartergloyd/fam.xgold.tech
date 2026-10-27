import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const dir = process.env.HUB_SOURCE || new URL('../deploy/family-trips/', import.meta.url).pathname;
const { default: familyTrips, pickTrip, publicProperty } = await import(dir + '/endpoint.js');
const fixture = JSON.parse(await readFile(new URL('./fixtures/trip.json', import.meta.url), 'utf8'));

const trips = [
  { id: 'past', title: 'Past', start_date: new Date('2026-01-01'), end_date: new Date('2026-01-08'), timezone: 'America/Chicago' },
  { id: 'now', title: 'Now', start_date: new Date('2027-03-28'), end_date: new Date('2027-04-04'), timezone: 'America/Chicago' },
  { id: 'later', title: 'Later', start_date: new Date('2027-07-01'), end_date: new Date('2027-07-08'), timezone: 'America/Chicago' },
];
test('the featured trip is the one in progress, else the next to start, else the most recent', () => {
  assert.equal(pickTrip(trips, () => '2027-03-30').id, 'now');
  assert.equal(pickTrip(trips, () => '2027-04-04').id, 'now', 'checkout day still shows the trip');
  assert.equal(pickTrip(trips, () => '2027-04-05').id, 'later');
  assert.equal(pickTrip(trips, () => '2026-12-01').id, 'now');
  assert.equal(pickTrip(trips, () => '2028-01-01').id, 'later');
  assert.equal(pickTrip([], () => '2027-01-01'), null);
});

// A tiny knex stand-in: enough of the builder chain for the endpoint's reads.
function database(tables, fail = false) {
  return table => {
    let rows = (tables[table.split(' ')[0]] || []).slice(), single = false, column = null;
    const q = {
      join() { return q; }, select() { return q; }, orderBy() { return q; },
      where(cond) { rows = rows.filter(r => Object.entries(cond).every(([k, v]) => r[k] === v)); return q; },
      first(col) { single = true; column = col; return q; },
      then(resolve, reject) {
        if (fail) return Promise.reject(new Error('fixture database failure')).then(resolve, reject);
        let out = rows; if (single) { out = rows[0] || null; if (out && column) out = { [column]: out[column] }; }
        return Promise.resolve(out).then(resolve, reject);
      },
    };
    return q;
  };
}
const seed = {
  family_trips: [{ ...fixture.trip, start_date: new Date(fixture.trip.start_date), end_date: new Date(fixture.trip.end_date), driver_id: 'jaime-id', revision: 3, timezone: 'America/Chicago' }],
  family_properties: [{ ...fixture.property, check_in: '16:00:00', check_out: '10:00:00', revision: 2, max_guests: 8, advance_days: 0 }, { id: '6108', title: '6108', timezone: 'America/Chicago', check_in: '16:00:00', check_out: '10:00:00' }],
  family_rooms: fixture.rooms.map((r, i) => ({ id: 'uuid' + i, property_id: 'seastar-palazzo', slug: r.id, sort: i + 1, name: r.name, photos: r.photos })),
  family_users: [{ id: 'jaime-id', name: 'Jaime', email: 'private@example.test', pin_hash: 'secret-hash' }],
};
async function call(tables, query = {}, fail = false) {
  const handlers = {}; const router = { get: (path, fn) => { handlers[path] = fn; } };
  familyTrips(router, { database: database(tables, fail) });
  const result = { status: 200, headers: {} };
  const res = { set(k, v) { result.headers[k] = v; return res; }, status(n) { result.status = n; return res; }, json(data) { result.data = data; return res; } };
  await handlers['/trip']({ query }, res);
  return result;
}
test('GET /family/trip returns only public trip, property and room fields', async () => {
  const r = await call(seed);
  assert.equal(r.status, 200);
  assert.equal(r.headers['Cache-Control'], 'public, max-age=60');
  assert.equal(r.data.trip.id, 'destin-2027');
  assert.equal(r.data.trip.start_date, '2027-03-28');
  assert.equal(r.data.trip.driver, 'Jaime');
  assert.deepEqual(r.data.trip.local_airports, ['VPS', 'ECP', 'PNS']);
  assert.equal(r.data.property.check_in, '16:00');
  assert.equal(r.data.property.title, 'Seastar Palazzo');
  assert.equal(r.data.rooms.length, 9);
  assert.deepEqual(r.data.rooms[0], { id: 'b1', name: fixture.rooms[0].name, photos: fixture.rooms[0].photos });
  assert.deepEqual(r.data.trips.map(t => t.id), ['destin-2027']);
  const text = JSON.stringify(r.data);
  for (const leak of ['pin_hash', 'secret-hash', 'private@example.test', 'driver_id', 'revision', 'max_guests', 'jaime-id']) assert.ok(!text.includes(leak), leak);
  assert.ok(!text.includes('"6108"'), 'other properties are not returned');
});
test('GET /family/trip handles a chosen trip, no trips and database failure', async () => {
  assert.equal((await call(seed, { id: 'destin-2027' })).status, 200);
  assert.equal((await call(seed, { id: 'nope' })).status, 404);
  assert.equal((await call(seed, { id: 'DROP TABLE' })).status, 200, 'an invalid id falls back to the featured trip');
  assert.equal((await call({ ...seed, family_trips: [] })).status, 404);
  const failed = await call(seed, {}, true);
  assert.equal(failed.status, 503);
  assert.match(failed.data.error, /temporarily unavailable/);
});
test('publicProperty tolerates missing optional columns', () => {
  const p = publicProperty({ id: 'x', title: 'X', check_in: '15:00:00', check_out: '11:00:00', timezone: 'America/Chicago' });
  assert.deepEqual([p.spaces, p.gallery, p.cards, p.bedrooms, p.address], [[], [], {}, null, '']);
});
