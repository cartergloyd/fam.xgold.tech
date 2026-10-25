import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

test('artwork endpoint only serves generated files with bounded caching', async () => {
  const source = (await readFile(new URL('../deploy/streaming-artwork/endpoint.js', import.meta.url), 'utf8')).replace("import path from 'node:path';", '').replace('export default function', 'function');
  let handler;
  const router = { get(route, fn) { assert.equal(route, '/streaming-artwork/:file'); handler = fn; } };
  vm.runInNewContext(source + '\nstreamingArtwork(router);', { router, path: { join: (...parts) => parts.join('/') } });
  for (const file of ['../config.json','config.json','recent.json.tmp','abc.jpg','a'.repeat(32)+'.png']) {
    handler({ params:{file} }, { sendStatus(status) { assert.equal(status,404); } });
  }
  for (const file of ['recent.json','a'.repeat(32)+'.jpg']) {
    const headers = {};
    handler({ params:{file} }, { set(k,v) { headers[k]=v; }, type() {}, sendFile(target) {
      assert.equal(target, '/directus/uploads/streaming-artwork/' + file);
    } });
    assert.match(headers['Cache-Control'], file === 'recent.json' ? /max-age=300/ : /max-age=86400/);
    assert.equal(headers['X-Content-Type-Options'],'nosniff');
  }
});
