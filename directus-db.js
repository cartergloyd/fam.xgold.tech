/* Document API used by the page. Public access matches the former Supabase policy. */
(function () {
  'use strict';
  var BASE = 'https://fam-api.xgold.tech';
  var COLLECTIONS = ['plans', 'bedrooms', 'flights', 'members', 'progress', 'meals', 'groceries'];
  var subscriptions = Object.create(null), socket = null, timer = null, reconnect = null, backoff = 1000;
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 10); }
  function valid(name) { if (COLLECTIONS.indexOf(name) < 0) throw new Error('Unknown collection'); }
  function request(method, path, body) {
    var controller = new AbortController(), timeout = setTimeout(function () { controller.abort(); }, 20000);
    return fetch(BASE + path, {
      method: method, credentials: 'omit', cache: 'no-store', signal: controller.signal,
      headers: body === undefined ? { Accept: 'application/json' } : { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body)
    }).then(function (response) {
      return (response.status === 204 ? Promise.resolve(null) : response.json()).then(function (result) {
        if (!response.ok) {
          var error = new Error(result && result.errors && result.errors[0] && result.errors[0].message || 'Could not save or load data');
          error.status = response.status;
          error.code = result && result.errors && result.errors[0] && result.errors[0].extensions && result.errors[0].extensions.code;
          throw error;
        }
        return result;
      });
    }).finally(function () { clearTimeout(timeout); });
  }
  function load(name) {
    valid(name);
    return request('GET', '/items/kv?filter[coll][_eq]=' + encodeURIComponent(name) + '&fields=id,data&limit=-1').then(function (r) {
      if (!r || !Array.isArray(r.data)) throw new Error('Invalid data response');
      return r.data.map(function (row) { return { id: row.id, data: function () { return row.data || {}; } }; });
    });
  }
  function refresh(name) { (subscriptions[name] || []).slice().forEach(function (run) { run(); }); }
  function refreshAll() { Object.keys(subscriptions).forEach(refresh); }
  function connect() {
    if (socket || reconnect || typeof WebSocket === 'undefined') return;
    var ws;
    try { ws = new WebSocket(BASE.replace(/^http/, 'ws') + '/websocket'); } catch (_) { schedule(); return; }
    socket = ws;
    ws.onopen = function () {
      ws.send(JSON.stringify({ type: 'subscribe', collection: 'kv', uid: 'family-kv', query: { fields: ['coll', 'id'] } }));
    };
    ws.onmessage = function (event) {
      var message; try { message = JSON.parse(event.data); } catch (_) { return; }
      if (message.type === 'ping') ws.send(JSON.stringify({ type: 'pong' }));
      if (message.type === 'subscription' && message.uid === 'family-kv') { backoff = 1000; refreshAll(); }
      if (message.type === 'error') ws.close();
    };
    ws.onerror = function () { ws.close(); };
    ws.onclose = function () { if (socket === ws) socket = null; schedule(); };
  }
  function schedule() {
    if (reconnect || !Object.keys(subscriptions).length) return;
    reconnect = setTimeout(function () { reconnect = null; connect(); }, backoff);
    backoff = Math.min(30000, backoff * 2);
  }
  function watch(name, order, callback, onError) {
    var sequence = 0, active = true;
    function run() {
      var current = ++sequence;
      load(name).then(function (docs) {
        if (!active || current !== sequence) return;
        if (order) docs.sort(function (a, b) { return (a.data()[order] || 0) - (b.data()[order] || 0); });
        callback({ docs: docs });
      }, function (error) { if (active && current === sequence && onError) onError(error); });
    }
    (subscriptions[name] = subscriptions[name] || []).push(run);
    run(); connect();
    if (!timer) timer = setInterval(refreshAll, 15000);
    return function () {
      active = false;
      subscriptions[name] = subscriptions[name].filter(function (f) { return f !== run; });
      if (!subscriptions[name].length) delete subscriptions[name];
      if (!Object.keys(subscriptions).length) {
        clearInterval(timer); timer = null; clearTimeout(reconnect); reconnect = null;
        if (socket) socket.close();
      }
    };
  }
  function mutate(name, id, data, remove) {
    valid(name);
    var key = name + '/' + id, path = '/items/kv/' + encodeURIComponent(key);
    var work = remove ? request('DELETE', path) : request('PATCH', path, { data: data }).catch(function (error) {
      if (error.status !== 403 && error.status !== 404) throw error;
      return request('POST', '/items/kv', { key: key, coll: name, id: id, data: data }).catch(function (created) {
        // Another browser may have created the same document after our PATCH.
        if (created.status === 409 || created.code === 'RECORD_NOT_UNIQUE') return request('PATCH', path, { data: data });
        throw created;
      });
    });
    return work.then(function () { refresh(name); });
  }
  function collection(name) {
    valid(name);
    var order = null;
    var c = {
      doc: function (id) { return { set: function (data) { return mutate(name, String(id), data, false); }, delete: function () { return mutate(name, String(id), null, true); } }; },
      add: function (data) { return mutate(name, uid(), data, false); },
      get: function () { return load(name); },
      orderBy: function (field) { order = field; return c; },
      onSnapshot: function (callback, onError) { return watch(name, order, callback, onError); }
    };
    return c;
  }
  var db = { collection: collection, doc: function (path) {
    var slash = path.indexOf('/');
    if (slash < 1 || slash === path.length - 1) throw new Error('A document path must contain a collection and id');
    return collection(path.slice(0, slash)).doc(path.slice(slash + 1));
  } };
  var user = { id: function () {
    var value; try { value = localStorage.getItem('destin-uid'); if (!value) { value = uid(); localStorage.setItem('destin-uid', value); } } catch (_) { value = value || uid(); }
    return Promise.resolve(value);
  } };
  window.claude = { use: function (what) { return Promise.resolve(what === 'db' ? db : user); } };
  window.addEventListener('online', function () { refreshAll(); connect(); });
  document.addEventListener('visibilitychange', function () { if (!document.hidden) { refreshAll(); connect(); } });
})();
