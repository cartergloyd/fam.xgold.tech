import { readFile } from 'node:fs/promises';

// Streaming hub: discovery, requests, approvals and live status for the family site.
// Request state lives in PostgreSQL (family_streaming_requests); Radarr/Sonarr do the work; Jellyfin says what is watchable.
// Browsers never see an Arr/Jellyfin key: they only talk to these routes, signed in with the family session.
const ORIGIN = 'https://fam.xgold.tech';
const ROLES = ['standard', 'trusted', 'admin'];
const OPEN = ['pending', 'approved', 'searching', 'downloading', 'importing'];
const PROFILE = 'Family 4K to 1080p';
const SYNC_MS = 30000;

const fail = (status, message) => Object.assign(Error(message), { status });
export const clean = (value, max = 300) => typeof value === 'string' ? value.slice(0, max) : null;
// Posters come from Radarr/Sonarr metadata; only these two image hosts are passed on, and TMDB gets a phone-sized rendition.
export const posterUrl = images => {
  const url = (images || []).find(i => i.coverType === 'poster')?.remoteUrl || '';
  if (/^https:\/\/image\.tmdb\.org\/t\/p\/original\/[\w.-]+$/.test(url)) return url.replace('/original/', '/w342/');
  return /^https:\/\/artworks\.thetvdb\.com\/[\w./-]+$/.test(url) ? url : null;
};
export const shapeTitle = (kind, item) => ({
  type: kind === 'radarr' ? 'movie' : 'tv', tmdbId: String(item.tmdbId), title: item.title, year: item.year || null, poster: posterUrl(item.images),
  overview: clean(item.overview, 600), genres: (item.genres || []).slice(0, 3), runtime: item.runtime || null, certification: item.certification || null,
  rating: item.ratings?.tmdb?.value || item.ratings?.imdb?.value || item.ratings?.value || null,
  seasons: kind === 'sonarr' ? (item.seasons || []).filter(s => s.seasonNumber > 0).map(s => s.seasonNumber) : undefined,
  tvdbId: kind === 'sonarr' && item.tvdbId ? String(item.tvdbId) : undefined, released: kind === 'radarr' ? item.status === 'released' : undefined,
});
// Trusted people and admins skip the queue; everyone else waits for an admin.
export const startingState = role => role === 'trusted' || role === 'admin' ? 'approved' : 'pending';
export const canChangeRole = (actor, target, role, adminCount) => {
  if (actor.streaming_role !== 'admin') return 'Only an admin can change roles.';
  if (!ROLES.includes(role)) return 'Unknown role.';
  if (target.streaming_role === 'admin' && role !== 'admin' && adminCount <= 1) return 'There must always be at least one admin.';
  return null;
};
const norm = text => String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, '');

