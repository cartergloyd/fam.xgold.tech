(() => {
  const API = 'https://fam-api.xgold.tech/family/streaming';
  const JELLYFIN = 'https://streaming.xgold.tech/web/#/details?id=';
  const $ = id => document.getElementById(id);
  const h = (tag, props = {}, ...kids) => {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v; else if (k.startsWith('on')) el.addEventListener(k.slice(2), v); else if (k in el && k !== 'list') el[k] = v; else el.setAttribute(k, v === true ? '' : v);
    }
    el.append(...kids.flat().filter(k => k != null && k !== false));
    return el;
  };
  const session = () => { try { return JSON.parse(localStorage.getItem('family-session')); } catch { return null; } };
  const safeImg = url => typeof url === 'string' && /^https:\/\/(image\.tmdb\.org|artworks\.thetvdb\.com)\//.test(url) ? url : '';
  let me = null, tab = 'discover', poll = null, sheetItem = null;

  class NeedsSignIn extends Error {}
  const api = async (path, { method = 'GET', body } = {}) => {
    const s = session();
    if (!s?.token) throw new NeedsSignIn();
    let r;
    try {
      r = await fetch(API + path, { method, cache: 'no-store', credentials: 'omit', signal: AbortSignal.timeout(30000),
        headers: { Accept: 'application/json', 'X-Family-Session': s.token, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    } catch { throw Error('Could not reach the server. Check your connection and try again.'); }
    const data = await r.json().catch(() => ({}));
    if (r.status === 401) { try { localStorage.removeItem('family-session'); } catch {} throw new NeedsSignIn(); }
    if (!r.ok) throw Object.assign(Error(data.error || 'Something went wrong. Please try again.'), { status: r.status, data });
    return data;
  };

  const words = { available: 'Available', pending: 'Waiting for approval', approved: 'Approved', searching: 'Finding a copy', downloading: 'Downloading', importing: 'Adding to library', declined: 'Declined', failed: 'Needs attention', cancelled: 'Cancelled' };
  const stateText = r => r.state === 'downloading' && r.progress > 0 ? `Downloading ${Math.round(r.progress * 100)}%` : words[r.state] || r.state;
  const ago = iso => { const s = (Date.now() - new Date(iso)) / 1000, f = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
    for (const [u, n] of [['day', 86400], ['hour', 3600], ['minute', 60]]) if (s >= n) return f.format(-Math.floor(s / n), u); return 'just now'; };
  const kind = i => (i.type === 'tv' ? 'TV show' : 'Movie');
  const note = (el, text, alert = false) => { el.textContent = text || ''; el.setAttribute('role', alert ? 'alert' : 'status'); };

  // ---- title cards and the detail sheet ----
  const cards = new WeakMap();
  const card = (item, onOpen) => {
    const state = item.watch ? 'available' : item.request?.state;
    const art = safeImg(item.poster);
    const el = h('button', { class: 'poster', type: 'button', 'aria-label': `${item.title}${item.year ? ' (' + item.year + ')' : ''}, ${kind(item)}${state ? ', ' + (words[state] || state) : ''}`, onclick: () => onOpen(item) },
      art ? h('img', { class: 'art', src: art, alt: '', loading: 'lazy', width: 144, height: 216 }) : h('span', { class: 'art' }),
      h('span', { class: 'name' }, item.title),
      h('span', { class: 'meta' }, `${kind(item)}${item.year ? ' · ' + item.year : ''}`),
      state ? h('span', { class: 'status' }, item.request ? stateText({ ...item.request, state }) : words[state]) : null);
    cards.set(item, el);
    return el;
  };
  const sheet = $('hub-sheet');
  const closeSheet = () => { sheet.close(); sheetItem = null; };
  sheet.addEventListener('click', e => { if (e.target === sheet) closeSheet(); });
  const openSheet = item => {
    sheetItem = item;
    const body = h('div', { class: 'sheet-wrap' });
    const msg = h('p', { class: 'state', role: 'status' });
    const picked = new Set();
    const art = safeImg(item.poster);
    const actions = h('div', { class: 'actions' });
    const seasons = item.type === 'tv' && item.seasons?.length > 1 && !item.request && !item.watch
      ? h('fieldset', { class: 'seasons' }, h('legend', {}, 'Seasons (none chosen means all)'), item.seasons.map(n => h('label', {}, h('input', { type: 'checkbox', value: n, onchange: e => { e.target.checked ? picked.add(n) : picked.delete(n); } }), `Season ${n}`))) : null;
    const paint = () => {
      actions.replaceChildren();
      const s = item.watch ? 'available' : item.request?.state;
      if (item.watch) actions.append(h('a', { class: 'btn', href: JELLYFIN + item.watch, target: '_blank', rel: 'noopener' }, 'Watch on Jellyfin ↗'));
      else if (!item.request) actions.append(h('button', { class: 'btn', type: 'button', id: 'sheet-request', onclick: request }, 'Request'));
      else actions.append(h('button', { class: 'btn', type: 'button', disabled: true }, s === 'pending' ? 'Requested' : words[s] || 'Requested'));
      const r = item.request;
      msg.textContent = !r ? '' : [r.requestedBy && !r.mine ? `Requested by ${r.requestedBy}.` : (r.mine ? 'You requested this.' : ''), r.detail].filter(Boolean).join(' ');
      if (r?.state === 'pending' && r.mine) actions.append(h('button', { class: 'btn ghost', type: 'button', onclick: cancel }, 'Cancel request'));
    };
    const request = async e => {
      e.target.disabled = true; e.target.textContent = 'Requesting…'; msg.textContent = '';
      try {
        const out = await api('/requests', { method: 'POST', body: { type: item.type, tmdbId: item.tmdbId, ...(picked.size ? { seasons: [...picked] } : {}) } });
        item.request = { id: out.request.id, state: out.request.state, progress: out.request.progress, detail: out.request.detail, requestedBy: out.request.requestedBy, mine: out.request.mine };
        if (out.duplicate) item.request.detail = 'This was already requested, so nothing new was added.';
        seasons?.remove(); paint(); refreshRequests(); updateCards(item);
      } catch (err) {
        if (err instanceof NeedsSignIn) return closeSheet(), show();
        paint(); msg.textContent = err.message; msg.setAttribute('role', 'alert');
        if (err.status === 409) { item.request = { state: 'available' }; paint(); msg.textContent = err.message; updateCards(item); }
      }
    };
    const cancel = async () => {
      try { await api(`/requests/${item.request.id}/cancel`, { method: 'POST' }); item.request = null; paint(); refreshRequests(); updateCards(item); } catch (err) { msg.textContent = err.message; }
    };
    body.append(
      h('button', { class: 'sheet-close', type: 'button', 'aria-label': 'Close', onclick: closeSheet }, '✕'),
      h('div', { class: 'sheet-in' },
        art ? h('img', { class: 'art', src: art, alt: `Poster for ${item.title}` }) : h('span', { class: 'art' }),
        h('div', {}, h('h3', {}, item.title),
          h('p', { class: 'meta' }, [kind(item), item.year, item.runtime && `${item.runtime} min`, item.certification, item.genres?.join(', ')].filter(Boolean).join(' · ')),
          item.overview ? h('p', { class: 'about' }, item.overview) : null, seasons, actions, msg)));
    paint(); sheet.replaceChildren(body);
    sheet.setAttribute('aria-label', item.title);
    if (!sheet.open) sheet.showModal();
  };
  const updateCards = item => { const old = cards.get(item); if (old?.isConnected) old.replaceWith(card(item, openSheet)); };
  const grid = items => h('div', { class: 'grid' }, items.map(i => card(i, openSheet)));

  // ---- Discover ----
  const search = $('hub-query'), results = $('hub-results'), shelves = $('hub-shelves'), status = $('hub-status');
  let timer, gen = 0;
  const loadShelves = async () => {
    try {
      const { shelves: list } = await api('/discover');
      shelves.replaceChildren(...list.map(s => {
        const row = h('div', { class: 'shelf-row' }, s.items.map(i => card(i, openSheet)));
        return h('section', { class: 'shelf', 'aria-label': s.title }, h('h3', {}, s.title), row,
          h('button', { class: 'chev', type: 'button', 'aria-label': `Scroll ${s.title} forward`, onclick: () => row.scrollBy({ left: row.clientWidth * .8, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }) }, '›'));
      }));
      if (!list.length) shelves.replaceChildren(h('p', { class: 'empty' }, 'Search for something to watch.'));
    } catch (e) { if (e instanceof NeedsSignIn) return show(); shelves.replaceChildren(h('p', { class: 'empty' }, e.message)); }
  };
  const runSearch = async () => {
    const q = search.value.trim(), mine = ++gen;
    if (q.length < 2) { results.replaceChildren(); shelves.hidden = false; note(status, q ? 'Keep typing to find a title.' : ''); return; }
    shelves.hidden = true; note(status, 'Searching…'); results.setAttribute('aria-busy', 'true');
    try {
      const { results: items } = await api('/search?q=' + encodeURIComponent(q));
      if (mine !== gen) return;
      results.replaceChildren(items.length ? grid(items) : h('p', { class: 'empty' }, 'No titles found. Try another name.'));
      note(status, items.length ? `${items.length} results` : '');
    } catch (e) { if (mine !== gen) return; if (e instanceof NeedsSignIn) return show(); note(status, e.message, true); results.replaceChildren(); }
    finally { if (mine === gen) results.removeAttribute('aria-busy'); }
  };
  search.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(runSearch, 350); });
  $('hub-search').addEventListener('submit', e => { e.preventDefault(); clearTimeout(timer); runSearch(); });

  // ---- Requests (mine, and everything for admins) ----
  const requestRow = (r, { admin = false } = {}) => {
    const art = safeImg(r.poster), open = ['approved', 'searching', 'downloading', 'importing'].includes(r.state);
    const acts = h('div', { class: 'acts' });
    const err = h('p', { class: 'line', role: 'alert' });
    const act = (label, path, cls = '') => h('button', { class: `btn small ${cls}`, type: 'button', onclick: async e => {
      e.target.disabled = true; err.textContent = '';
      try { await api(path, { method: 'POST', body: {} }); await Promise.all([refreshRequests(), refreshMe()]); } catch (x) { e.target.disabled = false; err.textContent = x.message; }
    } }, label);
    if (admin && r.state === 'pending') {
      const reason = h('input', { type: 'text', maxLength: 200, placeholder: 'Reason (optional)', 'aria-label': `Reason for declining ${r.title}` });
      const why = h('div', { class: 'why', hidden: true }, reason, h('button', { class: 'btn small', type: 'button', onclick: async e => {
        e.target.disabled = true;
        try { await api(`/requests/${r.id}/deny`, { method: 'POST', body: { reason: reason.value } }); await Promise.all([refreshRequests(), refreshMe()]); } catch (x) { e.target.disabled = false; err.textContent = x.message; }
      } }, 'Decline'));
      acts.append(act('Approve', `/requests/${r.id}/approve`), h('button', { class: 'btn small ghost', type: 'button', onclick: () => { why.hidden = !why.hidden; if (!why.hidden) reason.focus(); } }, 'Decline…'));
      return h('article', { class: 'row' }, art ? h('img', { class: 'thumb', src: art, alt: '' }) : h('span', { class: 'thumb' }), rowInfo(r, true), acts, why, err);
    }
    if (r.mine && r.state === 'pending') acts.append(act('Cancel', `/requests/${r.id}/cancel`, 'ghost'));
    if (admin && (r.state === 'failed' || (open && /Needs attention|No matching/.test(r.detail || '')))) acts.append(act('Retry', `/requests/${r.id}/retry`, 'ghost'));
    if (r.watch) acts.append(h('a', { class: 'btn small', href: JELLYFIN + r.watch, target: '_blank', rel: 'noopener' }, 'Watch ↗'));
    return h('article', { class: 'row' }, art ? h('img', { class: 'thumb', src: art, alt: '' }) : h('span', { class: 'thumb' }), rowInfo(r, admin), acts,
      r.state === 'downloading' && r.progress > 0 ? h('div', { class: 'bar', role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': Math.round(r.progress * 100), 'aria-label': `${r.title} download` }, h('i', { style: `width:${Math.round(r.progress * 100)}%` })) : null, err);
  };
  const rowInfo = (r, who) => h('div', { class: 'what' }, h('h3', {}, r.title + (r.year ? ` (${r.year})` : '')),
    h('p', { class: 'line' }, h('strong', {}, stateText(r)), ` · ${kind(r)}${who ? ' · ' + r.requestedBy : ''} · ${ago(r.createdAt)}`),
    r.detail && r.state !== 'available' ? h('p', { class: 'line' }, r.detail) : null);
  const mineBox = $('hub-mine'), allBox = $('hub-all'), queueBox = $('hub-queue');
  const refreshRequests = async () => {
    if (!me) return;
    try {
      const { requests } = await api('/requests?scope=' + (me.role === 'admin' ? 'all' : 'mine'));
      const mine = requests.filter(r => r.mine);
      mineBox.replaceChildren(...(mine.length ? mine.map(r => requestRow(r)) : [h('p', { class: 'empty' }, 'Nothing requested yet. Find something in Discover.')]));
      if (me.role === 'admin') {
        const waiting = requests.filter(r => r.state === 'pending');
        queueBox.replaceChildren(...(waiting.length ? waiting.map(r => requestRow(r, { admin: true })) : [h('p', { class: 'empty' }, 'Nothing is waiting for approval.')]));
        const rest = requests.filter(r => r.state !== 'pending').slice(0, 40);
        allBox.replaceChildren(...(rest.length ? rest.map(r => requestRow(r, { admin: true })) : [h('p', { class: 'empty' }, 'No other requests yet.')]));
        setBadge(waiting.length);
      }
    } catch (e) { if (e instanceof NeedsSignIn) return show(); }
  };
  const setBadge = n => { const t = $('tab-admin'); t.querySelector('.hub-badge')?.remove(); if (n) t.append(h('span', { class: 'hub-badge', 'aria-label': `${n} waiting` }, String(n))); };
  const refreshMe = async () => { try { me = await api('/me'); if (me.role === 'admin') setBadge(me.pending); } catch (e) { if (e instanceof NeedsSignIn) show(); } };

  // ---- Admin: people and system ----
  const peopleBox = $('hub-people'), healthBox = $('hub-health'), peopleNote = $('hub-people-note');
  const loadAdmin = async () => {
    try {
      const [{ users }, health, security] = await Promise.all([api('/admin/users'), api('/admin/health'), api('/admin/security')]);
      peopleBox.replaceChildren(...users.map(u => {
        const select = h('select', { 'aria-label': `Role for ${u.name}`, onchange: async () => {
          select.disabled = true;
          try { await api(`/admin/users/${u.id}/role`, { method: 'POST', body: { role: select.value } }); u.role = select.value; note(peopleNote, `${u.name} is now ${select.value}.`); }
          catch (e) { select.value = u.role; note(peopleNote, e.message, true); } finally { select.disabled = false; }
        } }, [['standard', 'Standard'], ['trusted', 'Trusted'], ['admin', 'Admin']].map(([v, t]) => h('option', { value: v, selected: u.role === v }, t)));
        return h('div', { class: 'person' }, h('span', {}, u.name, u.signedUp ? null : h('small', {}, 'Has not signed up yet')), select);
      }));
      healthBox.replaceChildren(health.issues.length ? h('ul', { class: 'issues' }, health.issues.map(i => h('li', {}, h('b', {}, i.source), ': ', i.message)))
        : h('p', { class: 'empty' }, 'Everything is working.'));
      $('hub-security').replaceChildren(
        h('p', { class: 'line' }, security.ok ? 'Quarantine gate is running.' : (security.stale ? 'Security status is out of date.' : security.issue || 'Security needs attention.')),
        h('p', { class: 'hub-note' }, `${security.counts.passed || 0} passed · ${security.counts.held || 0} held · ${security.counts.rejected || 0} rejected`),
        security.alertError ? h('p', { class: 'line', role: 'alert' }, security.alertError) : null,
        h('p', { class: 'hub-note' }, 'Files stay outside the library until checks pass. Checks reduce risk; they cannot guarantee a file is safe.'),
        h('p', { class: 'hub-note' }, `Files above ${security.maxFileGiB || '1.86'} GiB are held for review. Existing library files are outside this gate.`),
        h('ul', { class: 'issues' }, security.indexers.map(i => h('li', {}, `${i.name}: ${i.approved ? 'approved' : 'awaiting approval'}`))),
        security.events.length ? h('details', {}, h('summary', {}, 'Recent checks'), h('ul', { class: 'issues' }, security.events.map(e => h('li', {}, `${e.status}: ${e.reason}`)))) : null);
    } catch (e) { if (e instanceof NeedsSignIn) return show(); healthBox.replaceChildren(h('p', { class: 'empty' }, e.message)); }
  };

  // ---- Tabs and sign-in state ----
  const tabs = [...document.querySelectorAll('.hub-tabs [role=tab]')];
  const select = name => {
    tab = name;
    for (const t of tabs) { const on = t.dataset.tab === name; t.setAttribute('aria-selected', on); t.tabIndex = on ? 0 : -1; $('panel-' + t.dataset.tab).hidden = !on; }
    clearInterval(poll);
    // Admin refresh reads four endpoints; pace it within the shared read rate limit.
    if (name === 'requests' || name === 'admin') { refreshRequests(); poll = setInterval(() => { if (!document.hidden) { refreshRequests(); if (tab === 'admin') loadAdmin(); } }, name === 'admin' ? 60000 : 15000); }
    if (name === 'admin') loadAdmin();
  };
  tabs.forEach((t, i) => {
    t.addEventListener('click', () => select(t.dataset.tab));
    t.addEventListener('keydown', e => {
      const visible = tabs.filter(x => !x.hidden), at = visible.indexOf(t), next = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
      if (next) { const to = visible[(at + next + visible.length) % visible.length]; to.focus(); select(to.dataset.tab); e.preventDefault(); }
    });
  });
  let started = false;
  const show = async () => {
    const signedIn = !!session()?.token;
    $('hub-signin').hidden = signedIn; $('hub-app').hidden = !signedIn;
    if (!signedIn) { clearInterval(poll); me = null; started = false; return; }
    if (started) return; started = true;
    await refreshMe();
    if (!me) return;
    $('tab-admin').hidden = me.role !== 'admin';
    loadShelves(); select(tab === 'admin' && me.role !== 'admin' ? 'discover' : tab);
  };
  $('hub-signin-button').addEventListener('click', () => window.familyAccount?.show());
  window.addEventListener('family-account-change', () => { started = false; show(); });
  window.addEventListener('storage', e => { if (e.key === 'family-session') { started = false; show(); } });
  document.addEventListener('visibilitychange', () => { if (!document.hidden && (tab === 'requests' || tab === 'admin')) refreshRequests(); });
  (window.familyAccount?.ready || Promise.resolve()).then(show, show);
})();
