/* ═══════════════════════════════════════
   BookShelf — auth-shared.js
   Shared utilities for login + register
   ═══════════════════════════════════════ */

'use strict';

/* ── Book spine decoration ── */
(function buildSpines() {
  const wrap = document.getElementById('spinesWrap');
  if (!wrap) return;
  const colors  = ['#c8793a','#e8d9c0','#5a7a5c','#8b5e3c','#4a6a8a',
                   '#b8a06e','#7a5a8a','#3a6a5a','#c89a5a','#5a4a3a',
                   '#9a7a5a','#6a8a7a','#a05e28','#3a5a6a','#7a5a4a'];
  const heights = [130,165,145,185,135,158,148,172,128,162,152,138,178,122,168];
  const widths  = [22,18,26,20,16,24,19,23,17,21];
  for (let i = 0; i < 30; i++) {
    const s = document.createElement('div');
    s.className = 'spine';
    s.style.cssText = [
      `width:${widths[i % widths.length]}px`,
      `height:${heights[i % heights.length]}px`,
      `background:${colors[i % colors.length]}`,
      `animation-delay:${(i * 0.03).toFixed(2)}s`
    ].join(';');
    wrap.appendChild(s);
  }
})();

/* ── Alert helpers ── */
function showAlert(msg, type = 'error') {
  const box = document.getElementById('alertBox');
  const txt = document.getElementById('alertMsg');
  box.className = `alert ${type}`;
  txt.textContent = msg;
}

function hideAlert() {
  const box = document.getElementById('alertBox');
  box.className = 'alert hidden';
}

/* ── Field error helpers ── */
function setFieldError(inputEl, errorEl, msg) {
  inputEl.classList.add('invalid');
  if (errorEl) errorEl.textContent = msg;
}

function clearFieldError(inputEl, errorEl) {
  inputEl.classList.remove('invalid');
  if (errorEl) errorEl.textContent = '';
}

/* ── Common validators ── */
function validateEmail(value) {
  if (!value.trim()) return 'Email is required.';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return 'Enter a valid email address.';
  return null;
}

function validateRequired(value, label) {
  if (!value.trim()) return `${label} is required.`;
  return null;
}

/* ── Password-eye toggle factory ── */
function makePasswordToggle(inputId, toggleId, openIconId, offIconId) {
  const input  = document.getElementById(inputId);
  const btn    = document.getElementById(toggleId);
  const open   = document.getElementById(openIconId);
  const off    = document.getElementById(offIconId);
  if (!input || !btn) return;

  btn.addEventListener('click', () => {
    const showing = input.type === 'text';
    input.type = showing ? 'password' : 'text';
    open.classList.toggle('hidden',  !showing);
    off.classList.toggle('hidden',   showing);
    btn.setAttribute('aria-pressed', String(!showing));
    btn.setAttribute('aria-label',   showing ? 'Show password' : 'Hide password');
    input.focus();
  });
}

/* ── Loading state ── */
function setLoading(btnEl, on) {
  btnEl.classList.toggle('loading', on);
  btnEl.disabled = on;
}