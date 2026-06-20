/* ============================================================
   Bookish — js/login.js
   Location: BOOKISH/js/login.js
   Handles the login form — validation, fetch to /auth/login,
   redirect on success, error messages on failure.
   ============================================================ */

'use strict';

/* ── Build book spine decoration on the left panel ── */
(function buildSpines() {
  const wrap = document.getElementById('spinesWrap');
  if (!wrap) return;
  const colors  = ['#c8793a','#e8d9c0','#5a7a5c','#8b5e3c','#4a6a8a',
                   '#b8a06e','#7a5a8a','#3a6a5a','#c89a5a','#5a4a3a'];
  const heights = [130,165,145,185,135,158,148,172,128,162];
  const widths  = [22,18,26,20,16,24,19,23,17,21];
  for (let i = 0; i < 28; i++) {
    const s = document.createElement('div');
    s.className  = 'spine';
    s.style.cssText = `
      width:${widths[i % widths.length]}px;
      height:${heights[i % heights.length]}px;
      background:${colors[i % colors.length]};
      animation-delay:${(i * 0.03).toFixed(2)}s
    `;
    wrap.appendChild(s);
  }
})();

/* ── Element refs ── */
const loginForm  = document.getElementById('loginForm');
const emailEl    = document.getElementById('email');
const passwordEl = document.getElementById('password');
const rememberEl = document.getElementById('remember');
const submitBtn  = document.getElementById('submitBtn');
const alertBox   = document.getElementById('alertBox');
const alertMsg   = document.getElementById('alertMsg');
const emailErr   = document.getElementById('emailError');
const passErr    = document.getElementById('passwordError');

/* ── Alert helpers ── */
function showAlert(msg, type = 'error') {
  alertBox.className   = 'alert ' + type;
  alertMsg.textContent = msg;
}
function hideAlert() {
  alertBox.className = 'alert hidden';
}

/* ── Field helpers ── */
function setErr(el, errEl, msg) {
  el.classList.add('invalid');
  if (errEl) errEl.textContent = msg;
}
function clrErr(el, errEl) {
  el.classList.remove('invalid');
  if (errEl) errEl.textContent = '';
}

/* ── Password show/hide toggle ── */
document.getElementById('togglePw')?.addEventListener('click', function () {
  const showing = passwordEl.type === 'text';
  passwordEl.type = showing ? 'password' : 'text';
  document.getElementById('iconEyeOpen')?.classList.toggle('hidden',  !showing);
  document.getElementById('iconEyeOff')?.classList.toggle('hidden',   showing);
  this.setAttribute('aria-pressed', String(!showing));
  this.setAttribute('aria-label',   showing ? 'Show password' : 'Hide password');
  passwordEl.focus();
});

/* ── Clear errors while typing ── */
emailEl?.addEventListener('input',    () => { clrErr(emailEl,    emailErr); hideAlert(); });
passwordEl?.addEventListener('input', () => { clrErr(passwordEl, passErr);  hideAlert(); });

/* ── Blur-time validation ── */
emailEl?.addEventListener('blur', () => {
  const v = emailEl.value.trim();
  if (!v || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) {
    setErr(emailEl, emailErr, 'Enter a valid email address.');
  }
});

passwordEl?.addEventListener('blur', () => {
  if (!passwordEl.value) setErr(passwordEl, passErr, 'Password is required.');
});

/* ── Form submit ── */
loginForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  hideAlert();

  /* client-side validation */
  let ok = true;
  const email = emailEl.value.trim();
  const pass  = passwordEl.value;

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    setErr(emailEl, emailErr, 'Enter a valid email address.');
    ok = false;
  } else { clrErr(emailEl, emailErr); }

  if (!pass) {
    setErr(passwordEl, passErr, 'Password is required.');
    ok = false;
  } else { clrErr(passwordEl, passErr); }

  if (!ok) { showAlert('Please fix the errors above.', 'error'); return; }

  /* loading state */
  submitBtn.classList.add('loading');
  submitBtn.disabled = true;

  try {
    const res  = await fetch('/auth/login', {
      method:      'POST',
      headers:     { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        email:    email.toLowerCase(),
        password: pass,
        remember: rememberEl?.checked ?? false
      })
    });

    const data = await res.json();

    if (res.ok) {
      /* save name for dashboard greeting */
      if (data.firstName) localStorage.setItem('folioUser', data.firstName);
      if (data.email)     localStorage.setItem('folioEmail', data.email);

      showAlert('Signed in! Redirecting…', 'success');
      setTimeout(() => {
        window.location.href = data.redirect || '/dashboard';
      }, 700);

    } else if (res.status === 429) {
      showAlert('Too many attempts — please wait a moment.', 'error');
    } else {
      setErr(emailEl,    emailErr, ' ');
      setErr(passwordEl, passErr,  ' ');
      showAlert(data.message || 'Invalid email or password.', 'error');
    }

  } catch {
    showAlert('Network error — check your connection.', 'error');
  } finally {
    submitBtn.classList.remove('loading');
    submitBtn.disabled = false;
  }
});