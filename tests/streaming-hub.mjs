import { test } from 'node:test';
import assert from 'node:assert/strict';
import streamingHub, { startingState, canChangeRole, posterUrl, shapeTitle, deriveMovie, deriveSeries } from '../deploy/streaming-hub/endpoint.js';

test('only trusted people and admins skip approval; everyone else, including unknown roles, waits', () => {
  assert.equal(startingState('standard'), 'pending');
  assert.equal(startingState('trusted'), 'approved');
  assert.equal(startingState('admin'), 'approved');
  assert.equal(startingState(undefined), 'pending');
  assert.equal(startingState('ADMIN'), 'pending');
});

test('role changes: admins only, known roles only, never remove the last admin', () => {
  const admin = { streaming_role: 'admin' }, trusted = { streaming_role: 'trusted' };
  assert.equal(canChangeRole(admin, trusted, 'admin', 1), null);
  assert.match(canChangeRole(trusted, admin, 'standard', 2), /Only an admin/);
  assert.match(canChangeRole(admin, trusted, 'root', 1), /Unknown role/);
  assert.match(canChangeRole(admin, admin, 'standard', 1), /at least one admin/);
  assert.equal(canChangeRole(admin, admin, 'standard', 2), null);
});

test('only TMDB and TheTVDB artwork is passed to browsers', () => {
  assert.equal(posterUrl([{ coverType: 'poster', remoteUrl: 'https://image.tmdb.org/t/p/original/a.jpg' }]), 'https://image.tmdb.org/t/p/w342/a.jpg');
  assert.equal(posterUrl([{ coverType: 'poster', remoteUrl: 'https://artworks.thetvdb.com/banners/posters/1-8.jpg' }]), 'https://artworks.thetvdb.com/banners/posters/1-8.jpg');
  assert.equal(posterUrl([{ coverType: 'poster', remoteUrl: 'http://127.0.0.1/secret.jpg' }]), null);
  assert.equal(posterUrl([{ coverType: 'poster', remoteUrl: 'https://evil.example/image.tmdb.org/x.jpg' }]), null);
  assert.equal(posterUrl([{ coverType: 'fanart', remoteUrl: 'https://image.tmdb.org/t/p/original/a.jpg' }]), null);
  assert.equal(posterUrl(undefined), null);
});

test('titles keep only what the page needs and never expose upstream fields', () => {
  const t = shapeTitle('sonarr', { tmdbId: 1396, tvdbId: 81189, title: 'Breaking Bad', year: 2008, path: '/secret', seasons: [{ seasonNumber: 0 }, { seasonNumber: 1 }, { seasonNumber: 2 }], images: [], ratings: { value: 9 } });
  assert.deepEqual(t.seasons, [1, 2]); assert.equal(t.type, 'tv'); assert.equal(t.tmdbId, '1396'); assert.equal(t.path, undefined); assert.equal(t.rating, 9);
});

const row = { decided_at: '2026-11-17T00:00:00Z', date_created: '2026-11-17T00:00:00Z' };
const at = hours => Date.parse('2026-11-17T00:00:00Z') + hours * 3600000;
test('movie status follows Radarr and Jellyfin', () => {
  assert.equal(deriveMovie(row, null, null, null, at(0)).state, 'approved');
  assert.equal(deriveMovie(row, { isAvailable: true }, null, null, at(1)).detail, 'Looking for a release.');
  assert.match(deriveMovie(row, { isAvailable: true }, null, null, at(7)).detail, /Still looking/);
  assert.match(deriveMovie(row, { isAvailable: false }, null, null, at(1)).detail, /Not released yet/);
  const downloading = deriveMovie(row, { id: 1 }, { size: 100, sizeleft: 25, trackedDownloadStatus: 'ok', trackedDownloadState: 'downloading' }, null, at(1));
  assert.deepEqual([downloading.state, downloading.progress], ['downloading', 0.75]);
  const stuck = deriveMovie(row, { id: 1 }, { size: 100, sizeleft: 25, trackedDownloadStatus: 'warning', trackedDownloadState: 'importBlocked', statusMessages: [{ title: 'x', messages: ['No video files were found'] }] }, null, at(1));
  assert.equal(stuck.problem, true); assert.match(stuck.detail, /No video files were found/);
  assert.equal(deriveMovie(row, { hasFile: true }, null, null, at(1)).state, 'importing');
  assert.equal(deriveMovie(row, { hasFile: true }, null, 'jf-id', at(1)).state, 'available');
});

test('series are only available when every aired episode is in the library and Jellyfin has it', () => {
  const series = (have, total, extra = {}) => ({ statistics: { episodeFileCount: have, episodeCount: total, totalEpisodeCount: total }, ...extra });
  assert.equal(deriveSeries(row, series(10, 10), [], 'jf', at(1)).state, 'available');
  const partial = deriveSeries(row, series(3, 10), [], 'jf', at(1));
  assert.equal(partial.state, 'searching'); assert.equal(partial.watchable, true); assert.match(partial.detail, /3 of 10 episodes ready/);
  assert.equal(deriveSeries(row, series(10, 10), [], null, at(1)).state, 'importing');
  const q = deriveSeries(row, series(0, 10), [{ size: 100, sizeleft: 50, trackedDownloadStatus: 'ok' }, { size: 100, sizeleft: 100, trackedDownloadStatus: 'ok' }], null, at(1));
  assert.deepEqual([q.state, q.progress], ['downloading', 0.25]);
  assert.match(deriveSeries(row, { statistics: { episodeFileCount: 0, episodeCount: 0, totalEpisodeCount: 8 } }, [], null, at(1)).detail, /Not aired yet/);
});

// Route-level checks with a stand-in database: sign-in and role gates run before any upstream call.
test('routes refuse anonymous callers, wrong origins and non-admins', async () => {
  const handlers = {};
  const router = { get: (p, fn) => handlers['GET ' + p] = fn, post: (p, fn) => handlers['POST ' + p] = fn };
  const database = table => ({ where: () => ({ first: async () => null }) });
  streamingHub(router, { database }, { noSync: true, secret: 's', sessionUser: async () => null, logger: { error() {}, warn() {} }, config: async () => { throw Error('should not be reached'); } });
  const call = async (key, { origin = 'https://fam.xgold.tech', session = '' } = {}) => {
    const out = {}; const res = { set() {}, status(c) { out.status = c; return res; }, json(d) { out.body = d; return res; } };
    await handlers[key]({ get: h => h === 'Origin' ? origin : h === 'X-Family-Session' ? session : '', query: {}, params: { id: 'x' }, body: {}, ip: 'test' }, res);
    return out;
  };
  for (const key of ['GET /streaming/me', 'GET /streaming/discover', 'GET /streaming/search', 'POST /streaming/requests', 'GET /streaming/requests', 'POST /streaming/requests/:id/approve', 'POST /streaming/requests/:id/deny', 'GET /streaming/admin/users', 'POST /streaming/admin/users/:id/role', 'GET /streaming/admin/health'])
    assert.equal((await call(key)).status, 401, key);
  assert.equal((await call('POST /streaming/requests', { origin: 'https://evil.example' })).status, 403);
  assert.equal((await call('POST /streaming/admin/users/:id/role', { origin: '' })).status, 403);
});