// What a request looks like right now, from Radarr (movie) and the Jellyfin library. Pure, so it is unit tested.
export function deriveMovie(row, movie, queued, jellyfinId, now = Date.now()) {
  if (jellyfinId) return { state: 'available', progress: 1, detail: null };
  if (!movie) return { state: 'approved', progress: null, detail: 'Handing this to the download system.' };
  if (queued) {
    const done = queued.size ? 1 - queued.sizeleft / queued.size : 0;
    const problem = queued.statusMessages?.flatMap(m => m.messages || [m.title]).find(Boolean) || queued.errorMessage;
    if (['importPending', 'importing', 'imported'].includes(queued.trackedDownloadState)) return { state: 'importing', progress: 1, detail: 'Downloaded. Adding it to the library.' };
    if (queued.trackedDownloadStatus !== 'ok' && problem) return { state: 'downloading', progress: done, detail: `Needs attention: ${problem}`, problem: true };
    return { state: 'downloading', progress: done, detail: null };
  }
  if (movie.hasFile) return { state: 'importing', progress: 1, detail: 'Downloaded. Waiting for Jellyfin to pick it up.' };
  if (!movie.isAvailable) return { state: 'searching', progress: null, detail: 'Not released yet. It will download as soon as it is out.' };
  const hours = (now - new Date(row.decided_at || row.date_created)) / 3600000;
  return { state: 'searching', progress: null, detail: hours > 6 ? 'No matching release found yet. Still looking.' : 'Looking for a release.' };
}
export function deriveSeries(row, series, queue, jellyfinId, now = Date.now()) {
  const have = series?.statistics?.episodeFileCount || 0, total = series?.statistics?.episodeCount || 0;
  const watchable = !!jellyfinId && have > 0;
  if (!series) return { state: 'approved', progress: null, detail: 'Handing this to the download system.' };
  if (total > 0 && have >= total && jellyfinId) return { state: 'available', progress: 1, detail: null };
  const count = have && total ? `${have} of ${total} episodes ready. ` : '';
  if (queue.length) {
    const size = queue.reduce((n, q) => n + (q.size || 0), 0), left = queue.reduce((n, q) => n + (q.sizeleft || 0), 0);
    const problem = queue.find(q => q.trackedDownloadStatus !== 'ok');
    const pm = problem && (problem.statusMessages?.flatMap(m => m.messages || [m.title]).find(Boolean) || problem.errorMessage);
    return { state: 'downloading', progress: size ? 1 - left / size : 0, detail: pm ? `Needs attention: ${pm}` : count.trim() || null, problem: !!pm, watchable };
  }
  if (have && have >= total) return { state: 'importing', progress: 1, detail: 'Downloaded. Waiting for Jellyfin to pick it up.', watchable };
  if (!total && (series.statistics?.totalEpisodeCount || 0) > 0) return { state: 'searching', progress: null, detail: 'Not aired yet. Episodes download as they come out.' };
  const hours = (now - new Date(row.decided_at || row.date_created)) / 3600000;
  return { state: 'searching', progress: have && total ? have / total : null, detail: count + (hours > 6 ? 'No matching release found yet. Still looking.' : 'Looking for releases.'), watchable };
}

