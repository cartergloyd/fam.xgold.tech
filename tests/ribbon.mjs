import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, sep } from 'node:path';
import { chromium } from 'playwright';

const root = fileURLToPath(new URL('../', import.meta.url));
const paths = ['/', '/ff/', '/streaming/'];
const links = ['/', '/mc', '/streaming/', '/ff/', '/6108'];

async function startSite() {
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      const pathname = url.pathname.endsWith('/') ? `${url.pathname}index.html` : url.pathname;
      const file = resolve(root, `.${pathname}`);
      if (!file.startsWith(root.endsWith(sep) ? root : root + sep)) throw new Error('Invalid path');
      const body = await readFile(file);
      const type = file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : file.endsWith('.png') ? 'image/png' : 'text/html';
      res.writeHead(200, { 'Content-Type': type });
      res.end(body);
    } catch { res.writeHead(404); res.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return server;
}

test('every page uses the shared component without old streaming handlers', async () => {
  for (const path of paths) {
    const html = await readFile(resolve(root, `.${path}index.html`), 'utf8');
    assert.equal((html.match(/<family-ribbon>/g) || []).length, 1, path);
    assert.match(html, /src="\/ribbon\.js\?v=5" defer/);
    assert.doesNotMatch(html, /data-streaming|swiftfin:\/\/|jellyfin:\/\//);
  }
});

test('ribbon appearance and actual Streaming clicks agree on every page', async () => {
  const server = await startSite();
  const origin = process.env.FAM_TEST_URL || `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  try {
    for (const width of [320, 390, 600, 768, 1440]) {
      const context = await browser.newContext({
        viewport: { width, height: 900 },
        reducedMotion: 'no-preference',
        isMobile: width <= 390,
        hasTouch: width <= 390,
        ...(width <= 390 ? { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1' } : {}),
      });
      // Avoid family account/API calls while exercising the real page and navigation.
      await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
      let baseline;
      let compactBaseline;
      for (const path of paths) {
        const page = await context.newPage();
        let popups = 0;
        page.on('popup', () => popups++);
        await page.goto(origin + path, { waitUntil: 'domcontentloaded' });
        const nav = page.getByRole('navigation', { name: 'Family sites' });
        await nav.waitFor();
        await nav.locator('img').evaluateAll(imgs => Promise.all(imgs.map(img => img.decode())));
        assert.equal(await nav.locator('[aria-current="page"]').getAttribute('href'), path);
        assert.deepEqual(await nav.locator('a').evaluateAll(as => as.map(a => a.getAttribute('href'))), links);
        const layout = await nav.evaluate(nav => {
          const elements = [nav, ...nav.querySelectorAll('ul, li, a, img')];
          return elements.map(el => {
            const box = el.getBoundingClientRect(), s = getComputedStyle(el);
            return { x: box.x, y: box.y, width: box.width, height: box.height, font: s.font, gap: s.gap, padding: s.padding, margin: s.margin };
          });
        });
        if (baseline) assert.deepEqual(layout, baseline, `${path} differs at ${width}px`);
        else baseline = layout;
        assert(await nav.evaluate(nav => nav.scrollWidth <= innerWidth));
        // Isolate the sign-in overlay and allow scrolling even if API data is unavailable.
        await page.addStyleTag({ content: 'html { scroll-behavior: auto !important; } body { min-height: 2200px; } body > :not(family-ribbon) { visibility: hidden !important; }' });
        const geometry = () => nav.evaluate(nav => {
          const icons = [...nav.querySelectorAll('.family-ribbon-icon')].map(el => {
            const r = el.getBoundingClientRect();
            return { center: r.x + r.width / 2, width: r.width, top: r.y, bottom: r.bottom };
          });
          const labels = [...nav.querySelectorAll('.family-ribbon-label')].map(el => {
            const r = el.getBoundingClientRect();
            return { center: r.x + r.width / 2, top: r.y, height: r.height, opacity: getComputedStyle(el).opacity };
          });
          const r = nav.getBoundingClientRect();
          const account = nav.querySelector('.family-ribbon-account-avatar').getBoundingClientRect();
          return { icons, labels, account: { center: account.x + account.width / 2, top: account.y, width: account.width }, height: r.height, top: r.y, viewport: innerWidth };
        });
        const checkSpacing = state => {
          const row = state.viewport <= 1000 ? [...state.icons, state.account] : state.icons;
          if (state.viewport <= 1000) {
            assert(Math.abs((row[0].center + row[5].center) / 2 - state.viewport / 2) < 1, 'Six-icon row must be centered');
            assert(row.every(icon => Math.abs(icon.top - row[0].top) < 1), 'Account must be in line with the app icons');
          } else assert(Math.abs(state.icons[2].center - state.viewport / 2) < 1, 'Streaming must be centered on desktop');
          const gaps = row.slice(1).map((icon, i) => icon.center - row[i].center);
          assert(gaps.every(gap => Math.abs(gap - gaps[0]) < 1), 'All icon centers must be equally spaced');
        };
        const animateScroll = y => page.evaluate(y => new Promise(resolve => {
          const nav = document.querySelector('.family-ribbon');
          const icon = nav.querySelector('.family-ribbon-icon');
          const frames = [], started = performance.now();
          scrollTo(0, y);
          function sample(now) {
            frames.push({ width: icon.getBoundingClientRect().width, height: nav.getBoundingClientRect().height });
            if (now - started < 450) requestAnimationFrame(sample); else resolve(frames);
          }
          requestAnimationFrame(sample);
        }), y);
        const expanded = await geometry();
        checkSpacing(expanded);
        expanded.labels.forEach((label, i) => {
          assert(Math.abs(label.center - expanded.icons[i].center) < 1, 'Label must be centered under its icon');
          assert(label.top >= expanded.icons[i].bottom && label.height > 0);
        });
        if (path === '/' && [390, 1440].includes(width)) await nav.screenshot({ path: `/tmp/fam-ribbon-expanded-${width}.png` });
        const collapseFrames = await animateScroll(200);
        assert(collapseFrames.some(frame => frame.width > 29 && frame.width < expanded.icons[0].width - 1), 'Collapse has intermediate animation frames');
        assert(collapseFrames.every((frame, i) => !i || frame.width <= collapseFrames[i - 1].width + .5), 'Icons shrink without bouncing');
        const compact = await geometry();
        checkSpacing(compact);
        assert.equal(compact.top, 0, 'Ribbon must stay at the top when scrolled');
        assert(compact.height < expanded.height);
        assert(compact.icons.every((icon, i) => icon.width < expanded.icons[i].width && icon.top < expanded.icons[i].top));
        assert(compact.labels.every(label => label.opacity === '0'));
        assert(await page.locator('.family-ribbon-account-avatar').isVisible(), 'Guests retain a visible sign-in icon in compact mode');
        assert(await nav.locator('a').evaluateAll(as => as.every(a => a.getBoundingClientRect().height >= 44 && a.getAttribute('aria-label'))), 'Compact links retain touch targets and accessible names');
        if (compactBaseline) assert.deepEqual(compact, compactBaseline, `Compact ${path} differs at ${width}px`);
        else compactBaseline = compact;
        if (path === '/' && [390, 1440].includes(width)) await nav.screenshot({ path: `/tmp/fam-ribbon-compact-${width}.png` });
        // The stable host height prevents layout changes from toggling the scroll state.
        await page.evaluate(() => scrollTo(0, 35));
        await page.waitForTimeout(400);
        assert(await page.locator('family-ribbon').evaluate(el => el.hasAttribute('compact')));
        const expandFrames = await animateScroll(0);
        assert(expandFrames.some(frame => frame.width > 29 && frame.width < expanded.icons[0].width - 1), 'Expansion has intermediate animation frames');
        assert(expandFrames.every((frame, i) => !i || frame.width >= expandFrames[i - 1].width - .5), 'Icons expand without bouncing');
        assert.deepEqual(await geometry(), expanded, 'Returning to the top restores labels and spacing');
        // Exercise Streaming while the ribbon is collapsed too.
        await page.evaluate(() => scrollTo(0, 200));
        await page.waitForFunction(() => document.querySelector('family-ribbon').hasAttribute('compact'));
        await page.waitForTimeout(400);
        await Promise.all([
          page.waitForURL(origin + '/streaming/'),
          nav.getByRole('link', { name: 'Streaming', exact: true }).click(),
        ]);
        await page.waitForTimeout(1700); // Catch the old delayed app/store redirect too.
        assert.equal(page.url(), origin + '/streaming/', `${path}, ${width}px`);
        assert.equal(popups, 0, 'Streaming must open in the current tab');
        await page.close();
      }
      await context.close();
    }
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
});

test('shared account control signs in, switches people and follows the responsive icon row', async () => {
  const server = await startSite();
  const origin = process.env.FAM_TEST_URL || `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  try {
    for (const width of [320, 390, 1440]) {
      for (const path of paths) {
        const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });
        const users = [
          { id: 'test-carter', name: 'Carter', registered: true, group_id: 'test-family', photo_url: 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#765c40"/><text x="32" y="44" font-size="36" text-anchor="middle">C</text></svg>') },
          { id: 'test-alex', name: 'Alexandria Montgomery', registered: false, group_id: 'test-family', photo_url: '' },
        ];
        const requests = [];
        await context.route('**/*', async route => {
          const request = route.request(), url = new URL(request.url());
          if (url.hostname === 'fam-api.xgold.tech' && url.pathname.startsWith('/family/')) {
            const endpoint = url.pathname.slice('/family/'.length), body = request.postDataJSON();
            requests.push({ endpoint, body });
            let response;
            if (endpoint === 'users') response = { users };
            else if (endpoint === 'lookup') response = { user: body.email === 'carter@example.test' ? users[0] : users[1].registered ? users[1] : null };
            else if (endpoint === 'login') {
              if (body.pin === '0000') { await route.fulfill({ status: 401, json: { error: 'Incorrect PIN.' } }); return; }
              assert.equal(body.pin, '1234');
              response = { user: users[0] };
            } else if (endpoint === 'register') {
              assert.equal(body.pin, '5678'); assert.equal(body.id, users[1].id);
              users[1].registered = true; response = { user: users[1] };
            } else throw new Error('Unexpected account endpoint');
            await route.fulfill({ json: response });
          } else if (url.origin === origin) await route.continue();
          else await route.abort();
        });
        const page = await context.newPage(), errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.goto(origin + path, { waitUntil: 'domcontentloaded' });
        await page.evaluate(() => window.familyAccount.ready);
        if (path === '/') await page.waitForFunction(() => document.querySelectorAll('#days > li').length === 8);
        const account = page.locator('.family-ribbon-account');
        assert.equal(await page.locator('#me').count(), 0, 'Old hero control must be removed');
        assert.equal(await account.getAttribute('aria-label'), 'Sign in');
        assert.equal(await account.locator('.family-ribbon-account-avatar').isVisible(), true);
        await account.click();
        await page.getByRole('dialog', { name: 'Sign in to the family.' }).waitFor();
        assert.equal(page.url(), origin + path, 'Account opens on the current page');
        await page.locator('#g-email').fill('carter@example.test');
        await page.locator('#g-known').waitFor();
        await page.locator('#g-pin').fill('0000');
        await page.locator('#g-enter').click();
        await page.getByText('Incorrect PIN.', { exact: true }).waitFor();
        assert.equal(await page.evaluate(() => localStorage.getItem('destin-who')), null);
        assert.equal(await page.locator('#g-pin').inputValue(), '');
        await page.locator('#g-pin').fill('1234');
        await page.locator('#g-enter').click();
        await page.locator('#gate').waitFor({ state: 'hidden' });
        assert.match(await account.getAttribute('aria-label'), /Signed in as Carter/);
        const state = await account.evaluate(button => {
          const name = button.querySelector('.family-ribbon-account-name'), avatar = button.querySelector('.family-ribbon-account-avatar');
          const n = name.getBoundingClientRect(), a = avatar.getBoundingClientRect(), b = button.getBoundingClientRect();
          return { nameRight: n.right, avatarLeft: a.left, buttonRight: b.right, nameTop: n.top, avatarBottom: a.bottom, nameCenter: n.x + n.width / 2, avatarCenter: a.x + a.width / 2, textAlign: getComputedStyle(name).textAlign, viewport: innerWidth };
        });
        if (width > 1000) {
          assert.equal(state.textAlign, 'right');
          assert(state.avatarLeft - state.nameRight >= 0 && state.avatarLeft - state.nameRight <= 9, 'Name hugs the avatar on its left');
        } else {
          assert(state.nameTop >= state.avatarBottom && Math.abs(state.nameCenter - state.avatarCenter) < 1, 'Mobile account label belongs below its sixth icon');
        }
        assert(state.viewport - state.buttonRight <= 16, 'Account is anchored to the right');
        const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('destin-who')));
        assert.deepEqual(stored, { name: 'Carter', email: 'carter@example.test' }, 'PIN must not be stored');
        await page.addStyleTag({ content: 'html { scroll-behavior: auto !important; } body { min-height: 2200px; }' });
        if (path === '/' && [390, 1440].includes(width)) await page.locator('family-ribbon').screenshot({ path: `/tmp/fam-account-expanded-${width}.png` });
        await page.evaluate(() => scrollTo(0, 200));
        await page.waitForFunction(() => document.querySelector('family-ribbon').hasAttribute('compact'));
        const compact = await page.locator('.family-ribbon').evaluate(nav => {
          const name = nav.querySelector('.family-ribbon-account-name'), avatar = nav.querySelector('.family-ribbon-account-avatar').getBoundingClientRect();
          const icons = [...nav.querySelectorAll('.family-ribbon-icon')].map(el => el.getBoundingClientRect());
          return { nameWidth: name.getBoundingClientRect().width, nameOpacity: getComputedStyle(name).opacity, avatarWidth: avatar.width, avatarLeft: avatar.left, lastIconRight: icons[4].right, middle: icons[2].x + icons[2].width / 2, viewport: innerWidth, backdrop: getComputedStyle(nav).backdropFilter, background: getComputedStyle(nav).backgroundColor };
        });
        assert.equal(compact.nameOpacity, '0'); assert(Math.abs(compact.avatarWidth - 28) < .01);
        assert(compact.lastIconRight < compact.avatarLeft, 'Account must not overlap the navigation icons');
        if (width > 1000) assert(Math.abs(compact.middle - compact.viewport / 2) < 1, 'Streaming remains centered on desktop');
        assert.match(compact.backdrop, /blur/); assert.match(compact.background, /rgba/);
        if (path === '/' && [390, 1440].includes(width)) await page.locator('.family-ribbon').screenshot({ path: `/tmp/fam-account-compact-${width}.png` });
        await account.click();
        await page.locator('#g-email').waitFor({ state: 'visible' });
        await page.locator('#g-email').fill('alex@example.test');
        await page.locator('#g-new').waitFor();
        await page.locator('#g-signup').click();
        await page.locator('#dd-btn').click();
        await page.getByRole('option', { name: 'Alexandria Montgomery' }).click();
        await page.locator('#g-pin').fill('5678');
        await page.locator('#g-go').click();
        await page.locator('#gate').waitFor({ state: 'hidden' });
        assert.match(await account.getAttribute('aria-label'), /Signed in as Alexandria Montgomery/);
        assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('destin-who')).name), 'Alexandria Montgomery');
        await account.click();
        await page.locator('#g-email').waitFor({ state: 'visible' });
        await page.keyboard.press('Escape');
        await page.locator('#gate').waitFor({ state: 'hidden' });
        assert(await account.evaluate(button => button === document.activeElement), 'Closing sign-in restores focus to the account');
        assert.equal(requests.filter(r => r.endpoint === 'login').length, 2);
        assert.equal(requests.filter(r => r.endpoint === 'register').length, 1);
        assert.deepEqual(errors, [], `No page errors on ${path}`);
        await context.close();
      }
    }
    // A saved session on any page should restore the same avatar and name.
    const context = await browser.newContext({ viewport: { width: 390, height: 900 } });
    await context.addInitScript(() => localStorage.setItem('destin-who', JSON.stringify({ name: 'Carter', email: 'carter@example.test' })));
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.hostname === 'fam-api.xgold.tech' && url.pathname === '/family/users') return route.fulfill({ json: { users: [{ name: 'Carter', photo_url: '', registered: true }] } });
      return url.origin === origin ? route.continue() : route.abort();
    });
    for (const path of paths) {
      const page = await context.newPage();
      await page.goto(origin + path, { waitUntil: 'domcontentloaded' });
      await page.evaluate(() => window.familyAccount.ready);
      assert.match(await page.locator('.family-ribbon-account').getAttribute('aria-label'), /Signed in as Carter/);
      await page.locator('.family-ribbon-account img').evaluate(image => image.decode());
      await page.close();
    }
    await context.close();
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
});
