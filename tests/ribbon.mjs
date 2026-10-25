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
    assert.match(html, /src="\/ribbon\.js\?v=2" defer/);
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
        // Isolate navigation from Home's sign-in overlay without supplying credentials.
        await page.addStyleTag({ content: 'body > :not(family-ribbon) { visibility: hidden !important; }' });
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
