/* =====================================================
   BookShelf — Dashboard JavaScript
   Book data & recommendations: Open Library API
   Price comparison: live search links to Amazon, Flipkart, Meesho
   ===================================================== */

/* ══ CONSTANTS ══════════════════════════════════════ */
const BOOK_COLORS = ["#1A237E","#4A235A","#2D6A4F","#1B4F72","#5D4037","#7B3F00","#880E4F","#1A5276","#424242","#7E2611","#C17F3A","#9B2226"];

const QUOTES = [
  '"A reader lives a thousand lives before he dies."',
  '"Not all those who wander are lost."',
  '"So many books, so little time."',
  '"One must always be careful of books." — Cassandra Clare',
  '"The more that you read, the more things you will know."',
  '"A book is a dream you hold in your hands."',
];

/* Open Library search queries per genre filter pill */
const GENRE_QUERIES = {
  all:         'fiction bestseller',
  'self-help': 'self help personal development',
  fiction:     'fiction novel',
  business:    'business leadership',
  philosophy:  'philosophy',
};

/* Genre options offered in the Add Book form — used to match API subjects */
const KNOWN_GENRES = ['Self-help','Fiction','Non-fiction','Business','Philosophy','Science','Biography'];

/* Stores used for price-comparison search links */
const STORES = [
  { name: 'Amazon',   color: '#FF9900', build: q => `https://www.amazon.in/s?k=${q}` },
  { name: 'Flipkart', color: '#2874F0', build: q => `https://www.flipkart.com/search?q=${q}` },
  { name: 'Meesho',   color: '#9B2FAD', build: q => `https://www.meesho.com/search?q=${q}` },
];

/* Words that stay lowercase in titles (unless they're the first word) */
const SMALL_WORDS = new Set(['a','an','and','the','of','in','on','for','to','vs','vs.','or','nor','but','at','by','from','with','as','is']);

/* ══ STATE — stored in localStorage (per browser) ════ */
let state = {
  readBooks: [],          // {id,title,author,genre,rating,notes,color,cover,totalPages,addedAt,finishedDate,finishedYear,finishedMonth}
  tbrBooks:  [],           // {id,title,author,genre,color,cover,totalPages,addedAt}
  currentlyReading: [],    // max 2: {id,title,author,genre,color,cover,totalPages,currentPage,startedAt}
  goal: { type: 'yearly', target: 12 }
};

/* Caches so we don't refetch on every render */
const recCache = {};
let priceDefaults = null;

/* Shared between star pickers and their save handlers */
let currentRating  = 0;          // Add Book modal
let ratingSelected = 0;          // "How was it?" modal
let ratingCallback = null;
let pendingCurrentBook = null;   // book waiting for a free "currently reading" slot

/* ══ STORAGE ═════════════════════════════════════════ */
function loadState() {
  try {
    const saved = localStorage.getItem(`bookshelfState_${getCurrentUserId()}`);
    if (saved) state = JSON.parse(saved);
  } catch (e) {}

  if (!Array.isArray(state.readBooks)) state.readBooks = [];
  if (!Array.isArray(state.tbrBooks))  state.tbrBooks  = [];

  // Migrate old single-object "currentReading" -> new array "currentlyReading"
  if (!Array.isArray(state.currentlyReading)) {
    state.currentlyReading = state.currentReading ? [state.currentReading] : [];
    delete state.currentReading;
  }
  state.currentlyReading.forEach(cr => {
    if (typeof cr.currentPage !== 'number') cr.currentPage = 0;
  });

  if (!state.goal || typeof state.goal !== 'object') state.goal = {};
  if (state.goal.type !== 'monthly' && state.goal.type !== 'yearly') state.goal.type = 'yearly';
  if (!state.goal.target || state.goal.target < 1) state.goal.target = 12;
}

function saveState() {
  localStorage.setItem(`bookshelfState_${getCurrentUserId()}`, JSON.stringify(state));
}

function uid() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

/* Capitalizes the first letter of every word (Issue #4) */
function toTitleCase(str) {
  if (!str) return str;
  return str.toLowerCase().split(' ').map((word, i) => {
    if (!word) return word;
    if (i !== 0 && SMALL_WORDS.has(word)) return word;
    return word.replace(/(^|-)([a-z])/g, (m, sep, ch) => sep + ch.toUpperCase());
  }).join(' ');
}

/* ══ INIT ═══════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', async () => {
  await loadUser();  
  loadState();
  setGreeting();
  loadUser();
  refreshAll();
  renderRecommendations('all');
  initSidebar();
  initPageNav();
  initModal();
  initFilters();
  initSearch();
  initStarPicker();
  initTabSwitcher();
  initLogout();
  initTabSearch();
  initGoalEditor();
  initLimitModal();
  initRateModal();
  document.addEventListener('click', closeAllBuyMenus);
});

/* Re-renders every section, each wrapped so one failure can't break the rest (Issue #2) */
function refreshAll() {
  try { renderDashboard();  } catch (e) { console.error('renderDashboard failed:', e); }
  try { renderShelfPage();  } catch (e) { console.error('renderShelfPage failed:', e); }
  try { renderPrices();     } catch (e) { console.error('renderPrices failed:', e); }
  try { renderStats();      } catch (e) { console.error('renderStats failed:', e); }
}

/* ══ GREETING & USER INFO ═════════════════════════════ */
function setGreeting() {
  const hour  = new Date().getHours();
  const greet = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  document.getElementById('timeGreet').textContent  = greet;
  document.getElementById('dailyQuote').textContent = QUOTES[Math.floor(Math.random() * QUOTES.length)];

  document.getElementById('heroName').textContent = 'Reader';
  document.getElementById('sbName').textContent   = 'Reader';
  document.getElementById('sbEmail').textContent  = '';
  document.getElementById('sbAvatar').textContent = 'R';
}