export default function streamingHub(router, { database }, options = {}) {
  const logger = options.logger || console;
  const secret = () => options.secret || process.env.SECRET;
  const loadConfig = options.config || (() => readFile(new URL('../.family-media.json', import.meta.url), 'utf8').then(JSON.parse));
  const upstream = options.fetch || fetch;
  const now = options.now || Date.now;

  // ---- upstream clients (server side only) ----
  const client = async name => {
    const c = (await loadConfig())[name];
    if (!c?.url || !c.api_key) throw Error(`${name} is not configured`);
    const call = async (method, path, body) => {
      const r = await upstream(c.url + path, { method, headers: { 'X-Api-Key': c.api_key, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(30000) });
      if (!r.ok) throw Error(`${name} ${method} ${path} -> ${r.status} ${(await r.text()).slice(0, 200)}`);
      return r.status === 204 ? null : r.json();
    };
    return { get: p => call('GET', p), post: (p, b) => call('POST', p, b), put: (p, b) => call('PUT', p, b) };
  };
  const cache = new Map();
  const remember = async (key, ms, make) => {
    const hit = cache.get(key);
    if (hit && hit.until > now()) return hit.value;
    const value = await make();
    cache.set(key, { until: now() + ms, value });
    if (cache.size > 300) cache.delete(cache.keys().next().value);
    return value;
  };
  const lookup = (kind, term) => remember(`lookup:${kind}:${term}`, 600000, async () => {
    const c = await client(kind);
    return (await c.get(`${kind === 'radarr' ? '/movie' : '/series'}/lookup?term=${encodeURIComponent(term)}`)).filter(i => i.tmdbId > 0 && i.title);
  });

  // ---- Jellyfin: what is already watchable ----
  const jellyfinIndex = (force = false) => remember('jellyfin', force ? 0 : 60000, async () => {
    const config = (await loadConfig()).jellyfin || JSON.parse(await readFile(new URL('../.family-streaming.json', import.meta.url), 'utf8'));
    const r = await upstream(`${config.url}/Items?IncludeItemTypes=Movie,Series&Recursive=true&Fields=ProviderIds,ProductionYear&EnableImages=false&EnableUserData=false&Limit=10000`, { headers: { 'X-Emby-Token': config.api_key }, signal: AbortSignal.timeout(20000) });
    if (!r.ok) throw Error('Jellyfin unavailable');
    const index = { movie: new Map(), tv: new Map(), tvdb: new Map(), names: new Map() };
    for (const item of (await r.json()).Items || []) {
      const type = item.Type === 'Series' ? 'tv' : 'movie', ids = item.ProviderIds || {};
      if (ids.Tmdb) index[type].set(String(ids.Tmdb), item.Id);
      if (type === 'tv' && ids.Tvdb) index.tvdb.set(String(ids.Tvdb), item.Id);
      if (item.ProductionYear) index.names.set(`${type}:${norm(item.Name)}:${item.ProductionYear}`, item.Id);
    }
    return index;
  });
  const inJellyfin = (index, item) =>
    index[item.type].get(String(item.tmdbId)) || (item.tvdbId && index.tvdb.get(String(item.tvdbId))) || index.names.get(`${item.type}:${norm(item.title)}:${item.year}`) || null;
  const refreshJellyfin = async () => {
    const config = (await loadConfig()).jellyfin || JSON.parse(await readFile(new URL('../.family-streaming.json', import.meta.url), 'utf8'));
    await upstream(`${config.url}/Library/Refresh`, { method: 'POST', headers: { 'X-Emby-Token': config.api_key }, signal: AbortSignal.timeout(15000) });
  };

  // ---- signed-in person, rate limits, error wrapper ----
  const limits = new Map();
  const limited = (req, category, max) => {
    const t = now(), key = `${category}:${req.ip || 'unknown'}`;
    for (const [k, v] of limits) if (v.until < t) limits.delete(k);
    const r = limits.get(key) || { count: 0, until: t + 600000 }; limits.set(key, r);
    if (++r.count > max) throw fail(429, 'Too many requests. Please try again in a few minutes.');
  };
  // hub-session.js is installed beside this file on the server; tests pass their own lookup.
  const lookupSession = options.sessionUser || (async (...args) => (await import('./hub-session.js')).sessionUser(...args));
  const who = async req => {
    const user = await lookupSession(database, req.get('X-Family-Session') || '', secret());
    if (!user) throw fail(401, 'Sign in to use Streaming.');
    return user;
  };
  const admin = async req => { const u = await who(req); if (u.streaming_role !== 'admin') throw fail(403, 'Admins only.'); return u; };
  const route = (method, path, handler, { write = false, limit = 120 } = {}) => router[method](path, async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      if (write && req.get('Origin') !== ORIGIN) throw fail(403, 'Please use the family website.');
      limited(req, write ? 'write' : 'read', limit);
      res.json(await handler(req, res));
    } catch (e) {
      if (!e.status) logger.error?.(`streaming-hub ${method} ${path}: ${e.message}`);
      res.status(e.status || 503).json({ error: e.status ? e.message : 'Streaming is temporarily unavailable. Please try again.' });
    }
  });

  // ---- shaping rows and titles for the browser ----
  const present = (row, me, jf) => ({
    id: row.id, type: row.media_type, tmdbId: row.tmdb_id, title: row.title, year: row.year, poster: row.poster_url,
    state: row.state, progress: row.progress, detail: row.detail, requestedBy: row.requested_by, mine: row.user_id === me.id,
    autoApproved: row.auto_approved, seasons: row.seasons, createdAt: row.date_created, updatedAt: row.updated_at, decidedAt: row.decided_at,
    watch: jf ? (row.media_type === 'movie' ? jf.movie : jf.tv).get(row.tmdb_id) || null : null,
  });
  const annotate = async (items, me) => {
    const jf = await jellyfinIndex().catch(() => null);
    const byType = { movie: [], tv: [] };
    for (const i of items) byType[i.type].push(i.tmdbId);
    const rows = [];
    for (const type of ['movie', 'tv']) if (byType[type].length) rows.push(...await database('family_streaming_requests').where({ media_type: type }).whereIn('tmdb_id', byType[type]).orderBy('date_created', 'desc'));
    return items.map(item => {
      const watch = jf && inJellyfin(jf, item);
      const row = rows.find(r => r.media_type === item.type && r.tmdb_id === item.tmdbId && (OPEN.includes(r.state) || r.state === 'available')) || rows.find(r => r.media_type === item.type && r.tmdb_id === item.tmdbId && r.user_id === me.id);
      return { ...item, watch, request: row ? { id: row.id, state: watch ? 'available' : row.state, progress: row.progress, detail: row.detail, requestedBy: row.requested_by, mine: row.user_id === me.id } : (watch ? { state: 'available' } : null) };
    });
  };

  // ---- hand an approved request to Radarr / Sonarr; safe to repeat ----
  const arrSettings = (kind) => remember(`settings:${kind}`, 300000, async () => {
    const c = await client(kind);
    const profile = (await c.get('/qualityprofile')).find(p => p.name === PROFILE);
    const root = (await c.get('/rootfolder'))[0];
    if (!profile || !root) throw Error(`${kind} has no "${PROFILE}" profile or root folder`);
    return { profileId: profile.id, root: root.path };
  });
  async function dispatch(row) {
    if (row.media_type === 'movie') {
      const c = await client('radarr'), s = await arrSettings('radarr');
      let [movie] = await c.get(`/movie?tmdbId=${row.tmdb_id}`);
      if (!movie) {
        const [found] = await c.get(`/movie/lookup?term=tmdb:${row.tmdb_id}`);
        if (!found) throw Error('Radarr could not find this title');
        movie = await c.post('/movie', { ...found, qualityProfileId: s.profileId, rootFolderPath: s.root, monitored: true, minimumAvailability: 'released', addOptions: { monitor: 'movieOnly', searchForMovie: true } });
      } else {
        if (!movie.monitored) movie = await c.put(`/movie/${movie.id}`, { ...movie, monitored: true });
        if (!movie.hasFile) await c.post('/command', { name: 'MoviesSearch', movieIds: [movie.id] });
      }
      return { arr_id: movie.id };
    }
    const c = await client('sonarr'), s = await arrSettings('sonarr');
    const found = (await c.get(`/series/lookup?term=tmdb:${row.tmdb_id}`))[0];
    if (!found) throw Error('Sonarr could not find this title');
    const wanted = Array.isArray(row.seasons) && row.seasons.length ? row.seasons.map(Number) : null;
    let [series] = await c.get(`/series?tvdbId=${found.tvdbId}`);
    if (!series) {
      const seasons = found.seasons.map(x => ({ ...x, monitored: wanted ? wanted.includes(x.seasonNumber) : x.seasonNumber > 0 }));
      series = await c.post('/series', { ...found, seasons, qualityProfileId: s.profileId, rootFolderPath: s.root, monitored: true, seasonFolder: true,
        monitorNewItems: wanted ? 'none' : 'all', addOptions: { monitor: wanted ? 'unknown' : 'all', searchForMissingEpisodes: true, ignoreEpisodesWithFiles: false, ignoreEpisodesWithoutFiles: false } });
    } else {
      const seasons = series.seasons.map(x => ({ ...x, monitored: x.monitored || (wanted ? wanted.includes(x.seasonNumber) : x.seasonNumber > 0) }));
      series = await c.put(`/series/${series.id}`, { ...series, monitored: true, seasons });
      await c.post('/command', { name: 'SeriesSearch', seriesId: series.id });
    }
    return { arr_id: series.id, tvdb_id: String(found.tvdbId) };
  }
  const setStatus = (state) => state === 'pending' ? 'pending' : ['declined', 'cancelled', 'failed'].includes(state) ? 'declined' : 'added';
  const save = (id, fields) => database('family_streaming_requests').where({ id }).update({ ...fields, ...(fields.state ? { status: setStatus(fields.state) } : {}), updated_at: new Date(now()) });
  async function send(row) {
    try {
      const done = await dispatch(row);
      await save(row.id, { ...done, state: 'searching', detail: 'Looking for a release.', attempts: 0 });
    } catch (e) {
      const attempts = (row.attempts || 0) + 1;
      logger.warn?.(`streaming-hub dispatch ${row.title}: ${e.message}`);
      await save(row.id, { attempts, state: attempts >= 20 ? 'failed' : 'approved', detail: attempts >= 20 ? `Could not reach the download system (${e.message.slice(0, 120)}). An admin can retry.` : 'Handing this to the download system. Will retry shortly.' });
    }
    return database('family_streaming_requests').where({ id: row.id }).first();
  }

  // ---- background sync: Radarr/Sonarr queue + Jellyfin -> request status ----
  let syncing = false;
  let lastRefresh = 0; // one library refresh at most every 10 minutes, whoever is waiting
  async function syncOnce() {
    if (syncing) return; syncing = true;
    try {
      const rows = await database('family_streaming_requests').whereIn('state', OPEN.filter(s => s !== 'pending'));
      if (!rows.length) return;
      for (const row of rows.filter(r => r.state === 'approved' && (!r.updated_at || now() - new Date(r.updated_at) > 60000))) await send(row);
      const live = (await database('family_streaming_requests').whereIn('state', ['searching', 'downloading', 'importing']));
      if (!live.length) return;
      const jf = await jellyfinIndex(live.some(r => r.state === 'importing')).catch(() => null);
      const movies = live.some(r => r.media_type === 'movie') ? await (await client('radarr')).get('/movie') : [];
      const radarrQueue = movies.length ? (await (await client('radarr')).get('/queue?page=1&pageSize=200')).records : [];
      const shows = live.some(r => r.media_type === 'tv') ? await (await client('sonarr')).get('/series') : [];
      const sonarrQueue = shows.length ? (await (await client('sonarr')).get('/queue?page=1&pageSize=500')).records : [];
      // If Radarr/Sonarr have no working indexer, "still looking" would be a lie: say what is actually wrong.
      const noSource = {};
      for (const [type, kind] of [['movie', 'radarr'], ['tv', 'sonarr']])
        if (live.some(r => r.media_type === type && r.state === 'searching'))
          noSource[type] = (await (await client(kind)).get('/health').catch(() => [])).some(h => /no indexers|indexers are unavailable/i.test(h.message));
      for (const row of live) {
        const watch = jf && inJellyfin(jf, { type: row.media_type, tmdbId: row.tmdb_id, tvdbId: row.tvdb_id, title: row.title, year: row.year });
        const next = row.media_type === 'movie'
          ? (m => deriveMovie(row, m, m && radarrQueue.find(q => q.movieId === m.id), watch, now()))(movies.find(m => String(m.tmdbId) === row.tmdb_id))
          : (s => deriveSeries(row, s, s ? sonarrQueue.filter(q => q.seriesId === s.id) : [], watch, now()))(shows.find(s => s.id === row.arr_id || String(s.tvdbId) === row.tvdb_id));
        if (next.state === 'searching' && noSource[row.media_type]) next.detail = 'Nothing can search for this yet: no working indexer. An admin needs to add or fix one.';
        if (next.state === 'importing' && row.state === 'importing' && now() - new Date(row.updated_at) > 60000 && now() - lastRefresh > 600000) { lastRefresh = now(); await refreshJellyfin().catch(() => {}); }
        const changed = next.state !== row.state || next.detail !== row.detail || Math.abs((next.progress ?? 0) - (row.progress ?? 0)) >= 0.01;
        if (changed) await save(row.id, { state: next.state, progress: next.progress, detail: next.detail, ...(next.state === 'available' ? { available_at: new Date(now()) } : {}) });
      }
    } catch (e) { logger.warn?.(`streaming-hub sync: ${e.message}`); } finally { syncing = false; }
  }
  if (!options.noSync) {
    const loop = () => { const t = setTimeout(async () => { await syncOnce(); loop(); }, SYNC_MS); t.unref?.(); };
    setTimeout(syncOnce, 10000).unref?.(); loop();
  }

  // ---- routes ----
  route('get', '/streaming/me', async req => {
    const u = await who(req);
    const pending = u.streaming_role === 'admin' ? Number((await database('family_streaming_requests').where({ state: 'pending' }).count('* as n').first()).n) : undefined;
    return { id: u.id, name: u.name, role: u.streaming_role, pending };
  });

  route('get', '/streaming/discover', async req => {
    const me = await who(req);
    const shelves = await remember('discover', 3600000, async () => {
      const out = [];
      try {
        const list = (await (await client('radarr')).get('/importlist/movie?includeRecommendations=true&includeTrending=true&includePopular=true')).filter(m => m.tmdbId && !m.isExcluded);
        const take = (id, title, pick) => { const items = list.filter(pick).slice(0, 14).map(m => shapeTitle('radarr', m)); if (items.length) out.push({ id, title, items }); };
        take('trending-movies', 'Trending movies', m => m.isTrending);
        take('popular-movies', 'Popular movies', m => m.isPopular && !m.isTrending);
        take('recommended-movies', 'Movies you might like', m => m.isRecommendation && !m.isTrending && !m.isPopular);
      } catch (e) { logger.warn?.(`streaming-hub discover movies: ${e.message}`); }
      try {
        // TVmaze (free, no key) tells us what is airing; Sonarr supplies the artwork and the ids we request by.
        const days = [0, 1, 2, 3].map(d => new Date(now() + d * 86400000).toISOString().slice(0, 10));
        const airing = (await Promise.all(days.map(d => upstream(`https://api.tvmaze.com/schedule?country=US&date=${d}`, { signal: AbortSignal.timeout(10000) }).then(r => r.ok ? r.json() : []).catch(() => [])))).flat();
        const shows = new Map();
        for (const e of airing) if (e.show?.externals?.thetvdb && ['Scripted', 'Animation', 'Reality', 'Documentary'].includes(e.show.type)) shows.set(e.show.id, e.show);
        const top = [...shows.values()].sort((a, b) => (b.weight || 0) - (a.weight || 0)).slice(0, 16);
        const items = (await Promise.all(top.map(s => lookup('sonarr', `tvdb:${s.externals.thetvdb}`).then(r => r[0]).catch(() => null)))).filter(Boolean).map(s => shapeTitle('sonarr', s));
        if (items.length) out.push({ id: 'airing-tv', title: 'TV shows on this week', items: items.slice(0, 14) });
      } catch (e) { logger.warn?.(`streaming-hub discover tv: ${e.message}`); }
      return out;
    });
    return { shelves: await Promise.all(shelves.map(async s => ({ ...s, items: await annotate(s.items, me) }))) };
  });

  route('get', '/streaming/search', async req => {
    const me = await who(req);
    const q = clean(typeof req.query.q === 'string' ? req.query.q.trim() : '', 100);
    if (!q || q.length < 2) throw fail(400, 'Enter at least 2 characters.');
    const [movies, shows] = await Promise.all([lookup('radarr', q).catch(() => []), lookup('sonarr', q).catch(() => [])]);
    if (!movies.length && !shows.length) {
      await Promise.all([client('radarr'), client('sonarr')]); // surfaces a real outage as an error instead of "no results"
    }
    const mix = [];
    for (let i = 0; i < 10; i++) { if (movies[i]) mix.push(shapeTitle('radarr', movies[i])); if (shows[i]) mix.push(shapeTitle('sonarr', shows[i])); }
    const score = i => { const t = i.title.toLowerCase(), n = q.toLowerCase(); return t === n ? 0 : t.startsWith(n) ? 1 : 2; };
    mix.sort((a, b) => score(a) - score(b));
    return { results: await annotate(mix.slice(0, 16), me) };
  });

  route('get', '/streaming/title/:type/:id', async req => {
    const me = await who(req);
    const { type, id } = req.params;
    if (!['movie', 'tv'].includes(type) || !/^\d{1,12}$/.test(id)) throw fail(400, 'Unknown title.');
    const kind = type === 'movie' ? 'radarr' : 'sonarr';
    const [item] = await lookup(kind, `tmdb:${id}`);
    if (!item) throw fail(404, 'Title not found.');
    return (await annotate([shapeTitle(kind, item)], me))[0];
  });

  route('post', '/streaming/requests', async req => {
    const me = await who(req);
    const { type, tmdbId } = req.body || {};
    if (!['movie', 'tv'].includes(type) || !/^\d{1,12}$/.test(String(tmdbId))) throw fail(400, 'Unknown title.');
    const kind = type === 'movie' ? 'radarr' : 'sonarr', id = String(tmdbId);
    const [found] = await lookup(kind, `tmdb:${id}`);
    if (!found) throw fail(404, 'We could not find that title.');
    const title = shapeTitle(kind, found);
    const jf = await jellyfinIndex().catch(() => null);
    if (jf && inJellyfin(jf, title)) throw fail(409, `${title.title} is already on Jellyfin.`);
    const seasons = type === 'tv' && Array.isArray(req.body.seasons) && req.body.seasons.length
      ? [...new Set(req.body.seasons.map(Number))].filter(n => Number.isInteger(n) && title.seasons.includes(n)).sort((a, b) => a - b) : null;
    if (type === 'tv' && Array.isArray(req.body.seasons) && req.body.seasons.length && !seasons.length) throw fail(400, 'Choose at least one season.');
    const table = () => database('family_streaming_requests');
    const open = await table().where({ media_type: type, tmdb_id: id }).whereIn('state', [...OPEN, 'available']).first();
    if (open) return { duplicate: true, request: present(open, me, jf) };
    const state = startingState(me.streaming_role), t = new Date(now());
    const base = { media_type: type, tmdb_id: id, title: title.title, year: title.year, poster_url: title.poster, requested_by: me.name, user_id: me.id,
      requester_key: `user:${me.id}`, state, status: setStatus(state), seasons: seasons ? JSON.stringify(seasons) : null, tvdb_id: title.tvdbId || null,
      auto_approved: state === 'approved', decided_at: state === 'approved' ? t : null, detail: state === 'pending' ? 'Waiting for an admin to approve this.' : 'Approved automatically.',
      progress: null, attempts: 0, updated_at: t };
    let row;
    try {
      const prior = await table().where({ media_type: type, tmdb_id: id, requester_key: base.requester_key }).first();
      [row] = prior ? await table().where({ id: prior.id }).update({ ...base, date_created: t }).returning('*') : await table().insert(base).returning('*');
    } catch (e) {
      if (e.code === '23505') { const raced = await table().where({ media_type: type, tmdb_id: id }).whereIn('state', OPEN).first(); if (raced) return { duplicate: true, request: present(raced, me, jf) }; }
      throw e;
    }
    if (state === 'approved') row = await send(row);
    return { request: present(row, me, jf) };
  }, { write: true, limit: 60 });

  route('get', '/streaming/requests', async req => {
    const me = await who(req);
    const scope = req.query.scope === 'all' ? 'all' : 'mine';
    if (scope === 'all' && me.streaming_role !== 'admin') throw fail(403, 'Admins only.');
    const q = database('family_streaming_requests').orderBy('date_created', 'desc').limit(200);
    const rows = await (scope === 'all' ? q : q.where({ user_id: me.id }));
    const jf = await jellyfinIndex().catch(() => null);
    return { requests: rows.map(r => present(r, me, jf)) };
  });

  const decide = (action) => async req => {
    const me = await admin(req);
    if (!/^[\da-f-]{36}$/i.test(req.params.id)) throw fail(400, 'Unknown request.');
    const row = await database('family_streaming_requests').where({ id: req.params.id }).first();
    if (!row) throw fail(404, 'Request not found.');
    const t = new Date(now());
    if (action === 'approve') {
      if (row.state !== 'pending') throw fail(409, 'That request is no longer waiting for approval.');
      await save(row.id, { state: 'approved', decided_by: me.id, decided_at: t, detail: `Approved by ${me.name}.`, attempts: 0 });
      return { request: present(await send(await database('family_streaming_requests').where({ id: row.id }).first()), me, null) };
    }
    if (action === 'deny') {
      if (row.state !== 'pending') throw fail(409, 'That request is no longer waiting for approval.');
      const reason = clean(req.body?.reason, 200);
      await save(row.id, { state: 'declined', decided_by: me.id, decided_at: t, detail: reason ? `Declined: ${reason}` : 'Declined by an admin.' });
    } else if (action === 'retry') {
      if (!['failed', 'searching', 'approved', 'downloading'].includes(row.state)) throw fail(409, 'Nothing to retry for that request.');
      await save(row.id, { state: 'approved', attempts: 0, detail: 'Retrying.' });
      return { request: present(await send(await database('family_streaming_requests').where({ id: row.id }).first()), me, null) };
    }
    return { request: present(await database('family_streaming_requests').where({ id: row.id }).first(), me, null) };
  };
  route('post', '/streaming/requests/:id/approve', decide('approve'), { write: true });
  route('post', '/streaming/requests/:id/deny', decide('deny'), { write: true });
  route('post', '/streaming/requests/:id/retry', decide('retry'), { write: true });
  route('post', '/streaming/requests/:id/cancel', async req => {
    const me = await who(req);
    const row = await database('family_streaming_requests').where({ id: String(req.params.id).slice(0, 36) }).first();
    if (!row || (row.user_id !== me.id && me.streaming_role !== 'admin')) throw fail(404, 'Request not found.');
    if (row.state !== 'pending') throw fail(409, 'Only a request waiting for approval can be cancelled.');
    await save(row.id, { state: 'cancelled', detail: 'Cancelled.' });
    return { ok: true };
  }, { write: true });

  route('get', '/streaming/admin/users', async req => {
    await admin(req);
    const rows = await database('family_users').whereNot('status', 'disabled').orderBy('name').select('id', 'name', 'streaming_role', 'status');
    return { users: rows.map(u => ({ id: u.id, name: u.name, role: u.streaming_role, signedUp: u.status === 'ready' })) };
  });
  route('post', '/streaming/admin/users/:id/role', async req => {
    const me = await admin(req), role = req.body?.role;
    const target = await database('family_users').where({ id: String(req.params.id).slice(0, 36) }).whereNot('status', 'disabled').first();
    if (!target) throw fail(404, 'Person not found.');
    const admins = Number((await database('family_users').where({ streaming_role: 'admin' }).count('* as n').first()).n);
    const problem = canChangeRole(me, target, role, admins);
    if (problem) throw fail(400, problem);
    await database('family_users').where({ id: target.id }).update({ streaming_role: role });
    return { id: target.id, name: target.name, role };
  }, { write: true });

  route('get', '/streaming/admin/health', async req => {
    await admin(req);
    const out = [];
    for (const name of ['radarr', 'sonarr', 'prowlarr']) {
      try {
        const c = await client(name), v1 = name === 'prowlarr';
        for (const h of await c.get('/health')) out.push({ level: h.type === 'error' ? 'error' : 'warning', source: name, message: h.message });
        if (!v1) { const space = (await c.get('/diskspace')).filter(d => d.freeSpace < 30e9); for (const d of space) out.push({ level: 'warning', source: name, message: `Only ${(d.freeSpace / 1e9).toFixed(0)} GB free on ${d.path}.` }); }
      } catch { out.push({ level: 'error', source: name, message: `${name} is not responding.` }); }
    }
    try { await jellyfinIndex(true); } catch { out.push({ level: 'error', source: 'jellyfin', message: 'Jellyfin is not responding.' }); }
    return { ok: !out.some(i => i.level === 'error'), issues: out };
  });

  route('get', '/streaming/admin/security', async req => {
    await admin(req);
    try {
      const data = options.securityStatus ? await options.securityStatus()
        : JSON.parse(await readFile(new URL('../.media-security-status.json', import.meta.url), 'utf8'));
      const stale = now() - data.updatedAt * 1000 > 45 * 60000;
      return { ...data, ok: data.ok && !stale, stale };
    } catch {
      return { ok: false, issue: 'The quarantine gate has not reported its status.', counts: {}, events: [], indexers: [] };
    }
  });

  return { syncOnce, dispatch };
}
