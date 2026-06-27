'use strict';

const API = 'https://api.fam.xgold.tech';

// ── Helpers ───────────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function showMsg(el, text) { el.textContent = text; el.hidden = false; }
function hideMsg(el)        { el.hidden = true; el.textContent = ''; }

function api(path, body) {
  return fetch(API + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',   // send/receive the session cookie cross-site
    body: JSON.stringify(body),
  });
}

function transitionTo(outEl, inEl) {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduced) {
    outEl.hidden = true;
    outEl.classList.remove('entering', 'exiting');
    inEl.hidden = false;
    inEl.classList.remove('entering', 'exiting');
    return;
  }
  outEl.classList.add('exiting');
  outEl.addEventListener('animationend', () => {
    outEl.hidden = true;
    outEl.classList.remove('exiting');
    inEl.hidden = false;
    inEl.classList.add('entering');
    inEl.addEventListener('animationend', () => inEl.classList.remove('entering'), { once: true });
  }, { once: true });
}

function setLoading(btn, loading) {
  btn.disabled = loading;
  btn.textContent = loading ? 'Please wait…' : btn.dataset.label;
}

// ── State ─────────────────────────────────────────────────────────────────────
let currentEmail = '';

// ── Step 1: Email ─────────────────────────────────────────────────────────────
const stepEmail   = $('step-email');
const emailInput  = $('email-input');
const emailError  = $('email-error');
const continueBtn = $('continue-btn');
continueBtn.dataset.label = continueBtn.textContent;

stepEmail.addEventListener('submit', async e => {
  e.preventDefault();
  hideMsg(emailError);

  const email = emailInput.value.trim().toLowerCase();
  if (!EMAIL_RE.test(email)) {
    showMsg(emailError, 'Please enter a valid email address.');
    emailInput.focus();
    return;
  }

  setLoading(continueBtn, true);
  try {
    const res  = await api('/api/check-email', { email });
    const data = await res.json();
    currentEmail = email;

    if (data.status === 'approved') {
      $('email-display').textContent = email;
      transitionTo(stepEmail, $('step-password'));
      $('password-input').focus();
    } else if (data.status === 'none') {
      $('register-email-display').textContent = email;
      transitionTo(stepEmail, $('step-register'));
      $('register-name').focus();
    } else {
      transitionTo(stepEmail, $('step-pending'));
    }
  } catch {
    showMsg(emailError, 'Something went wrong. Please try again.');
  } finally {
    setLoading(continueBtn, false);
  }
});

// ── Step 2a: Password ─────────────────────────────────────────────────────────
const stepPassword  = $('step-password');
const passwordInput = $('password-input');
const passwordError = $('password-error');
const signinBtn     = $('signin-btn');
signinBtn.dataset.label = signinBtn.textContent;

stepPassword.addEventListener('submit', async e => {
  e.preventDefault();
  hideMsg(passwordError);

  const password = passwordInput.value;
  if (!password) {
    showMsg(passwordError, 'Please enter your password.');
    passwordInput.focus();
    return;
  }

  setLoading(signinBtn, true);
  try {
    const res = await api('/api/login', { email: currentEmail, password });
    if (res.ok) {
      window.location.href = '/member.html';
    } else {
      const data = await res.json().catch(() => ({}));
      showMsg(passwordError, data.detail || 'Incorrect password.');
      passwordInput.select();
    }
  } catch {
    showMsg(passwordError, 'Something went wrong. Please try again.');
  } finally {
    setLoading(signinBtn, false);
  }
});

// ── Step 2b: Register ─────────────────────────────────────────────────────────
const stepRegister    = $('step-register');
const registerName    = $('register-name');
const registerPw      = $('register-password');
const registerConfirm = $('register-confirm');
const registerError   = $('register-error');
const registerBtn     = $('register-btn');
registerBtn.dataset.label = registerBtn.textContent;

stepRegister.addEventListener('submit', async e => {
  e.preventDefault();
  hideMsg(registerError);

  const name     = registerName.value.trim();
  const password = registerPw.value;
  const confirm  = registerConfirm.value;

  if (!name) { showMsg(registerError, 'Please enter your name.'); registerName.focus(); return; }
  if (password.length < 8) { showMsg(registerError, 'Password must be at least 8 characters.'); registerPw.focus(); return; }
  if (password !== confirm) { showMsg(registerError, 'Passwords don’t match.'); registerConfirm.focus(); return; }

  setLoading(registerBtn, true);
  try {
    const res = await api('/api/register', { email: currentEmail, name, password });
    if (res.ok || res.status === 201) {
      transitionTo(stepRegister, $('step-submitted'));
    } else {
      const data = await res.json().catch(() => ({}));
      showMsg(registerError, data.detail || 'Registration failed. Please try again.');
    }
  } catch {
    showMsg(registerError, 'Something went wrong. Please try again.');
  } finally {
    setLoading(registerBtn, false);
  }
});

// ── Back buttons ──────────────────────────────────────────────────────────────
function resetToEmail() {
  currentEmail = '';
  emailInput.value = '';
  passwordInput.value = '';
  registerName.value = '';
  registerPw.value = '';
  registerConfirm.value = '';
  hideMsg(emailError);
  hideMsg(passwordError);
  hideMsg(registerError);
}

$('back-from-password').addEventListener('click', () => { resetToEmail(); transitionTo($('step-password'), stepEmail); emailInput.focus(); });
$('back-from-register').addEventListener('click', () => { resetToEmail(); transitionTo($('step-register'), stepEmail); emailInput.focus(); });
$('back-from-pending').addEventListener('click',  () => { resetToEmail(); transitionTo($('step-pending'),  stepEmail); emailInput.focus(); });