/* Fetches the logged-in user's name/email from the backend session.
   Requires a GET /auth/me route — see mentor notes for the Express snippet. */
async function loadUser() {
  try {
    const res = await fetch('/auth/me', { credentials: 'include' });
    if (!res.ok) return;
    const data = await res.json();
    const user = data.user || data;
    if (!user) return;

    // Store the user ID so storage functions can use it
    window._currentUserId = user._id || user.id || user.email;

    const name = [user.firstName, user.lastName].filter(Boolean).join(' ') || 'Reader';
    document.getElementById('heroName').textContent  = name;
    document.getElementById('sbName').textContent    = name;
    document.getElementById('sbAvatar').textContent  = name.charAt(0).toUpperCase();
    if (user.email) document.getElementById('sbEmail').textContent = user.email;
  } catch (e) {
    console.error('Could not load account info:', e);
  }
}
/* Returns the current user ID for localStorage keys, or 'guest' if not logged in */
function getCurrentUserId() {
  return window._currentUserId || 'guest';
}

/* ══ OPEN LIBRARY API ═════════════════════════════════
   Returns: array of mapped books on success,
            [] when the API responds but finds nothing,
            null when the request itself fails (network/CORS). */
async function fetchBooks(query, maxResults = 12, fallbackGenre) {
  try {
    const randomOffset = Math.floor(Math.random() * 60);
    const url = `https://openlibrary.org/search.json?q=${encodeURIComponent(query)}&limit=${maxResults}&offset=${randomOffset}&fields=title,author_name,cover_i,subject,number_of_pages_median`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('Open Library error: ' + res.status);
    const data = await res.json();
    return (data.docs || []).map(d => mapDoc(d, fallbackGenre)).filter(b => b.title);
  } catch (e) {
    console.error('Book search failed:', e);
    return null;
  }
}

function mapDoc(doc, fallbackGenre) {
  const rawTitle  = doc.title || '';
  const rawAuthor = (doc.author_name && doc.author_name[0]) || 'Unknown Author';

  let genre = fallbackGenre || 'General';
  if (Array.isArray(doc.subject)) {
    const match = doc.subject.find(s => KNOWN_GENRES.some(k => k.toLowerCase() === String(s).toLowerCase()));
    if (match) genre = match;
    else if (doc.subject[0] && doc.subject[0].length < 28) genre = doc.subject[0];
  }

  return {
    title:  toTitleCase(rawTitle),
    author: toTitleCase(rawAuthor),
    genre:  toTitleCase(genre),
    cover:  doc.cover_i ? `https://covers.openlibrary.org/b/id/${doc.cover_i}-M.jpg` : '',
    totalPages: doc.number_of_pages_median || null,
    color:  BOOK_COLORS[Math.floor(Math.random() * BOOK_COLORS.length)]
  };
}

/* Renders a cover image if available, otherwise the title on a color block */
function coverHTML(book) {
  if (book.cover) {
    return `<img class="cover-img" src="${book.cover}" alt="" loading="lazy" onerror="this.remove()"/>`;
  }
  return `<span>${escapeHtml(book.title)}</span>`;
}

/* ══ DASHBOARD ═══════════════════════════════════════ */
function renderDashboard() {
  const thisYear  = new Date().getFullYear();
  const readCount = state.readBooks.length;
  const tbrCount  = state.tbrBooks.length;
  const yearCount = state.readBooks.filter(b => b.finishedYear === thisYear).length;
  const ratings   = state.readBooks.filter(b => b.rating > 0).map(b => b.rating);
  const avgRating = ratings.length ? (ratings.reduce((a,b) => a+b, 0) / ratings.length).toFixed(1) : '—';

  document.getElementById('statRead').textContent   = readCount;
  document.getElementById('statTBR').textContent    = tbrCount;
  document.getElementById('statYear').textContent   = yearCount;
  document.getElementById('statRating').textContent = avgRating === '—' ? '—' : avgRating + '★';
  document.getElementById('tabCountRead').textContent = readCount;
  document.getElementById('tabCountTBR').textContent  = tbrCount;

  renderGoal();
  renderCurrentlyReading();
}

/* ── Reading goal (Issue #5) ──
   Editable Monthly/Yearly target. Progress counts only books finished
   within the current period, so backdating old books doesn't skew it. */
function renderGoal() {
  const { type, target } = state.goal;
  const now = new Date();
  let count;

  if (type === 'monthly') {
    count = state.readBooks.filter(b => {
      if (!b.finishedDate) return false;
      const d = new Date(b.finishedDate);
      return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
    }).length;
  } else {
    count = state.readBooks.filter(b => b.finishedYear === now.getFullYear()).length;
  }

  const pct = target > 0 ? Math.min(100, Math.round((count / target) * 100)) : 0;
  document.getElementById('goalLabel').textContent = type === 'monthly' ? 'Monthly reading goal' : 'Yearly reading goal';
  document.getElementById('goalPct').textContent   = `${count} / ${target} books`;

  setTimeout(() => {
    const fill = document.getElementById('goalFill');
    if (fill) fill.style.width = pct + '%';
  }, 300);
}

function initGoalEditor() {
  const form    = document.getElementById('goalEditForm');
  const editBtn = document.getElementById('goalEditBtn');
  const typeSel = document.getElementById('goalType');
  const target  = document.getElementById('goalTarget');

  editBtn.addEventListener('click', () => {
    typeSel.value = state.goal.type;
    target.value  = state.goal.target;
    form.classList.toggle('hidden');
  });

  document.getElementById('goalSaveBtn').addEventListener('click', () => {
    let t = parseInt(target.value, 10);
    if (isNaN(t) || t < 1) t = 1;
    state.goal = { type: typeSel.value, target: t };
    saveState();
    renderGoal();
    renderStats();
    form.classList.add('hidden');
    showToast('Reading goal updated!');
  });
}

