import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, sep, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = fileURLToPath(new URL('../', import.meta.url));
const shots = process.env.FAM_SHOT_DIR || tmpdir();
const fixture = JSON.parse(await readFile(new URL('./fixtures/trip.json', import.meta.url), 'utf8'));
const types = { '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml' };

async function startSite() {
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      const pathname = url.pathname.endsWith('/') ? `${url.pathname}index.html` : url.pathname;
      const file = resolve(root, `.${pathname}`);
      if (!file.startsWith(root.endsWith(sep) ? root : root + sep)) throw new Error('Invalid path');
      const body = await readFile(file);
      res.writeHead(200, { 'Content-Type': types[file.slice(file.lastIndexOf('.'))] || 'text/html' });
      res.end(body);
    } catch { res.writeHead(404); res.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return server;
}

// Mocks the family API: directory, trip details and the kv document store with trip filtering.
async function mock(context, { name = 'Carter', trip = fixture, tripStatus = 200, rows = [] } = {}) {
  const users = [{ id: 'carter', name: 'Carter', group_id: 'g1', registered: true }, { id: 'marisa', name: 'Marisa', group_id: 'g1', registered: true }, { id: 'chester', name: 'Chester', registered: true }];
  const store = new Map(rows.map(r => [r.key, r])), writes = [], tripRequests = [];
  if (name) await context.addInitScript(who => localStorage.setItem('destin-who', JSON.stringify({ name: who, email: 'test@example.test' })), name);
  await context.route('**/*', async route => {
    const req = route.request(), url = new URL(req.url());
    if (url.origin !== 'https://fam-api.xgold.tech') return url.hostname === '127.0.0.1' ? route.continue() : route.abort();
    if (url.pathname === '/family/users') return route.fulfill({ json: { users } });
    if (url.pathname === '/family/trip') { tripRequests.push(url.search); return route.fulfill({ status: tripStatus, json: tripStatus === 200 ? trip : { error: 'Trip details are temporarily unavailable. Please try again.' } }); }
    if (url.pathname.startsWith('/items/kv')) {
      const body = req.postDataJSON?.(), key = decodeURIComponent(url.pathname.slice('/items/kv/'.length));
      if (req.method() === 'GET') {
        const coll = url.searchParams.get('filter[coll][_eq]'), trip = url.searchParams.get('filter[trip][_eq]');
        return route.fulfill({ json: { data: [...store.values()].filter(r => r.coll === coll && (!trip || r.trip === trip)).map(r => ({ id: r.id, data: r.data })) } });
      }
      if (req.method() === 'PATCH') { if (!store.has(key)) return route.fulfill({ status: 404, json: { errors: [{ message: 'Not found' }] } }); store.get(key).data = body.data; writes.push({ method: 'PATCH', key, body }); return route.fulfill({ json: { data: store.get(key) } }); }
      if (req.method() === 'POST') { store.set(body.key, body); writes.push({ method: 'POST', key: body.key, body }); return route.fulfill({ json: { data: body } }); }
      if (req.method() === 'DELETE') { store.delete(key); writes.push({ method: 'DELETE', key }); return route.fulfill({ status: 204, body: '' }); }
    }
    return route.fulfill({ status: 404, json: { error: 'Unexpected test request ' + url.pathname } });
  });
  return { store, writes, tripRequests };
}
const existing = [
  { key: 'bedrooms/destin-2027:b7', coll: 'bedrooms', id: 'destin-2027:b7', trip: 'destin-2027', data: { name: 'Chester', by: 'Chester', people: ['Chester'], ts: 1 } },
  { key: 'bedrooms/summer-2028:b2', coll: 'bedrooms', id: 'summer-2028:b2', trip: 'summer-2028', data: { name: 'Marisa', by: 'Marisa', people: ['Marisa'], ts: 1 } },
  { key: 'plans/destin-2027:abc', coll: 'plans', id: 'destin-2027:abc', trip: 'destin-2027', data: { day: '2027-03-31', time: '19:00', text: 'Date Night', by: 'Carter', people: ['Carter', 'Marisa'], ts: 1 } },
];

