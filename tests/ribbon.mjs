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

test('every page uses the shared component without old streaming handlers', async () => {
  for (const path of paths) {
    const html = await readFile(resolve(root, `.${path}index.html`), 'utf8');
    assert.equal((html.match(/<family-ribbon>/g) || []).length, 1, path);
    assert.match(html, /src="\/ribbon\.js\?v=3" defer/);
    assert.doesNotMatch(html, /data-streaming|swiftfin:\/\/|jellyfin:\/\//);
  }
});

test('ribbon appearance and actual Streaming clicks agree on every page', async () => {
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
  const origin = process.env.FAM_TEST_URL || `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  try {
    for (const width of [320, 390, 600, 768, 1440]) {
      const context = await browser.newContext({
        viewport: { width, height: 900 },
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
          return { icons, labels, height: r.height, top: r.y, viewport: innerWidth };
        });
        const checkSpacing = state => {
          assert(Math.abs(state.icons[2].center - state.viewport / 2) < 1, 'Streaming must be centered');
          const gaps = state.icons.slice(1).map((icon, i) => icon.center - state.icons[i].center);
          assert(gaps.every(gap => Math.abs(gap - gaps[0]) < 1), 'All icon centers must be equally spaced');
        };
        const expanded = await geometry();
        checkSpacing(expanded);
        expanded.labels.forEach((label, i) => {
          assert(Math.abs(label.center - expanded.icons[i].center) < 1, 'Label must be centered under its icon');
          assert(label.top >= expanded.icons[i].bottom && label.height > 0);
        });
        if (path === '/' && [390, 1440].includes(width)) await nav.screenshot({ path: `/tmp/fam-ribbon-expanded-${width}.png` });
        await page.evaluate(() => scrollTo(0, 200));
        await page.waitForFunction(() => document.querySelector('family-ribbon').hasAttribute('compact'));
        await page.waitForTimeout(250);
        const compact = await geometry();
        checkSpacing(compact);
        assert.equal(compact.top, 0, 'Ribbon must stay at the top when scrolled');
        assert(compact.height < expanded.height);
        assert(compact.icons.every((icon, i) => icon.width < expanded.icons[i].width && icon.top < expanded.icons[i].top));
        assert(compact.labels.every(label => label.height === 0 && label.opacity === '0'));
        assert(await nav.locator('a').evaluateAll(as => as.every(a => a.getBoundingClientRect().height >= 44 && a.getAttribute('aria-label'))), 'Compact links retain touch targets and accessible names');
        if (compactBaseline) assert.deepEqual(compact, compactBaseline, `Compact ${path} differs at ${width}px`);
        else compactBaseline = compact;
        if (path === '/' && [390, 1440].includes(width)) await nav.screenshot({ path: `/tmp/fam-ribbon-compact-${width}.png` });
        // The stable host height prevents layout changes from toggling the scroll state.
        await page.evaluate(() => scrollTo(0, 35));
        await page.waitForTimeout(250);
        assert(await page.locator('family-ribbon').evaluate(el => el.hasAttribute('compact')));
        await page.evaluate(() => scrollTo(0, 0));
        await page.waitForFunction(() => !document.querySelector('family-ribbon').hasAttribute('compact'));
        await page.waitForTimeout(250);
        assert.deepEqual(await geometry(), expanded, 'Returning to the top restores labels and spacing');
        // Exercise Streaming while the ribbon is collapsed too.
        await page.evaluate(() => scrollTo(0, 200));
        await page.waitForFunction(() => document.querySelector('family-ribbon').hasAttribute('compact'));
        await page.waitForTimeout(250);
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