/* ── Currently reading — up to 2 books (Issues #8 & #9) ── */
function renderCurrentlyReading() {
  const wrap = document.getElementById('currentReadWrap');
  const list = state.currentlyReading;

  if (list.length === 0) {
    wrap.innerHTML = `
      <div class="cr-empty">
        <div class="cr-empty-icon">📖</div>
        <div class="cr-empty-text">
          <p class="cr-empty-title">You're not reading anything yet</p>
          <p class="cr-empty-sub">Add a book and set its status to "Currently reading" to track your progress here.</p>
        </div>
        <button class="btn-cr-add" id="crAddBtn">Add a book</button>
      </div>`;
    document.getElementById('crAddBtn').addEventListener('click', () => {
      document.getElementById('addBookBtn').click();
    });
    return;
  }

  let html = '<div class="cr-grid">';
  list.forEach((cr, idx) => {
    const totalPages  = cr.totalPages || null;
    const currentPage = cr.currentPage || 0;
    const progress    = totalPages ? Math.min(100, Math.round((currentPage / totalPages) * 100)) : 0;
    const descText    = totalPages ? `Page ${currentPage} of ${totalPages}` : 'Add total pages to track progress';

    const pageControl = totalPages
      ? `<input type="number" class="cr-page-input" min="0" max="${totalPages}" value="${currentPage}" id="crPageInput-${idx}"/>
         <span>/ ${totalPages} pages</span>
         <button onclick="updateCRProgress(${idx})">Update</button>`
      : `<input type="number" class="cr-page-input" min="1" placeholder="Total pages" id="crTotalInput-${idx}"/>
         <button onclick="setCRTotalPages(${idx})">Set total pages</button>`;

    html += `
      <div class="current-read-card">
        <div class="cr-cover" style="background:${cr.color}">${coverHTML(cr)}</div>
        <div class="cr-body">
          <p class="cr-title">${escapeHtml(cr.title)}</p>
          <p class="cr-author">${escapeHtml(cr.author)}</p>
          <p class="cr-desc">${escapeHtml(descText)}</p>
          <div class="cr-progress-row">
            <div class="cr-track"><div class="cr-fill" id="crFill-${idx}" style="width:0%" data-target="${progress}%"></div></div>
            <span class="cr-pct">${progress}%</span>
          </div>
          <div class="cr-page-update">${pageControl}</div>
          <div class="cr-actions">
            <button class="btn-finish" onclick="markFinished(${idx})">Mark finished ✓</button>
            <button class="btn-update-progress" onclick="moveCRToTBR(${idx})">Move to TBR</button>
            <button class="btn-update-progress btn-cr-remove" onclick="removeCR(${idx})">Remove</button>
          </div>
        </div>
      </div>`;
  });

  if (list.length < 2) {
    html += `
      <div class="cr-add-slot" id="crAddSlot">
        <div class="cr-add-slot-icon">+</div>
        <div class="cr-add-slot-text">Start another book<br/>(up to 2 at once)</div>
      </div>`;
  }
  html += '</div>';
  wrap.innerHTML = html;

  if (list.length < 2) {
    document.getElementById('crAddSlot').addEventListener('click', () => document.getElementById('addBookBtn').click());
  }

  list.forEach((cr, idx) => {
    setTimeout(() => {
      const f = document.getElementById(`crFill-${idx}`);
      if (f) f.style.width = f.dataset.target;
    }, 300);
  });
}

/* Bookmark — update current page (Issue #9) */
function updateCRProgress(idx) {
  const cr = state.currentlyReading[idx];
  if (!cr) return;
  const input = document.getElementById(`crPageInput-${idx}`);
  let val = parseInt(input.value, 10);
  if (isNaN(val) || val < 0) val = 0;
  if (cr.totalPages && val > cr.totalPages) val = cr.totalPages;
  cr.currentPage = val;
  saveState();
  renderCurrentlyReading();
  if (cr.totalPages && val >= cr.totalPages) {
    showToast(`You've reached the end of "${cr.title}" — tap "Mark finished" when ready!`);
  } else {
    showToast(`Bookmarked at page ${val}`);
  }
}

/* If a book has no page count yet, let the user set it manually */
function setCRTotalPages(idx) {
  const cr = state.currentlyReading[idx];
  if (!cr) return;
  const input = document.getElementById(`crTotalInput-${idx}`);
  const val = parseInt(input.value, 10);
  if (!val || val < 1) { showToast('Enter a valid page count'); return; }
  cr.totalPages  = val;
  cr.currentPage = cr.currentPage || 0;
  saveState();
  renderCurrentlyReading();
}

/* Mark a currently-reading book as finished — asks for a rating (Issue #10) */
function markFinished(idx) {
  const book = state.currentlyReading[idx];
  if (!book) return;
  const bookId = book.id;

  openRatingPrompt(book.title, (rating) => {
    const i = state.currentlyReading.findIndex(b => b.id === bookId);
    if (i === -1) return;
    const b = state.currentlyReading.splice(i, 1)[0];
    finalizeAsRead(b, rating);
    saveState();
    refreshAll();
    showToast(`"${b.title}" marked as finished!`);
  });
}

function moveCRToTBR(idx) {
  const book = state.currentlyReading.splice(idx, 1)[0];
  if (!book) return;
  state.tbrBooks.unshift(toTBREntry(book));
  saveState();
  refreshAll();
  showToast(`"${book.title}" moved to TBR`);
}

function removeCR(idx) {
  const book = state.currentlyReading.splice(idx, 1)[0];
  if (!book) return;
  saveState();
  refreshAll();
  showToast(`"${book.title}" removed`);
}

/* Adds a book to readBooks with today's date as the finished date */
function finalizeAsRead(book, rating) {
  const now = new Date();
  state.readBooks.unshift({
    id: book.id, title: book.title, author: book.author, genre: book.genre,
    color: book.color, cover: book.cover, totalPages: book.totalPages,
    rating, notes: book.notes || '', addedAt: Date.now(),
    finishedDate: now.toISOString(), finishedYear: now.getFullYear(), finishedMonth: now.getMonth()
  });
}

