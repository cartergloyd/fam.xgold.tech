/* Shared family identity and the existing server-backed email/PIN dialog. */
(() => {
  let me = null, directory = [], showReadyGate;
  let opener, previousOverflow, closeTimer;
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const domReady = document.readyState === 'loading'
    ? new Promise(resolve => document.addEventListener('DOMContentLoaded', resolve, { once: true }))
    : Promise.resolve();
  function restore() {
    me = null;
    try {
      const stored = JSON.parse(localStorage.getItem('destin-who'));
      if (stored && directory.some(user => user.name === stored.name) && EMAIL_RE.test(stored.email || '')) me = { name: stored.name, email: stored.email };
    } catch (_) {}
  }
  function notify() { window.dispatchEvent(new CustomEvent('family-account-change', { detail: me })); }
  function closeGate() {
    const gate = document.getElementById('gate');
    if (!gate || gate.hidden || gate.classList.contains('out')) return;
    gate.classList.add('out');
    document.documentElement.style.overflow = previousOverflow || '';
    closeTimer = setTimeout(() => { gate.hidden = true; gate.classList.remove('out'); }, 260);
    if (opener && opener.isConnected) opener.focus({ preventScroll: true });
  }
  function openGate() {
    const gate = document.getElementById('gate');
    if (gate.hidden || gate.classList.contains('out')) {
      clearTimeout(closeTimer);
      opener = document.activeElement;
      previousOverflow = document.documentElement.style.overflow;
      gate.classList.remove('out'); gate.hidden = false;
      document.documentElement.style.overflow = 'hidden';
    }
  }
  const mounted = domReady.then(() => {
    document.body.insertAdjacentHTML('beforeend', DIALOG);
    document.getElementById('g-close').addEventListener('click', closeGate);
    document.getElementById('gate').addEventListener('keydown', event => {
      if (event.defaultPrevented) return;
      if (event.key === 'Escape' && document.getElementById('dd-list').hidden) { event.preventDefault(); closeGate(); }
      if (event.key !== 'Tab') return;
      const focusable = [...event.currentTarget.querySelectorAll('button:not(:disabled), input, [tabindex="0"]')].filter(el => el.getClientRects().length);
      const first = focusable[0], last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    });
  });
  const account = window.familyAccount = {
    get current() { return me; },
    async show() {
      await mounted;
      openGate();
      document.getElementById('g-err').textContent = 'Loading the family directory…';
      document.getElementById('g-close').focus();
      try { await account.ready; showReadyGate(); }
      catch (_) { document.getElementById('g-err').textContent = 'The family directory could not load. Please try again later.'; }
    },
  };
  const DIALOG = `<div class="gate" id="gate" hidden>
  <div class="gate-in" role="dialog" aria-modal="true" aria-labelledby="gate-t">
    <h2 id="gate-t">Please Sign-in</h2>
    <p class="lead" id="gate-lead">Use your email and 4-digit PIN.</p>
    <form id="g1" novalidate>
      <label for="g-email">Email</label>
      <input id="g-email" type="email" inputmode="email" autocomplete="email" autocapitalize="off" spellcheck="false" placeholder="you@example.com" required>
      <div class="g-pin" id="g-pinw" hidden>
        <label for="g-pin" id="g-pinl">4-digit PIN</label>
        <input id="g-pin" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="4" autocomplete="off" placeholder="&#8226;&#8226;&#8226;&#8226;">
      </div>
      <p class="err" id="g-err" role="alert"></p>
      <div class="g-res" id="g-res" aria-live="polite">
        <div class="g-known" id="g-guess" hidden>
          <img id="g-guess-img" alt="">
          <p class="g-welcome" id="g-guess-name"></p>
          <p class="g-note" id="g-guess-note"></p>
          <button class="go" id="g-guess-go" type="button">That's me</button>
          <button class="back" id="g-guess-other" type="button">Choose someone else</button>
        </div>
        <div class="g-known" id="g-known" hidden>
          <img id="g-known-img" alt="">
          <p class="g-welcome" id="g-welcome"></p>
          <button class="go" id="g-enter" type="button" disabled>Enter</button>
        </div>
        <div class="g-new" id="g-new" hidden>
          <p>We don&#8217;t recognize that email yet.</p>
          <button class="go" id="g-signup" type="button">Sign up</button>
        </div>
        <div class="step2" id="g2" hidden>
          <label id="g-lbl">Which family member are you?</label>
          <div class="dd">
            <button class="dd-btn" id="dd-btn" type="button" aria-haspopup="listbox" aria-expanded="false" aria-labelledby="g-lbl dd-btn"><span class="ph" id="dd-val">Choose your name</span><svg class="arr" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg></button>
            <ul class="dd-list" id="dd-list" role="listbox" aria-labelledby="g-lbl" tabindex="-1" hidden></ul>
          </div>
          <p class="g-note" id="g-none" hidden>Every name already has an email assigned.</p>
          <button class="go" id="g-go" type="button" disabled>Sign up</button>
        </div>
      </div>
    </form>
    <button class="back" id="g-close" type="button">Not now</button>
  </div>
</div>`;
  account.ready = Promise.all([mounted, window.familyDirectory.ready]).then(([, users]) => {
    directory = users;
    restore();
    const AV = {}, NAMES = directory.map(user => { if (user.photo_url) AV[user.name] = user.photo_url; return user.name; }).sort();
    function el(tag, cls, txt) { const node = document.createElement(tag); if (cls) node.className = cls; if (txt != null) node.textContent = txt; return node; }
    var gate = document.getElementById('gate'), g1 = document.getElementById('g1'), g2 = document.getElementById('g2'), gE = document.getElementById('g-email'), gErr = document.getElementById('g-err'),
        ddBtn = document.getElementById('dd-btn'), ddList = document.getElementById('dd-list'), ddVal = document.getElementById('dd-val'), gGo = document.getElementById('g-go');
    var picked = null, actIdx = -1, guess = null, lookupPending = false;
    var gGuess = document.getElementById('g-guess'), gGuessImg = document.getElementById('g-guess-img'), gGuessName = document.getElementById('g-guess-name'), gGuessNote = document.getElementById('g-guess-note'), gGuessGo = document.getElementById('g-guess-go');
    function avSrc(n) {
      if (AV[n]) return AV[n];
      var c = String(n || '?').charAt(0).toUpperCase();
      return 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="#3a3a3c"/><text x="32" y="42" text-anchor="middle" font-family="-apple-system,Helvetica,Arial,sans-serif" font-size="28" font-weight="600" fill="#f5f5f7">' + c + '</text></svg>');
    }
    function avImg(n, cls) { var i = el('img', cls); i.alt = ''; i.src = avSrc(n); return i; }
    function pick(n) {
      picked = n; ddVal.textContent = n; ddVal.className = ''; var old = ddBtn.querySelector('img'); if (old) old.remove();
      ddBtn.insertBefore(avImg(n), ddVal); refreshEnabled(); closeDD(); Array.prototype.forEach.call(ddList.children, function (li) { li.setAttribute('aria-selected', li.dataset.n === n); });
    }
    function openDD() { ddList.hidden = false; ddBtn.setAttribute('aria-expanded', 'true'); actIdx = picked ? AVAIL.indexOf(picked) : 0; markAct(); ddList.focus(); }
    function closeDD() { ddList.hidden = true; ddBtn.setAttribute('aria-expanded', 'false'); }
    function markAct() { Array.prototype.forEach.call(ddList.children, function (li, i) { li.classList.toggle('act', i === actIdx); if (i === actIdx) li.scrollIntoView({ block: 'nearest' }); }); }
    var AVAIL = [], members = [], lookupSeq = 0, lastLocal = null, match = null, mode = '';
    var gKnown = document.getElementById('g-known'), gKnownImg = document.getElementById('g-known-img'), gWelcome = document.getElementById('g-welcome'),
        gEnter = document.getElementById('g-enter'), gNew = document.getElementById('g-new'), gSignup = document.getElementById('g-signup'), gNone = document.getElementById('g-none');
    function validEmail() { return EMAIL_RE.test(gE.value.trim()); }
    var gPin = document.getElementById('g-pin'), gPinW = document.getElementById('g-pinw'), gPinL = document.getElementById('g-pinl');
    function pinOk() { return /^\d{4}$/.test(gPin.value); }
    gPin.addEventListener('input', function () { gPin.value = gPin.value.replace(/\D/g, '').slice(0, 4); gErr.textContent = ''; refreshEnabled(); });
    function setMode(m) {
      mode = m; gGuess.hidden = m !== 'guess'; gKnown.hidden = m !== 'known'; gNew.hidden = m !== 'new'; g2.hidden = m !== 'pick';
      gPinW.hidden = !(m === 'known' || m === 'pick'); gPinL.textContent = m === 'known' ? 'Enter your 4-digit PIN' : 'Create a 4-digit PIN';
      refreshEnabled();
    }
    function refreshEnabled() { var ok = validEmail(), pn = pinOk(); gEnter.disabled = !(ok && pn); gGo.disabled = !(ok && picked && pn); gGuessGo.disabled = !(ok && !lookupPending && guess && !guess.registered); document.getElementById('g-guess-other').disabled = !ok || lookupPending; }
    function fetchClaims() {
      return window.familyDirectory.list().then(function (users) {
        directory = users;
        return users.filter(function (u) { return u.registered; });
      });
    }
    function buildList() {
      var taken = {}; members.forEach(function (m) { taken[m.name] = true; });
      AVAIL = NAMES.filter(function (n) { return !taken[n]; });
      picked = null; actIdx = -1; closeDD();
      ddVal.textContent = 'Choose your name'; ddVal.className = 'ph'; var old = ddBtn.querySelector('img'); if (old) old.remove();
      ddList.textContent = '';
      AVAIL.forEach(function (n) {
        var li = el('li'); li.setAttribute('role', 'option'); li.dataset.n = n; li.setAttribute('aria-selected', 'false');
        li.appendChild(avImg(n)); li.appendChild(document.createTextNode(n));
        li.addEventListener('click', function () { pick(n); ddBtn.focus(); }); ddList.appendChild(li);
      });
      ddBtn.hidden = !AVAIL.length; gNone.hidden = !!AVAIL.length; refreshEnabled();
    }
    var lookupTimer = null;
    function showSuggestion() {
      guess = window.familyProfileMatch.suggest(gE.value, directory);
      if (!guess) { setMode(validEmail() ? 'new' : ''); return; }
      gGuessImg.src = avSrc(guess.name);
      gGuessName.textContent = 'Is this ' + guess.name + '?';
      gGuessNote.textContent = guess.registered
        ? 'This profile already has an account. Use the email you registered with.'
        : 'Confirm your profile, then create your four-digit PIN.';
      setMode('guess');
    }
    function onEmailInput() {
      var email = gE.value.trim().toLowerCase();
      gErr.textContent = ''; clearTimeout(lookupTimer);
      var seq = ++lookupSeq;
      lastLocal = email; match = null; picked = null; lookupPending = validEmail();
      showSuggestion();
      if (!validEmail()) return;
      lookupTimer = setTimeout(function () {
        window.familyDirectory.lookup(email).then(function (user) {
          if (seq !== lookupSeq) return;
          lookupPending = false; match = user;
          if (match) { gKnownImg.src = avSrc(match.name); gWelcome.textContent = 'Welcome back, ' + match.name; setMode('known'); }
          else showSuggestion();
        }, function (error) {
          if (seq !== lookupSeq) return;
          lookupPending = false; lastLocal = null; setMode(''); gErr.textContent = error.message;
        });
      }, 350);
    }
    function chooseProfile(suggestion) {
      lookupSeq++; clearTimeout(lookupTimer);
      gGuessGo.disabled = true; document.getElementById('g-guess-other').disabled = true;
      fetchClaims().then(function (docs) {
        members = docs; buildList(); setMode('pick');
        if (suggestion && AVAIL.indexOf(suggestion.name) >= 0) { pick(suggestion.name); gPin.focus(); }
        else if (AVAIL.length) ddBtn.focus();
      }, function () { gErr.textContent = 'Could not reach the family list. Try again.'; refreshEnabled(); });
    }
    gGuessGo.addEventListener('click', function () { if (validEmail() && guess && !guess.registered) chooseProfile(guess); });
    document.getElementById('g-guess-other').addEventListener('click', function () { chooseProfile(null); });
    function finish(name) {
      me = { name: name, email: gE.value.trim() };
      try { localStorage.setItem('destin-who', JSON.stringify(me)); } catch (e) {}
      gPin.value = ''; closeGate(); notify();
    }
    gE.addEventListener('input', onEmailInput);
    g1.addEventListener('submit', function (e) {
      e.preventDefault();
      if (!validEmail()) { gErr.textContent = 'Enter a valid email address.'; gE.focus(); return; }
      if (mode === 'known') gEnter.click(); else if (mode === 'guess') gGuessGo.click(); else if (mode === 'new') gSignup.click(); else if (mode === 'pick') gGo.click();
    });
    gEnter.addEventListener('click', function () {
      if (!(match && validEmail() && pinOk())) return;
      gEnter.disabled = true;
      window.familyDirectory.login(gE.value.trim(), gPin.value).then(function (user) { finish(user.name); }, function (error) {
        gErr.textContent = error.message; gPin.value = ''; refreshEnabled(); gPin.focus();
      });
    });
    gSignup.addEventListener('click', function () {
      gSignup.disabled = true;
      fetchClaims().then(function (docs) { members = docs; buildList(); setMode('pick'); if (AVAIL.length) ddBtn.focus(); },
        function () { gErr.textContent = 'Couldn\u2019t reach the family list. Try again.'; })
        .then(function () { gSignup.disabled = false; });
    });
    gGo.addEventListener('click', function () {
      if (!picked || !validEmail() || !pinOk()) return;
      var user = directory.filter(function (u) { return u.name === picked; })[0];
      if (!user) return;
      gGo.disabled = true;
      window.familyDirectory.register(user.id, gE.value.trim(), gPin.value).then(function (saved) { finish(saved.name); }, function (error) {
        gErr.textContent = error.message; refreshEnabled();
      });
    });


    ddBtn.addEventListener('click', function () { ddList.hidden ? openDD() : closeDD(); });
    ddList.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown') { e.preventDefault(); actIdx = Math.min(AVAIL.length - 1, actIdx + 1); markAct(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); actIdx = Math.max(0, actIdx - 1); markAct(); }
      else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (actIdx >= 0) pick(AVAIL[actIdx]); ddBtn.focus(); }
      else if (e.key === 'Escape') { e.preventDefault(); closeDD(); ddBtn.focus(); }
    });
    document.addEventListener('click', function (e) { if (!ddList.hidden && !e.target.closest('.dd')) closeDD(); });
    function showGate() {
      openGate();
      gErr.textContent = ''; lastLocal = null; match = null; picked = null; setMode('');
      gPin.value = ''; gE.value = me ? me.email : '';
      onEmailInput(); gE.focus();
    }
    showReadyGate = showGate;
    account.photo = avSrc;
    notify();
  });
  account.ready.catch(() => {});
  const sync = () => account.ready.then(() => { restore(); notify(); }).catch(() => {});
  window.addEventListener('storage', event => { if (event.key === 'destin-who' || event.key === null) sync(); });
  window.addEventListener('pageshow', sync);
})();