test('home page renders the trip, house and rooms from the API and scopes documents to the trip', async () => {
  const server = await startSite(), origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  try {
    for (const width of [390, 1440]) {
      const context = await browser.newContext({ viewport: { width, height: 1000 }, reducedMotion: 'no-preference' });
      const api = await mock(context, { rows: existing.map(r => ({ ...r, data: { ...r.data } })) });
      const page = await context.newPage(); const errors = []; page.on('pageerror', e => errors.push(e.message));
      await page.goto(origin + '/', { waitUntil: 'domcontentloaded' });
      await page.getByRole('heading', { level: 1, name: fixture.trip.title }).waitFor();
      assert.equal(await page.title(), fixture.trip.title);
      assert.equal(await page.locator('#ename').textContent(), 'Seastar Palazzo');
      assert.equal(await page.locator('#kicker').textContent(), 'MAR 28 – APR 4');
      assert.equal(await page.locator('#vhero').getAttribute('aria-label'), fixture.trip.title);
      assert.deepEqual(api.tripRequests, [''], 'the featured trip is requested without an id');
      // Hero slideshow with a pause control.
      assert.equal(await page.locator('#reel img.slide').count(), 2);
      assert.match(await page.locator('#reel img.slide').first().getAttribute('src'), /\/photos\/seastar-palazzo\/hero-1\.webp$/);
      assert.ok(!(await page.locator('body').innerHTML()).includes('base64,'), 'no inline images remain');
      const pauseBox = await page.locator('#reel-pause').boundingBox(), kickerBox = await page.locator('#kicker').boundingBox();
      assert.ok(pauseBox.y + pauseBox.height <= kickerBox.y || pauseBox.x >= kickerBox.x + kickerBox.width, 'the pause control never covers the dates');
      await page.locator('#reel-pause').click();
      assert.equal(await page.locator('#reel-pause').getAttribute('aria-pressed'), 'true');
      assert.ok(await page.locator('#reel').evaluate(n => n.classList.contains('paused')));
      // Highlight cards: backgrounds, pins, headlines and links all come from the property record.
      assert.match(await page.locator('#card-rooms-bg').evaluate(n => getComputedStyle(n).backgroundImage), /card-rooms\.webp/);
      assert.match(await page.locator('#card-flights-bg').evaluate(n => getComputedStyle(n).backgroundImage), /card-flights\.webp/);
      assert.equal(await page.locator('#card-flights-bg').getAttribute('aria-label'), 'Google Flights search from STL');
      assert.equal(await page.locator('#card-area-fig .pin').count(), 3);
      assert.equal(await page.locator('#card-area-fig .pin.home').evaluate(n => n.style.left + ' ' + n.style.top), '49.3% 40%');
      assert.equal(await page.locator('#card-amenities-fig .pin').count(), 2);
      assert.equal(await page.locator('#area-headline').textContent(), 'Walk to the beach.');
      assert.equal(await page.locator('#amenities-headline').textContent(), 'Check out the pool, gazebo and outdoor kitchen.');
      assert.equal(await page.locator('#rooms-headline').textContent(), '9 bedrooms and 9 bathrooms.');
      assert.equal(await page.locator('#maps').getAttribute('href'), 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(fixture.property.address));
      assert.equal(await page.locator('#flt').getAttribute('href'), 'https://www.google.com/travel/flights?q=' + encodeURIComponent('Flights from STL to VPS on 2027-03-28 through 2027-04-04'));
      // Itinerary days span the trip with the property's check-in and check-out times.
      assert.equal(await page.locator('#days > .day').count(), 8);
      assert.equal(await page.locator('#days > .day').first().locator('.chip').textContent(), 'Check-in 4:00 pm');
      assert.equal(await page.locator('#days > .day').last().locator('.chip').textContent(), 'Check-out 10:00 am');
      assert.equal(await page.locator('#sports-note').isVisible(), true, 'the hardcoded sports schedule still matches these dates');
      await page.locator('#days > .day').nth(3).locator('.day-head').click();
      await page.getByText('Date Night', { exact: true }).waitFor();
      // Gallery, facts and lists.
      assert.equal(await page.locator('#gallery figure').count(), 3);
      assert.equal(await page.locator('#gallery figcaption').first().textContent(), 'Sunset from the pool deck');
      assert.deepEqual(await page.locator('#facts .fact b').allTextContents(), ['9', '22', '9']);
      assert.equal(await page.locator('#spaces-list li').count(), 6);
      assert.equal(await page.locator('#nearby-list li').count(), 4);
      assert.match(await page.locator('#strip-msg').textContent(), /^\d+ days until the beach\.$|^We’re here/);
      // Bedrooms: nine from the property, one already claimed for this trip, another trip's claim ignored.
      await page.locator('#book-open').click();
      assert.equal(await page.locator('#rooms-list > li').count(), 9);
      await page.getByText('Claimed by Chester', { exact: true }).waitFor();
      assert.equal(await page.locator('#bcount').textContent(), '1 of 9 booked');
      assert.equal(await page.getByText('Claimed by Marisa', { exact: true }).count(), 0, 'another trip\'s claim does not show');
      assert.equal(await page.locator('#rooms-list .rthumb').first().getAttribute('aria-label'), 'View 4 photos of ' + fixture.rooms[0].name);
      await page.locator('#rooms-list > li').first().getByRole('button', { name: 'Claim' }).click();
      await page.getByText('Claimed by Carter', { exact: true }).waitFor();
      const claim = api.writes.find(w => w.method === 'POST' && w.key.startsWith('bedrooms/'));
      assert.deepEqual([claim.key, claim.body.id, claim.body.trip, claim.body.coll, claim.body.data.name], ['bedrooms/destin-2027:b1', 'destin-2027:b1', 'destin-2027', 'bedrooms', 'Carter']);
      assert.equal(await page.locator('#bcount').textContent(), '2 of 9 booked');
      // Lightbox reads the room's own photos.
      await page.locator('#rooms-list .rthumb').first().click();
      await page.locator('#lb:not([hidden])').waitFor();
      assert.equal(await page.locator('#lb-cap').textContent(), fixture.rooms[0].name);
      assert.equal(await page.locator('#lb-dots i').count(), 4);
      await page.keyboard.press('Escape');
      await page.locator('#sheet-x').click();
      // Plans are written with the trip id and prefix too.
      const first = page.locator('#days > .day').first();
      if (!(await first.locator('.day-body').isVisible())) await first.locator('.day-head').click();
      await first.locator('input[type=text]').fill('Sunset swim');
      await first.getByRole('button', { name: 'Add', exact: true }).click();
      await page.getByText('Sunset swim', { exact: true }).waitFor();
      const plan = api.writes.find(w => w.method === 'POST' && w.key.startsWith('plans/'));
      assert.match(plan.key, /^plans\/destin-2027:[a-z0-9]+$/);
      assert.equal(plan.body.trip, 'destin-2027');
      assert.equal(plan.body.data.day, '2027-03-28');
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no horizontal overflow');
      assert.deepEqual(errors, []);
      await page.screenshot({ path: join(shots, `fam-home-${width}.png`), fullPage: true });
      await context.close();
    }
    // A specific trip can be requested, and an unavailable API leaves a readable page.
    const chosen = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const chosenApi = await mock(chosen); const chosenPage = await chosen.newPage();
    await chosenPage.goto(origin + '/?trip=summer-2028', { waitUntil: 'domcontentloaded' });
    await chosenPage.getByRole('heading', { level: 1, name: fixture.trip.title }).waitFor();
    assert.deepEqual(chosenApi.tripRequests, ['?id=summer-2028']);
    await chosen.close();
    const down = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await mock(down, { tripStatus: 503 }); const downPage = await down.newPage(); const downErrors = []; downPage.on('pageerror', e => downErrors.push(e.message));
    await downPage.goto(origin + '/', { waitUntil: 'domcontentloaded' });
    await downPage.getByText('Trip details are temporarily unavailable. Please try again.', { exact: true }).waitFor();
    assert.equal(await downPage.locator('#itinerary').isVisible(), false);
    assert.equal(await downPage.locator('#reel-pause').isVisible(), false, 'no slideshow control without slides');
    assert.equal(await downPage.locator('.family-ribbon').isVisible(), true);
    assert.deepEqual(downErrors, []);
    await downPage.screenshot({ path: join(shots, 'fam-home-unavailable.png') });
    await down.close();
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
});