function toTBREntry(book) {
  return { id: book.id, title: book.title, author: book.author, genre: book.genre,
           color: book.color, cover: book.cover, totalPages: book.totalPages, addedAt: Date.now() };
}

/* Try to start reading a book — handles the 2-book limit (Issue #8) */
function tryAddCurrentlyReading(book) {
  if (state.currentlyReading.length < 2) {
    state.currentlyReading.push({ ...book, currentPage: 0, startedAt: Date.now() });
    saveState();
    refreshAll();
    showToast(`Started reading "${book.title}"`);
    return;
  }
  pendingCurrentBook = { ...book, currentPage: 0, startedAt: Date.now() };
  openLimitModal();
}

/* ── "2 books at once" limit modal ── */
function openLimitModal() {
  const list = document.getElementById('limitModalList');
  list.innerHTML = '';

  state.currentlyReading.forEach((b, idx) => {
    const row = document.createElement('div');
    row.className = 'limit-modal-row';
    row.innerHTML = `
      <div class="limit-modal-cover" style="background:${b.color}">${coverHTML(b)}</div>
      <div class="limit-modal-info">
        <p class="limit-modal-title">${escapeHtml(b.title)}</p>
        <p class="limit-modal-author">${escapeHtml(b.author)}</p>
      </div>
      <div class="limit-modal-actions">
        <button data-idx="${idx}" data-action="tbr">Move to TBR</button>
        <button data-idx="${idx}" data-action="finish">Mark finished</button>
      </div>`;
    list.appendChild(row);
  });

  list.querySelectorAll('button').forEach(btn => btn.addEventListener('click', handleLimitChoice));
  document.getElementById('limitModalBackdrop').classList.add('open');
}

function closeLimitModal() {
  document.getElementById('limitModalBackdrop').classList.remove('open');
  pendingCurrentBook = null; // discard the new book if the user backs out
}

function handleLimitChoice(e) {
  const idx    = +e.currentTarget.dataset.idx;
  const action = e.currentTarget.dataset.action;
  const book   = state.currentlyReading[idx];
  if (!book) return;
  const bookId = book.id;

  if (action === 'tbr') {
    const i = state.currentlyReading.findIndex(b => b.id === bookId);
    const b = state.currentlyReading.splice(i, 1)[0];
    state.tbrBooks.unshift(toTBREntry(b));
    addPendingBookAndClose();
    showToast(`"${b.title}" moved to TBR — now reading your new book`);
  } else if (action === 'finish') {
    openRatingPrompt(book.title, (rating) => {
      const i = state.currentlyReading.findIndex(b => b.id === bookId);
      if (i === -1) return;
      const b = state.currentlyReading.splice(i, 1)[0];
      finalizeAsRead(b, rating);
      addPendingBookAndClose();
      showToast(`"${b.title}" marked finished — now reading your new book`);
    });
  }
}

function addPendingBookAndClose() {
  if (pendingCurrentBook) {
    state.currentlyReading.push(pendingCurrentBook);
    pendingCurrentBook = null;
  }
  saveState();
  refreshAll();
  document.getElementById('limitModalBackdrop').classList.remove('open');
}

function initLimitModal() {
  document.getElementById('limitModalClose').addEventListener('click', closeLimitModal);
  document.getElementById('limitModalBackdrop').addEventListener('click', e => {
    if (e.target.id === 'limitModalBackdrop') closeLimitModal();
  });
}

/* ── "How was it?" rating prompt (Issue #10) ──
   Used whenever a book moves into readBooks outside the Add Book form. */
function openRatingPrompt(title, callback) {
  ratingCallback = callback;
  ratingSelected = 0;
  document.getElementById('rateModalBookTitle').textContent = `How would you rate "${title}"?`;
  document.querySelectorAll('#rateStarPicker .star').forEach(s => s.classList.remove('active'));
  document.getElementById('rateModalBackdrop').classList.add('open');
}

function closeRateModal() {
  document.getElementById('rateModalBackdrop').classList.remove('open');
  ratingCallback = null;
}

function initRateModal() {
  const stars = document.querySelectorAll('#rateStarPicker .star');
  stars.forEach((star, i) => {
    star.addEventListener('mouseover', () => stars.forEach((s, j) => s.classList.toggle('active', j <= i)));
    star.addEventListener('mouseout',  () => stars.forEach((s, j) => s.classList.toggle('active', j < ratingSelected)));
    star.addEventListener('click', () => {
      ratingSelected = i + 1;
      stars.forEach((s, j) => s.classList.toggle('active', j < ratingSelected));
    });
  });

  document.getElementById('rateSaveBtn').addEventListener('click', () => {
    const cb = ratingCallback;
    closeRateModal();
    if (cb) cb(ratingSelected);
  });
  document.getElementById('rateSkipBtn').addEventListener('click', () => {
    const cb = ratingCallback;
    closeRateModal();
    if (cb) cb(0);
  });
  document.getElementById('rateModalClose').addEventListener('click', closeRateModal);
  document.getElementById('rateModalBackdrop').addEventListener('click', e => {
    if (e.target.id === 'rateModalBackdrop') closeRateModal();
  });
}

/* ══ RECOMMENDATIONS (Open Library) ══════════════════ */
async function renderRecommendations(genre) {
  const grid = document.getElementById('recGrid');
  grid.innerHTML = `<p class="grid-msg">Loading recommendations…</p>`;

  const books = await fetchBooks(GENRE_QUERIES[genre] || GENRE_QUERIES.all, 12, genre);
  
  if (!books) {
    books = await fetchBooks(GENRE_QUERIES[genre] || GENRE_QUERIES.all, 12, genre);
    if (books) recCache[genre] = books;
  }

  if (books === null) {
    grid.innerHTML = `<p class="grid-msg">Couldn't reach the book service — check your connection. <button class="retry-btn" onclick="renderRecommendations('${genre}')">Retry</button></p>`;
    return;
  }
  if (!books.length) {
    grid.innerHTML = `<p class="grid-msg">No recommendations found for this genre yet.</p>`;
    return;
  }
  renderRecCards(books);
}

