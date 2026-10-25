import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import vm from 'node:vm';
let browser, server, origin;
const root = fileURLToPath(new URL('../', import.meta.url));
before(async () => {
  server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      const path = resolve(root, '.' + url.pathname + (url.pathname.endsWith('/') ? 'index.html' : ''));
      if (!path.startsWith(root)) throw new Error('Invalid path');
      res.setHeader('Content-Type', path.endsWith('.js') ? 'text/javascript' : path.endsWith('.css') ? 'text/css' : path.endsWith('.png') ? 'image/png' : 'text/html');
      res.end(await readFile(path));
    } catch { res.writeHead(404); res.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = process.env.FAM_TEST_URL || `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
});
after(async () => { await browser.close(); await new Promise(resolve => server.close(resolve)); });
async function setup(path = '/', options = {}) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce', ...options });
  const requests = [];
  const users = [
    { id: 'chester', name: 'Chester', first_name: 'Chester', last_name: 'Gloyd', registered: false },
    { id: 'rick', name: 'Rick', first_name: 'Rick', last_name: 'Smith', registered: false },
    { id: 'carter', name: 'Carter', registered: true },
  ];
  await context.route('**/*', async route => {
    const req = route.request(), url = new URL(req.url());
    if (url.hostname === 'fam-api.xgold.tech' && url.pathname.startsWith('/family/')) {
      const endpoint = url.pathname.split('/').pop(), body = req.postDataJSON(); requests.push({ endpoint, body });
      if (endpoint === 'recent.json') return route.fulfill({ json: { posters: Array.from({length: 24}, (_, i) => ({ image: '/family/streaming-artwork/' + i.toString(16).padStart(32, '0') + '.jpg' })) } });
      if (endpoint.endsWith('.jpg')) return route.fulfill({ contentType: 'image/png', body: await readFile(resolve(root, 'assets/app-icons/jellyfin.png')) });
      if (endpoint === 'users') return route.fulfill({ json: { users } });
      if (endpoint === 'lookup') return route.fulfill({ json: { user: body.email.endsWith('@registered.test') ? users[2] : null } });
      if (endpoint === 'register') { assert.equal(body.id, 'chester'); assert.equal(body.pin, '0031'); return route.fulfill({ json: { user: users[0] } }); }
      throw new Error('Unexpected account mutation in profile test');
    }
    if (url.origin === 'https://streaming.xgold.tech') return route.fulfill({ contentType: 'text/html', body: 'Jellyfin test destination' });
    if (url.origin === origin) return route.continue();
    return route.abort();
  });
  const page = await context.newPage();
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto(origin + path, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => window.familyAccount.ready);
  return { context, page, requests, errors };
}
test('profile is suggested at @, then confirmed before a PIN can register it', async () => {
  const { context, page, requests, errors } = await setup();
  await page.locator('.family-ribbon-account').click();
  await page.getByRole('dialog', { name: 'Please Sign-in' }).waitFor();
  assert(!await page.getByText('Anyone can look around without signing in.', { exact: true }).count());
  await page.locator('#g-email').fill('chester.gloyd');
  assert.equal(await page.locator('#g-guess').isVisible(), false);
  await page.locator('#g-email').fill('chester.gloyd@');
  await page.getByText('Is this Chester?', { exact: true }).waitFor();
  assert.equal(await page.locator('#g-guess-go').isDisabled(), true);
  assert.equal(requests.filter(r => r.endpoint === 'lookup').length, 0, 'Incomplete addresses stay local');
  assert.equal(requests.filter(r => r.endpoint === 'register').length, 0);
  await page.locator('#gate').screenshot({ path: '/tmp/fam-profile-guess.png' });
  await page.locator('#g-email').fill('chester.gloyd@example.test');
  await page.waitForFunction(() => !document.getElementById('g-guess-go').disabled);
  await page.locator('#g-guess-go').click();
  await page.waitForFunction(() => document.getElementById('dd-val').textContent === 'Chester');
  assert.equal(await page.locator('#dd-val').textContent(), 'Chester');
  await page.locator('#g-pin').fill('0031');
  await page.locator('#g-go').click();
  await page.locator('#gate').waitFor({ state: 'hidden' });
  assert.equal(requests.filter(r => r.endpoint === 'register').length, 1);
  assert.equal(await page.evaluate(() => window.familyAccount.current.name), 'Chester');
  assert.deepEqual(errors, []);
  await context.close();
});
test('initial plus surname works; exact registered email overrides a suggested profile', async () => {
  const { context, page, requests } = await setup('/ff/');
  await page.locator('.family-ribbon-account').click();
  await page.locator('#g-email').fill('r.smith@');
  await page.getByText('Is this Rick?', { exact: true }).waitFor();
  await page.locator('#g-email').fill('chester.gloyd@registered.test');
  await page.locator('#g-known').waitFor();
  assert.equal(await page.locator('#g-welcome').textContent(), 'Welcome back, Carter');
  assert.equal(await page.locator('#g-guess').isVisible(), false);
  await page.locator('#g-email').fill('carter@unknown.test');
  await page.getByText('Is this Carter?', { exact: true }).waitFor();
  assert.equal(await page.locator('#g-guess-go').isDisabled(), true);
  assert.equal(requests.filter(r => ['register', 'login'].includes(r.endpoint)).length, 0);
  await context.close();
});
test('Streaming keeps the shared ribbon, current login instructions, and desktop destination', async () => {
  const { context, page, errors } = await setup('/streaming/', { viewport: { width: 1440, height: 900 } });
  assert.equal(await page.getByRole('heading', { level: 1 }).textContent(), 'Watch from anywhere.');
  assert.equal(await page.locator('main ol > li').count(), 2);
  assert.match(await page.locator('main ol > li').first().textContent(), /Connect to our server/);
  assert.equal(await page.getByText('Watch in your browser', { exact: true }).count(), 0);
  assert.equal(await page.getByText('Open Jellyfin', { exact: true }).count(), 0);
  await page.locator('.streaming-hero.has-artwork').waitFor();
  assert.match(await page.locator('main').textContent(), /four-digit family PIN as the password/);
  assert.doesNotMatch(await page.locator('main').textContent(), /currently unavailable|password Carter gives|Discord Watch Party/);
  await page.screenshot({ path: '/tmp/fam-streaming-desktop.png', fullPage: true });
  await page.locator('#streaming-signin').click();
  await page.getByRole('dialog', { name: 'Please Sign-in' }).waitFor();
  await page.locator('#g-close').click();
  await page.locator('#gate').waitFor({ state: 'hidden' });
  await Promise.all([page.waitForURL('https://streaming.xgold.tech/'), page.locator('#open-jellyfin').click()]);
  assert.deepEqual(errors, []);
  await context.close();
});
test('mobile launch points to the selected Jellyfin Mobile app and appropriate store', async () => {
  for (const [ua, expected] of [
    ['Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)', 'org.jellyfin.expo://'],
    ['Mozilla/5.0 (Linux; Android 14)', 'https://play.google.com/store/apps/details?id=org.jellyfin.mobile'],
  ]) {
    const { context, page } = await setup('/streaming/', { userAgent: ua });
    assert.equal(await page.locator('#open-jellyfin').getAttribute('href'), expected);
    if (ua.includes('iPhone')) await page.screenshot({ path: '/tmp/fam-streaming-mobile.png', fullPage: true });
    assert(await page.locator('main').evaluate(el => el.scrollWidth <= innerWidth));
    await context.close();
  }
});
test('iPhone store fallback runs only while the page stays visible and cancels when the app opens', async () => {
  const source = await readFile(new URL('../streaming/launch.js', import.meta.url), 'utf8');
  for (const appOpens of [false, true]) {
    const events = {}, nodes = {}, timers = new Map(), navigations = [];
    const node = id => nodes[id] ||= { addEventListener(type, handler) { this[type] = handler; } };
    const document = { hidden: false, getElementById: node, addEventListener(type, handler) { events[type] = handler; } };
    const window = { addEventListener(type, handler) { events[type] = handler; }, familyAccount: { current: null, ready: Promise.resolve() } };
    vm.runInNewContext(source, { navigator: { userAgent: 'iPhone', maxTouchPoints: 1 }, document, window, location: { assign: url => navigations.push(url) }, Date,
      setTimeout(fn) { timers.set(1, fn); return 1; }, clearTimeout(id) { timers.delete(id); } });
    node('open-jellyfin').click();
    if (appOpens) { document.hidden = true; events.visibilitychange(); }
    for (const fn of timers.values()) fn();
    assert.deepEqual(navigations, appOpens ? [] : ['https://apps.apple.com/app/jellyfin-mobile/id1480192618']);
  }
});

test('recent artwork slides smoothly, pauses on demand, and respects reduced motion', async () => {
  const { context, page, errors } = await setup('/streaming/', { reducedMotion: 'no-preference', viewport: { width: 1440, height: 900 } });
  await page.locator('.streaming-hero.has-artwork').waitFor();
  assert.equal(await page.locator('.artwork-row').count(), 2);
  assert.equal(await page.locator('.artwork-row img').count(), 48);
  const position = () => page.locator('.artwork-row').first().evaluate(el => getComputedStyle(el).transform);
  const start = await position(); await page.waitForTimeout(100); assert.notEqual(await position(), start);
  await page.getByRole('button', { name: 'Pause artwork' }).click();
  assert.equal(await page.getByRole('button', { name: 'Play artwork' }).getAttribute('aria-pressed'), 'true');
  await page.waitForTimeout(100); const stopped = await position(); await page.waitForTimeout(100); assert.equal(await position(), stopped);
  await page.getByRole('button', { name: 'Play artwork' }).click();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  assert.equal(await page.locator('.artwork-row').first().evaluate(el => getComputedStyle(el).animationName), 'none');
  assert.equal(await page.locator('#artwork-pause').isVisible(), false);
  assert.deepEqual(errors, []);
  await context.close();
});
test('an unavailable artwork feed leaves the launch and setup usable', async () => {
  const { context, page } = await setup('/streaming/');
  await context.route('**/streaming-artwork/recent.json', route => route.fulfill({ status:503, body:'Unavailable' }));
  await page.reload();
  assert.equal(await page.locator('#open-jellyfin').isVisible(), true);
  assert.equal(await page.locator('main ol > li').count(), 2);
  assert.equal(await page.locator('#artwork-pause').isVisible(), false);
  await context.close();
});
