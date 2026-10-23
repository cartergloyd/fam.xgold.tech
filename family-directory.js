/* Shared family directory. Only public profile fields come from this API. */
(function () {
  'use strict';
  var BASE = 'https://fam-api.xgold.tech/family';
  function request(path, body) {
    var controller = new AbortController(), timer = setTimeout(function () { controller.abort(); }, 15000);
    return fetch(BASE + path, { method: body === undefined ? 'GET' : 'POST', cache: 'no-store', credentials: 'omit', signal: controller.signal,
      headers: body === undefined ? { Accept: 'application/json' } : { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body)
    }).then(function (r) { return r.json().then(function (result) { if (!r.ok) throw new Error(result.error || 'Could not reach the family directory.'); return result; }); })
      .finally(function () { clearTimeout(timer); });
  }
  var directory = {
    list: function () { return request('/users').then(function (r) { return r.users; }); },
    lookup: function (email) { return request('/lookup', { email: email }).then(function (r) { return r.user; }); },
    login: function (email, pin) { return request('/login', { email: email, pin: pin }).then(function (r) { return r.user; }); },
    register: function (id, email, pin) { return request('/register', { id: id, email: email, pin: pin }).then(function (r) { return r.user; }); }
  };
  directory.ready = directory.list();
  window.familyDirectory = directory;
})();