function renderRecCards(books) {
  const grid = document.getElementById('recGrid');
  grid.innerHTML = '';

  books.forEach((book, i) => {
    const card = document.createElement('div');
    card.className = 'rec-card';
    card.style.animationDelay = `${i * 0.05}s`;
    card.innerHTML = `
      <div class="rec-cover" style="background:${book.color}">
        ${coverHTML(book)}
        <span class="rec-genre-tag">${escapeHtml(book.genre)}</span>
      </div>
      <div class="rec-body">
        <p class="rec-title">${escapeHtml(book.title)}</p>
        <p class="rec-author">${escapeHtml(book.author)}</p>
        <div class="rec-footer">
          <span class="rec-stars"></span>
          <button class="rec-add" title="Add to TBR">+</button>
        </div>
      </div>`;
    card.querySelector('.rec-add').addEventListener('click', (e) => addToTBRFromRec(book, e));
    grid.appendChild(card);
  });
}

function addToTBRFromRec(book, event) {
  const btn = event.currentTarget;
  const already = state.tbrBooks.find(b => b.title === book.title) || state.readBooks.find(b => b.title === book.title);
  if (already) { showToast(`"${book.title}" is already in your library`); return; }

  state.tbrBooks.unshift({
    id: uid(), title: book.title, author: book.author, genre: book.genre,
    color: book.color, cover: book.cover, totalPages: book.totalPages, addedAt: Date.now()
  });
  saveState();
  refreshAll();

  btn.textContent = '✓';
  btn.style.background = 'var(--green)';
  btn.style.borderColor = 'var(--green)';
  btn.style.color = '#fff';
  btn.disabled = true;
  showToast(`"${book.title}" added to TBR!`);
}

/* ══ BUY NOW / PRICE COMPARISON (Issues #6 & #7) ═══════
   Book info (cover, author) comes from Open Library.
   Real-time prices need a paid API, so each store shows
   as a direct search link — click through to compare and buy. */
async function renderPrices() {
  const grid = document.getElementById('priceGrid');
  grid.innerHTML = `<p class="grid-msg">Loading…</p>`;

  let books;
  if (state.tbrBooks.length > 0) {
    books = state.tbrBooks;
  } else {
    if (!priceDefaults) {
      const res = await fetchBooks('bestseller fiction', 6);
      priceDefaults = res || [];
    }
    books = priceDefaults;
  }

  grid.innerHTML = '';
  if (!books.length) {
    grid.innerHTML = `<p class="grid-msg">Add a book to your TBR list to see it here for buying.</p>`;
    return;
  }

  books.forEach((book, i) => {
    const storeLinks = getStoreLinks(book.title, book.author);
    const storesHTML = storeLinks.map(s => `
      <a class="pc-store-link" href="${s.url}" target="_blank" rel="noopener">
        <span class="pc-store-name"><span class="store-dot" style="background:${s.color}"></span>${s.name}</span>
        <span class="pc-store-arrow">↗</span>
      </a>`).join('');

    const card = document.createElement('div');
    card.className = 'price-card';
    card.style.animationDelay = `${i * 0.06}s`;
    card.innerHTML = `
      <div class="pc-cover" style="background:${book.color}">${coverHTML(book)}</div>
      <div class="pc-body">
        <p class="pc-title">${escapeHtml(book.title)}</p>
        <p class="pc-author">${escapeHtml(book.author || '')}</p>
        <div class="pc-stores">${storesHTML}</div>
      </div>`;
    grid.appendChild(card);
  });
}

function getStoreLinks(title, author) {
  const q = encodeURIComponent(`${title} ${author || ''} book`.trim());
  return STORES.map(s => ({ name: s.name, color: s.color, url: s.build(q) }));
}

/* ══ SHELF PAGE (Books Read + TBR) ═══════════════════ */
function renderShelfPage(filter = '') {
  renderReadGrid(filter);
  renderTBRGrid(filter);
  document.getElementById('tabCountRead').textContent = state.readBooks.length;
  document.getElementById('tabCountTBR').textContent  = state.tbrBooks.length;
}

/* ── Read Grid ── */
function renderReadGrid(filter) {
  const grid  = document.getElementById('readGrid');
  const empty = document.getElementById('readEmpty');
  const sort  = document.getElementById('readSort')?.value || 'recent';
  let books   = [...state.readBooks];

  if (filter) {
    const q = filter.toLowerCase();
    books = books.filter(b => b.title.toLowerCase().includes(q) || b.author.toLowerCase().includes(q));
  }

  if (sort === 'rating') books.sort((a,b) => b.rating - a.rating);
  else if (sort === 'alpha') books.sort((a,b) => a.title.localeCompare(b.title));
  else books.sort((a,b) => b.addedAt - a.addedAt);

  grid.innerHTML = '';
  empty.classList.toggle('hidden', books.length > 0);
  if (books.length === 0) return;

  books.forEach((book, i) => {
    const stars = book.rating ? '★'.repeat(book.rating) + '☆'.repeat(5 - book.rating) : '';
    const card  = document.createElement('div');
    card.className = 'book-card';
    card.style.animationDelay = `${i * 0.05}s`;
    card.innerHTML = `
      <div class="book-card-cover" style="background:${book.color}">${coverHTML(book)}</div>
      <div class="book-card-body">
        <p class="book-card-title">${escapeHtml(book.title)}</p>
        <p class="book-card-author">${escapeHtml(book.author)}</p>
        <span class="book-card-genre">${escapeHtml(book.genre)}</span>
        ${stars ? `<p class="book-card-rating">${stars}</p>` : ''}
        ${book.notes ? `<p class="book-card-notes">${escapeHtml(book.notes)}</p>` : ''}
        <div class="book-card-actions">
          <button class="bca-btn remove" onclick="removeBook('${book.id}','read')">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>
            Remove
          </button>
          <button class="bca-btn move" onclick="moveToTBR('${book.id}')">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-3.84"/></svg>
            Move to TBR
          </button>
        </div>
      </div>`;
    grid.appendChild(card);
  });
}

/* ── TBR Grid ── */
function renderTBRGrid(filter) {
  const grid  = document.getElementById('tbrGrid');
  const empty = document.getElementById('tbrEmpty');
  const sort  = document.getElementById('tbrSort')?.value || 'recent';
  let books   = [...state.tbrBooks];

  if (filter) {
    const q = filter.toLowerCase();
    books = books.filter(b => b.title.toLowerCase().includes(q) || b.author.toLowerCase().includes(q));
  }

  if (sort === 'alpha') books.sort((a,b) => a.title.localeCompare(b.title));
  else books.sort((a,b) => b.addedAt - a.addedAt);

  grid.innerHTML = '';
  empty.classList.toggle('hidden', books.length > 0);
  if (books.length === 0) return;

  books.forEach((book, i) => {
    const storeLinks = getStoreLinks(book.title, book.author);
    const buyMenuItems = storeLinks.map(s => `
      <a class="buy-menu-item" href="${s.url}" target="_blank" rel="noopener">
        <span class="buy-menu-store">
          <span class="buy-menu-dot" style="background:${s.color}"></span>
          ${s.name}
        </span>
        <span class="pc-store-arrow">↗</span>
      </a>`).join('');

    const card = document.createElement('div');
    card.className = 'book-card';
    card.style.animationDelay = `${i * 0.05}s`;
    card.innerHTML = `
      <div class="book-card-cover" style="background:${book.color}">${coverHTML(book)}</div>
      <div class="book-card-body">
        <p class="book-card-title">${escapeHtml(book.title)}</p>
        <p class="book-card-author">${escapeHtml(book.author)}</p>
        <span class="book-card-genre">${escapeHtml(book.genre)}</span>
        <div class="book-card-actions">
          <button class="bca-btn remove" onclick="removeBook('${book.id}','tbr')">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>
            Remove
          </button>
          <button class="bca-btn move" onclick="moveToRead('${book.id}')">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
            Mark read
          </button>
          <div class="buy-dropdown">
            <button class="bca-btn buy" onclick="toggleBuyMenu('${book.id}',event)">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg>
              Buy ▾
            </button>
            <div class="buy-menu" id="buy-menu-${book.id}">
              <div class="buy-menu-title">Compare &amp; buy</div>
              ${buyMenuItems}
            </div>
          </div>
        </div>
      </div>`;
    grid.appendChild(card);
  });
}

function toggleBuyMenu(id, event) {
  event.stopPropagation();
  const menu = document.getElementById('buy-menu-' + id);
  const isOpen = menu.classList.contains('open');
  closeAllBuyMenus();
  if (!isOpen) menu.classList.add('open');
}

function closeAllBuyMenus() {
  document.querySelectorAll('.buy-menu.open').forEach(m => m.classList.remove('open'));
}

/* ── Shelf actions ── */
function removeBook(id, list) {
  const arr = list === 'read' ? state.readBooks : state.tbrBooks;
  const idx = arr.findIndex(b => b.id === id);
  if (idx === -1) return;
  const book = arr.splice(idx, 1)[0];
  saveState();
  refreshAll();
  showToast(`"${book.title}" removed`);
}

/* TBR -> Read: asks for a rating since the user just finished it (Issue #10) */
function moveToRead(id) {
  const book = state.tbrBooks.find(b => b.id === id);
  if (!book) return;

  openRatingPrompt(book.title, (rating) => {
    const idx = state.tbrBooks.findIndex(b => b.id === id);
    if (idx === -1) return;
    const b = state.tbrBooks.splice(idx, 1)[0];
    finalizeAsRead(b, rating);
    saveState();
    refreshAll();
    showToast(`"${b.title}" marked as read!`);
  });
}

/* Read -> TBR: drops rating/finished date since it's unread again */
function moveToTBR(id) {
  const idx = state.readBooks.findIndex(b => b.id === id);
  if (idx === -1) return;
  const book = state.readBooks.splice(idx, 1)[0];
  state.tbrBooks.unshift(toTBREntry(book));
  saveState();
  refreshAll();
  showToast(`"${book.title}" moved to TBR`);
}

/* ══ STATS ═══════════════════════════════════════════ */
function renderStats() {
  const grid = document.getElementById('statsGrid');
  if (!grid) return;
  const thisYear  = new Date().getFullYear();
  const yearBooks = state.readBooks.filter(b => b.finishedYear === thisYear);
  const ratings   = state.readBooks.filter(b => b.rating > 0).map(b => b.rating);
  const avg       = ratings.length ? (ratings.reduce((a,b) => a+b,0)/ratings.length).toFixed(1) : '—';
  const genreCounts = {};
  state.readBooks.forEach(b => { genreCounts[b.genre] = (genreCounts[b.genre]||0) + 1; });
  const topGenre = Object.entries(genreCounts).sort((a,b) => b[1]-a[1])[0];
  const goalLabel = state.goal.type === 'monthly' ? 'this month' : `${thisYear}`;
  const goalCount = state.goal.type === 'monthly'
    ? state.readBooks.filter(b => {
        if (!b.finishedDate) return false;
        const d = new Date(b.finishedDate);
        const now = new Date();
        return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
      }).length
    : yearBooks.length;

  const cards = [
    { val: state.readBooks.length, label:"Total books read",   sub:"All time" },
    { val: state.tbrBooks.length,  label:"Books in TBR queue",  sub:"Waiting to be read" },
    { val: yearBooks.length,       label:"Read this year",      sub:`${thisYear}` },
    { val: avg === '—' ? avg : avg+'★', label:"Average rating", sub:"From books you've rated" },
    { val: topGenre ? topGenre[1] : 0, label: topGenre ? topGenre[0] : 'Top genre', sub: topGenre ? "Most read genre" : "No genre yet" },
    { val: Math.max(0, state.goal.target - goalCount), label:"Books to goal", sub:`${state.goal.type === 'monthly' ? 'Monthly' : 'Yearly'} goal — ${goalLabel}` },
  ];

  grid.innerHTML = '';
  cards.forEach((c, i) => {
    const el = document.createElement('div');
    el.className = 'stat-card';
    el.style.animationDelay = `${i * 0.07}s`;
    el.innerHTML = `
      <div class="stat-card-val">${c.val}</div>
      <div class="stat-card-label">${escapeHtml(String(c.label))}</div>
      <div class="stat-card-sub">${escapeHtml(c.sub)}</div>`;
    grid.appendChild(el);
  });
}

/* ══ PAGE NAVIGATION ════════════════════════════════ */
function initPageNav() {
  document.querySelectorAll('.sb-link').forEach(link => {
    link.addEventListener('click', e => {
      e.preventDefault();
      const section = link.dataset.section;
      navigateTo(section);
      document.querySelectorAll('.sb-link').forEach(l => l.classList.remove('active'));
      link.classList.add('active');
      if (window.innerWidth < 900) {
        document.getElementById('sidebar').classList.remove('open');
        document.getElementById('overlay').classList.remove('show');
      }
    });
  });
}

function navigateTo(section) {
  const pageMap = {
    dashboard: 'page-dashboard',
    shelf:     'page-shelf',
    tbr:       'page-shelf',
    prices:    'page-prices',
    stats:     'page-stats',
  };

  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  const pageId = pageMap[section] || 'page-dashboard';
  document.getElementById(pageId).classList.add('active');

  if (section === 'shelf') switchTab('read');
  if (section === 'tbr')   switchTab('tbr');

  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* ══ TAB SWITCHER ════════════════════════════════════ */
function initTabSwitcher() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  document.getElementById('readSort').addEventListener('change', () => renderReadGrid(''));
  document.getElementById('tbrSort').addEventListener('change',  () => renderTBRGrid(''));
}

function switchTab(tab) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  document.getElementById('tab-' + tab).classList.add('active');
}

/* ══ TAB SEARCH (within shelf/TBR) ════════════════════ */
function initTabSearch() {
  let rt, tt;
  document.getElementById('readSearch').addEventListener('input', e => {
    clearTimeout(rt);
    rt = setTimeout(() => renderReadGrid(e.target.value), 250);
  });
  document.getElementById('tbrSearch').addEventListener('input', e => {
    clearTimeout(tt);
    tt = setTimeout(() => renderTBRGrid(e.target.value), 250);
  });
}

/* ══ FILTER PILLS (recommendations) ══════════════════ */
function initFilters() {
  document.getElementById('filterPills').addEventListener('click', e => {
    const pill = e.target.closest('.fpill');
    if (!pill) return;
    document.querySelectorAll('.fpill').forEach(p => p.classList.remove('active'));
    pill.classList.add('active');
    document.getElementById('searchInput').value = '';
    renderRecommendations(pill.dataset.genre);
  });
}

/* ══ TOPBAR SEARCH (live Open Library search) ════════ */
function initSearch() {
  let timeout;
  document.getElementById('searchInput').addEventListener('input', e => {
    clearTimeout(timeout);
    const q = e.target.value.trim();

    timeout = setTimeout(async () => {
      if (!q) {
        const active = document.querySelector('.fpill.active');
        renderRecommendations(active ? active.dataset.genre : 'all');
        return;
      }
      const grid = document.getElementById('recGrid');
      grid.innerHTML = `<p class="grid-msg">Searching…</p>`;
      const results = await fetchBooks(q, 12);
      if (results === null) {
        grid.innerHTML = `<p class="grid-msg">Search failed — check your connection. <button class="retry-btn" onclick="document.getElementById('searchInput').dispatchEvent(new Event('input'))">Retry</button></p>`;
        return;
      }
      if (!results.length) {
        grid.innerHTML = `<p class="grid-msg">No results for "${escapeHtml(q)}"</p>`;
        return;
      }
      renderRecCards(results);
    }, 350);
  });
}

/* ══ SIDEBAR ═════════════════════════════════════════ */
function initSidebar() {
  const sidebar  = document.getElementById('sidebar');
  const overlay  = document.getElementById('overlay');
  const menuBtn  = document.getElementById('menuBtn');
  const closeBtn = document.getElementById('sbClose');
  const open  = () => { sidebar.classList.add('open'); overlay.classList.add('show'); };
  const close = () => { sidebar.classList.remove('open'); overlay.classList.remove('show'); };
  menuBtn.addEventListener('click', open);
  closeBtn.addEventListener('click', close);
  overlay.addEventListener('click', close);
}

/* ══ LOGOUT ══════════════════════════════════════════ */
function initLogout() {
  const logoutBtn = document.getElementById('logoutBtn');
  const modalBackdrop = document.getElementById('signoutModalBackdrop');
  const closeBtn = document.getElementById('signoutModalClose');
  const cancelBtn = document.getElementById('cancelSignoutBtn');
  const confirmBtn = document.getElementById('confirmSignoutBtn');

  // Open modal
  logoutBtn.addEventListener('click', (e) => {
    e.preventDefault();
    modalBackdrop.classList.add('active');
  });

  // Close modal
  function closeModal() {
    modalBackdrop.classList.remove('active');
  }

  closeBtn.addEventListener('click', closeModal);
  cancelBtn.addEventListener('click', closeModal);

  // Close when clicking outside modal
  modalBackdrop.addEventListener('click', (e) => {
    if (e.target === modalBackdrop) {
      closeModal();
    }
  });

  // Confirm sign out
  confirmBtn.addEventListener('click', async () => {
    document.getElementById('logoutStatus').textContent = 'Logout processing...';

    try {
      await fetch('/auth/logout', {
        method: 'POST',
        credentials: 'include'
      });
    } catch (err) {
      console.error(err);
    }
  setTimeout(() => {
      window.location.href = '/login';}, 2000); // 2000 ms = 2 seconds
  });
}

/* ══ MODAL (Add book) ════════════════════════════════ */
function initModal() {
  const backdrop = document.getElementById('modalBackdrop');
  const openBtn  = document.getElementById('addBookBtn');
  const closeBtn = document.getElementById('modalClose');
  const saveBtn  = document.getElementById('saveBookBtn');
  const statusSel = document.getElementById('mStatus');
  const dateField = document.getElementById('mDateField');
  const ratingRow = document.getElementById('mRatingRow');
  let selectedCover = '';

  const open  = () => backdrop.classList.add('open');
  const close = () => backdrop.classList.remove('open');

  openBtn.addEventListener('click', open);
  closeBtn.addEventListener('click', close);
  backdrop.addEventListener('click', e => { if (e.target === backdrop) close(); });

  // Show date-finished + rating only when status = "I've read this" (Issue #5 & #10)
  function syncFormToStatus() {
    const isRead = statusSel.value === 'READ';
    dateField.classList.toggle('hidden', !isRead);
    ratingRow.classList.toggle('hidden', !isRead);
    if (isRead && !document.getElementById('mDateFinished').value) {
      document.getElementById('mDateFinished').value = new Date().toISOString().slice(0, 10);
    }
  }
  statusSel.addEventListener('change', syncFormToStatus);
  syncFormToStatus();

  // Auto-fill from Open Library (Issues #1 & #3)
  document.getElementById('autoFillBtn').addEventListener('click', async () => {
    const q = document.getElementById('autoFillInput').value.trim();
    if (!q) return;
    showToast('Searching…');
    const results = await fetchBooks(q, 1);

    if (results === null) {
      showToast('Search failed — check your connection, or fill details manually');
      return;
    }
    if (results.length) {
      const found = results[0];
      document.getElementById('mTitle').value  = found.title;
      document.getElementById('mAuthor').value = found.author;
      if (found.totalPages) document.getElementById('mPages').value = found.totalPages;
      selectedCover = found.cover || '';

      const genreSelect = document.getElementById('mGenre');
      const match = Array.from(genreSelect.options).find(
        o => o.value.toLowerCase() === (found.genre || '').toLowerCase()
      );
      if (match) genreSelect.value = match.value;

      showToast('Book details auto-filled!');
    } else {
      selectedCover = '';
      showToast('Not found — fill details manually');
    }
  });

  // Save
  saveBtn.addEventListener('click', () => {
    const title  = toTitleCase(document.getElementById('mTitle').value.trim());
    const author = toTitleCase(document.getElementById('mAuthor').value.trim());
    const genre  = document.getElementById('mGenre').value;
    const status = statusSel.value;
    const notes  = document.getElementById('mNotes').value.trim();
    const pagesVal = parseInt(document.getElementById('mPages').value, 10);
    const totalPages = (!isNaN(pagesVal) && pagesVal > 0) ? pagesVal : null;

    if (!title) { showToast('Please enter a book title'); return; }

    const color = BOOK_COLORS[Math.floor(Math.random() * BOOK_COLORS.length)];
    const book  = { id: uid(), title, author, genre, color, cover: selectedCover, totalPages, addedAt: Date.now(), notes };

    if (status === 'READ') {
      const dateVal = document.getElementById('mDateFinished').value;
      const finishedDate = dateVal ? new Date(dateVal) : new Date();
      state.readBooks.unshift({
        ...book, rating: currentRating,
        finishedDate: finishedDate.toISOString(),
        finishedYear: finishedDate.getFullYear(),
        finishedMonth: finishedDate.getMonth()
      });
      saveState();
      refreshAll();
      showToast(`"${title}" added to your shelf!`);
      resetAndClose();
    } else if (status === 'TBR') {
      state.tbrBooks.unshift(book);
      saveState();
      refreshAll();
      showToast(`"${title}" added to TBR!`);
      resetAndClose();
    } else {
      // Currently reading — goes through the 2-book limit check (Issue #8)
      close();
      resetForm();
      tryAddCurrentlyReading(book);
    }
  });

  function resetForm() {
    ['mTitle','mAuthor','mNotes','autoFillInput','mPages','mDateFinished'].forEach(id => document.getElementById(id).value = '');
    currentRating  = 0;
    selectedCover  = '';
    document.querySelectorAll('#starPicker .star').forEach(s => s.classList.remove('active'));
    statusSel.value = 'READ';
    syncFormToStatus();
  }

  function resetAndClose() {
    resetForm();
    close();
  }
}

/* ══ STAR PICKER (Add Book modal) ════════════════════ */
function initStarPicker() {
  const stars = document.querySelectorAll('#starPicker .star');
  stars.forEach((star, i) => {
    star.addEventListener('mouseover', () => {
      stars.forEach((s, j) => s.classList.toggle('active', j <= i));
    });
    star.addEventListener('mouseout', () => {
      stars.forEach((s, j) => s.classList.toggle('active', j < currentRating));
    });
    star.addEventListener('click', () => {
      currentRating = i + 1;
      stars.forEach((s, j) => s.classList.toggle('active', j < currentRating));
    });
  });
}

/* ══ TOAST ═══════════════════════════════════════════ */
function showToast(msg) {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 2800);
}