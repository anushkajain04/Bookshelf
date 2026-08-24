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

/* Genre search queries per filter pill — subject: targets Google Books'
   category taxonomy so results actually match the genre, instead of a
   loose keyword match that returns unrelated books. */
const GENRE_QUERIES = {
  all:         'subject:"fiction"',
  'self-help': 'subject:"self-help"',
  fiction:     'subject:"fiction"',
  business:    'subject:"business"',
  philosophy:  'subject:"philosophy"',
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
  challenge: null          // {id,duration,target,startDate,endDate,status} — see createChallenge()
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
/* Scores a book by how complete its data is, so when two duplicate
   records collide we keep the better one (has a cover, a genre, a
   rating, progress, etc.) instead of an arbitrary one. */
function bookCompletenessScore(b) {
  return (b.cover ? 1 : 0) + (b.genre ? 1 : 0) + (b.rating > 0 ? 1 : 0)
       + (b.totalPages ? 1 : 0) + (b.currentPage > 0 ? 1 : 0) + (b.finishedDate ? 1 : 0);
}

/* Collapses duplicate entries (same title + author) in a shelf array
   down to the single most-complete record. Safe to run on every load. */
function dedupeShelf(arr) {
  const map = new Map();
  arr.forEach(book => {
    const key = normalizeTitleKey(book.title) + '|' + normalizeTitleKey(book.author || '');
    const existing = map.get(key);
    if (!existing || bookCompletenessScore(book) > bookCompletenessScore(existing)) {
      map.set(key, book);
    }
  });
  return Array.from(map.values());
}

/* Looks across all three shelves for a book with the same title+author.
   Used to block accidental duplicate adds (Issue: duplicate entries). */
function findExistingBook(title, author) {
  const key = normalizeTitleKey(title) + '|' + normalizeTitleKey(author || '');
  const shelves = [
    ['read', state.readBooks],
    ['tbr', state.tbrBooks],
    ['currentlyReading', state.currentlyReading],
  ];
  for (const [shelfName, arr] of shelves) {
    const match = arr.find(b => normalizeTitleKey(b.title) + '|' + normalizeTitleKey(b.author || '') === key);
    if (match) return { book: match, shelf: shelfName };
  }
  return null;
}

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

  // Collapse any duplicate entries already sitting in saved data
  // (e.g. the same book added twice before this fix existed).
  state.readBooks       = dedupeShelf(state.readBooks);
  state.tbrBooks         = dedupeShelf(state.tbrBooks);
  state.currentlyReading = dedupeShelf(state.currentlyReading);

  // Migrate the old simple goal into a Reading Challenge, once.
  if (!state.challenge || typeof state.challenge !== 'object') {
    if (state.goal && typeof state.goal === 'object' && state.goal.target) {
      const duration = state.goal.type === 'monthly' ? 'monthly' : 'yearly';
      state.challenge = createChallenge(duration, state.goal.target, new Date());
    } else {
      state.challenge = null;
    }
  }
  delete state.goal;

  refreshChallengeStatus();
  saveState();
}

function saveState() {
  localStorage.setItem(`bookshelfState_${getCurrentUserId()}`, JSON.stringify(state));
}

function uid() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

/* ══ READING CHALLENGE ═══════════════════════════════
   duration: 'weekly' | 'monthly' | 'yearly'
   status:   'active' | 'completed' | 'expired' */
function getChallengeEndDate(duration, startDate) {
  const end = new Date(startDate);
  if (duration === 'weekly')       end.setDate(end.getDate() + 7);
  else if (duration === 'monthly') end.setMonth(end.getMonth() + 1);
  else                              end.setFullYear(end.getFullYear() + 1);
  end.setMilliseconds(end.getMilliseconds() - 1);
  return end;
}

function createChallenge(duration, target, startDate = new Date()) {
  const start = new Date(startDate);
  return {
    id: uid(),
    duration,
    target,
    startDate: start.toISOString(),
    endDate: getChallengeEndDate(duration, start).toISOString(),
    status: 'active'
  };
}

/* Only books finished within [startDate, endDate] count (Issue #3) */
function countBooksInChallenge(challenge) {
  if (!challenge) return 0;
  const start = new Date(challenge.startDate);
  const end   = new Date(challenge.endDate);
  return state.readBooks.filter(b => {
    if (!b.finishedDate) return false;
    const d = new Date(b.finishedDate);
    return d >= start && d <= end;
  }).length;
}

/* Marks the current challenge completed/expired as needed. Call this
   before any read of state.challenge so status is always current. */
function refreshChallengeStatus() {
  const c = state.challenge;
  if (!c || c.status !== 'active') return;
  const count = countBooksInChallenge(c);
  if (count >= c.target) {
    c.status = 'completed';
  } else if (new Date() > new Date(c.endDate)) {
    c.status = 'expired';
  }
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
  initChallengeEditor();
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

/* ══ BOOK SEARCH — Google Books (primary) + Open Library (fallback) ══
   Returns: array of mapped books on success,
            [] when every source responds but finds nothing,
            null when every source's request itself fails (network/CORS).

   Order: Google Books title search -> Google Books general search ->
          Open Library title search -> Open Library general search.
   Google Books is tried first because it handles Hindi/transliterated
   titles and general relevance far better than Open Library. */
async function fetchBooks(query, maxResults = 12, fallbackGenre = "General", searchType = "general") {
    const attempts = searchType === "title"
        ? [() => fetchFromGoogleBooks(query, maxResults, fallbackGenre, "title"),
           () => fetchFromGoogleBooks(query, maxResults, fallbackGenre, "general"),
           () => fetchFromOpenLibrary(query, maxResults, fallbackGenre, "title"),
           () => fetchFromOpenLibrary(query, maxResults, fallbackGenre, "general")]
        : [() => fetchFromGoogleBooks(query, maxResults, fallbackGenre, "general"),
           () => fetchFromOpenLibrary(query, maxResults, fallbackGenre, "general")];

    let sawSuccess = false;

    for (const attempt of attempts) {
        const result = await attempt();
        if (result === null) continue;      // that source failed outright, try the next
        sawSuccess = true;
        if (result.length) return dedupeBooks(result).slice(0, maxResults);
        // source responded but found nothing — fall through to the next source
    }

    return sawSuccess ? [] : null;
}

/* ── Google Books (primary source) ── */
async function fetchFromGoogleBooks(query, maxResults, fallbackGenre, searchType) {
    try {
        const q = searchType === "title" ? `intitle:${query}` : query;
        const url = `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(q)}&maxResults=${Math.min(maxResults, 40)}`;

        const res = await fetch(url);
        if (!res.ok) throw new Error("Google Books error");

        const data = await res.json();
        return (data.items || []).map(item => mapGoogleBooksItem(item, fallbackGenre));

    } catch (e) {
        console.error("Google Books search failed:", e);
        return null;
    }
}

function mapGoogleBooksItem(item, fallbackGenre) {
  const info = item.volumeInfo || {};
  const rawTitle  = info.title || '';
  const rawAuthor = (info.authors && info.authors[0]) || 'Unknown Author';

  let genre = fallbackGenre || 'General';
  if (Array.isArray(info.categories)) {
    const match = info.categories.find(c => KNOWN_GENRES.some(k => k.toLowerCase() === String(c).toLowerCase()));
    if (match) genre = match;
    else if (info.categories[0] && info.categories[0].length < 28) genre = info.categories[0];
  }

  const images = info.imageLinks || {};
  const cover  = (images.thumbnail || images.smallThumbnail || '').replace(/^http:/, 'https:');

  return {
    title:  toTitleCase(rawTitle),
    author: toTitleCase(rawAuthor),
    genre:  toTitleCase(genre),
    cover,
    totalPages: info.pageCount || null,
    color:  BOOK_COLORS[Math.floor(Math.random() * BOOK_COLORS.length)]
  };
}

/* ── Open Library (fallback source) ── */
async function fetchFromOpenLibrary(query, maxResults, fallbackGenre, searchType) {
    try {
        const url = searchType === "title"
          ? `https://openlibrary.org/search.json?title=${encodeURIComponent(query)}&limit=${maxResults}&fields=key,title,author_name,cover_i,subject,number_of_pages_median,first_publish_year`
          : `https://openlibrary.org/search.json?q=${encodeURIComponent(query)}&limit=${maxResults}&fields=key,title,author_name,cover_i,subject,number_of_pages_median,first_publish_year`;

        const res = await fetch(url);
        if (!res.ok) throw new Error("Open Library error");

        const data = await res.json();
        let books = (data.docs || []).map(doc => mapDoc(doc, fallbackGenre));

        if (searchType === "title") {
            const keyword = query.toLowerCase();
            books = books.filter(book => book.title.toLowerCase().includes(keyword));
        }

        return books.slice(0, maxResults);

    } catch (e) {
        console.error("Open Library search failed:", e);
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

/* ===== PERSONALIZED RECOMMENDATION HELPERS ===== */

/* Shuffles a copy of the array (Fisher-Yates) — used to keep
   recommendations from looking identical on every refresh. */
function shuffleArray(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/* Builds a pool of candidate search queries from everything the user
   owns — Read + Currently Reading + TBR — so recommendations reflect
   the whole library, not just one dominant genre. */
function getRecommendationQueries() {
    const books = [
        ...state.readBooks,
        ...state.tbrBooks,
        ...state.currentlyReading
    ];

    if (books.length === 0)
        return ["bestseller fiction"];

    const genreCounts  = {};
    const authorCounts = {};

    books.forEach(book => {
        const genre = (book.genre || "fiction").toLowerCase();
        genreCounts[genre] = (genreCounts[genre] || 0) + 1;

        if (book.author) {
            const author = book.author.toLowerCase();
            authorCounts[author] = (authorCounts[author] || 0) + 1;
        }
    });

    const topGenres = Object.entries(genreCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([g]) => `subject:"${g}"`);

    const topAuthors = Object.entries(authorCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 2)
        .map(([a]) => `inauthor:"${a}"`);

    const queries = [...topGenres, ...topAuthors];
    return queries.length ? queries : ["bestseller fiction"];
}

/* Normalizes a title for comparison — strips parenthetical notes
   (e.g. "(Unabridged)"), subtitles after a colon/dash, and punctuation —
   so different editions of the same book aren't treated as different
   books (fixes duplicate entries from Google Books). */
function normalizeTitleKey(title) {
  return String(title || '')
    .toLowerCase()
    .replace(/\(.*?\)/g, '')
    .replace(/[:\-–—].*$/, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function dedupeBooks(books) {
  const seen = new Set();
  return books.filter(book => {
    const key = normalizeTitleKey(book.title);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function removeOwnedBooks(books) {
    const owned = new Set(
        [
            ...state.readBooks,

            ...state.tbrBooks,

            ...state.currentlyReading

        ].map(book => normalizeTitleKey(book.title))
    );

    return books.filter(book =>
        !owned.has(normalizeTitleKey(book.title))
    );

}

/* Renders a cover image if available, otherwise the title on a color block.
   If the image URL 404s or fails to load, swap it for the title text
   instead of leaving an empty box (Issue: covers vanishing on error). */
function coverHTML(book) {
  if (book.cover) {
    return `<img class="cover-img" src="${book.cover}" alt="" loading="lazy" data-fallback-title="${escapeHtml(book.title)}" onerror="handleCoverError(this)"/>`;
  }
  return `<span>${escapeHtml(book.title)}</span>`;
}

function handleCoverError(img) {
  const span = document.createElement('span');
  span.textContent = img.dataset.fallbackTitle || '';
  img.replaceWith(span);
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

  renderChallenge();
  renderCurrentlyReading();
}

/* ── Reading Challenge (Issue #4) ──
   Weekly / monthly / yearly challenges with a start/end date, a status
   (active/completed/expired), and a manual restart. Progress counts
   only books finished within the challenge's own date window, so
   backdating old books doesn't skew it (Issue #3). */
function renderChallenge() {
  refreshChallengeStatus();
  saveState();

  const label   = document.getElementById('goalLabel');
  const pct     = document.getElementById('goalPct');
  const fill    = document.getElementById('goalFill');
  const status  = document.getElementById('goalStatus');
  const restart = document.getElementById('goalRestartBtn');
  const c       = state.challenge;

  if (!c) {
    if (label)  label.textContent  = 'No active reading challenge';
    if (pct)    pct.textContent    = 'Start one to track your progress';
    if (status) { status.textContent = ''; delete status.dataset.status; }
    if (restart) restart.classList.add('hidden');
    setTimeout(() => { if (fill) fill.style.width = '0%'; }, 300);
    return;
  }

  const count = countBooksInChallenge(c);
  const pctVal = c.target > 0 ? Math.min(100, Math.round((count / c.target) * 100)) : 0;
  const durationLabel = { weekly: 'Weekly', monthly: 'Monthly', yearly: 'Yearly' }[c.duration] || 'Reading';
  const statusLabel   = { active: 'In progress', completed: 'Completed 🎉', expired: 'Expired' }[c.status] || '';

  if (label)  label.textContent  = `${durationLabel} reading challenge`;
  if (pct)    pct.textContent    = `${count} / ${c.target} books`;
  if (status) { status.textContent = statusLabel; status.dataset.status = c.status; }
  if (restart) restart.classList.toggle('hidden', c.status === 'active');

  setTimeout(() => { if (fill) fill.style.width = pctVal + '%'; }, 300);
}

function initChallengeEditor() {
  const form      = document.getElementById('goalEditForm');
  const editBtn   = document.getElementById('goalEditBtn');
  const typeSel   = document.getElementById('goalType');      // options: weekly / monthly / yearly
  const target    = document.getElementById('goalTarget');
  const restartBtn = document.getElementById('goalRestartBtn');

  editBtn.addEventListener('click', () => {
    typeSel.value = state.challenge ? state.challenge.duration : 'monthly';
    target.value  = state.challenge ? state.challenge.target : 12;
    form.classList.toggle('hidden');
  });

  document.getElementById('goalSaveBtn').addEventListener('click', () => {
    let t = parseInt(target.value, 10);
    if (isNaN(t) || t < 1) t = 1;
    state.challenge = createChallenge(typeSel.value, t);
    saveState();
    renderChallenge();
    renderStats();
    form.classList.add('hidden');
    showToast('Reading challenge started!');
  });

  if (restartBtn) {
    restartBtn.addEventListener('click', () => {
      if (!state.challenge) return;
      state.challenge = createChallenge(state.challenge.duration, state.challenge.target);
      saveState();
      renderChallenge();
      renderStats();
      showToast('Reading challenge restarted!');
    });
  }
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
    renderRecommendations("all");
    showToast(`"${b.title}" marked as finished!`);
  });
}

function moveCRToTBR(idx) {
  const book = state.currentlyReading.splice(idx, 1)[0];
  if (!book) return;
  state.tbrBooks.unshift(toTBREntry(book));
  saveState();
  refreshAll();
  renderRecommendations("all");
  showToast(`"${book.title}" moved to TBR`);
}

function removeCR(idx) {
  const book = state.currentlyReading.splice(idx, 1)[0];
  if (!book) return;
  saveState();
  refreshAll();
  renderRecommendations("all");
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
    renderRecommendations("all");
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
  renderRecommendations("all");
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

/* ══ RECOMMENDATIONS (Google Books + Open Library) ══════════════════
   Personalized from Read + Currently Reading + TBR shelves (Issue #2).
   A genre pill (not "all") pins the query to that genre; otherwise we
   draw from a shuffled mix of the user's top genres/authors, and
   shuffle the merged, de-duped, owned-book-filtered result again
   before display — so every refresh looks different. */
async function renderRecommendations(genre){
    const grid = document.getElementById("recGrid");
    grid.innerHTML = `<p class="grid-msg">Loading recommendations...</p>`;

    const queries = (genre && genre !== 'all' && GENRE_QUERIES[genre])
        ? [GENRE_QUERIES[genre]]
        : shuffleArray(getRecommendationQueries()).slice(0, 2);

    const results = await Promise.all(queries.map(q => fetchBooks(q, 20)));

    if (results.every(r => r === null)) {
        grid.innerHTML = `<p class="grid-msg">Couldn't load recommendations.</p>`;
        return;
    }

    // Merge query results, de-duping by normalized title
    let books = dedupeBooks(results.flatMap(r => r || []));

    const filtered = removeOwnedBooks(books);
    // If filtering removed everything, show the original list instead.
    books = filtered.length ? filtered : books;

    renderRecCards(shuffleArray(books).slice(0, 12));
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
        <span class="rec-genre-tag">Recommended for you
        </span>
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
  const already = state.tbrBooks.find(b => normalizeTitleKey(b.title) === normalizeTitleKey(book.title))
    || state.readBooks.find(b => normalizeTitleKey(b.title) === normalizeTitleKey(book.title));
  if (already) { showToast(`"${book.title}" is already in your library`); return; }

  state.tbrBooks.unshift({
    id: uid(), title: book.title, author: book.author, genre: book.genre,
    color: book.color, cover: book.cover, totalPages: book.totalPages, addedAt: Date.now()
  });
  saveState();
  refreshAll();
  renderRecommendations("all");

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
  renderRecommendations("all");
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
    renderRecommendations("all");
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
  renderRecommendations("all");
  showToast(`"${book.title}" moved to TBR`);
}

/* ══ STATS ═══════════════════════════════════════════ */
function renderStats() {
  const grid = document.getElementById('statsGrid');
  if (!grid) return;
  const ratings   = state.readBooks.filter(b => b.rating > 0).map(b => b.rating);
  const avg       = ratings.length ? (ratings.reduce((a,b) => a+b,0)/ratings.length).toFixed(1) : '—';

  // Only count books that actually have a genre set — books added
  // without picking one were skewing "most read genre" toward blank.
  const genreCounts = {};
  state.readBooks.forEach(b => {
    if (!b.genre) return;
    genreCounts[b.genre] = (genreCounts[b.genre] || 0) + 1;
  });
  const topGenre = Object.entries(genreCounts).sort((a,b) => b[1]-a[1])[0];

  refreshChallengeStatus();
  const challenge = state.challenge;
  const challengeCount = challenge ? countBooksInChallenge(challenge) : 0;
  const challengeDurationLabel = challenge
    ? ({ weekly: 'Weekly', monthly: 'Monthly', yearly: 'Yearly' }[challenge.duration] || 'Reading')
    : null;
  const challengeSub = challenge
    ? `${challengeDurationLabel} challenge — ${challenge.status}`
    : 'No active challenge';

  const cards = [
    { val: state.readBooks.length, label:"Total books read",   sub:"All time" },
    { val: state.tbrBooks.length,  label:"Books in TBR queue",  sub:"Waiting to be read" },
    // "Read this year" was unreliable once Finished Date started
    // defaulting to blank — swapped for progress within the active
    // challenge instead, which is what "books read till now" means
    // in a weekly/monthly/yearly system.
    { val: challenge ? challengeCount : state.readBooks.length, label: challenge ? `Read this ${challenge.duration.replace('ly','')}` : "Books read till now", sub: challenge ? challengeSub : "All time" },
    { val: avg === '—' ? avg : avg+'★', label:"Average rating", sub:"From books you've rated" },
    { val: topGenre ? topGenre[1] : 0, label: topGenre ? topGenre[0] : 'No genre data yet', sub: topGenre ? "Most read genre" : "Add genres when saving books" },
    { val: challenge ? Math.max(0, challenge.target - challengeCount) : '—', label:"Books to goal", sub: challengeSub },
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
      const results = await fetchBooks(q, 5);
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

  document.getElementById("closeSearchModal").addEventListener("click",()=>{
    document.getElementById("searchModal").classList.remove("open");
  });

  document.getElementById("searchModal").addEventListener("click",function(e){

    if(e.target===this){
        this.classList.remove("open");
    }

});

  // Show date-finished + rating only when status = "I've read this" (Issue #5 & #10)
  function syncFormToStatus() {
    const isRead = statusSel.value === 'READ';
    dateField.classList.toggle('hidden', !isRead);
    ratingRow.classList.toggle('hidden', !isRead);
    // Finished Date stays blank by default (Issue #3) — backdating an old
    // book to "Read" should not silently count it toward the current
    // reading challenge. The user can still set a date explicitly.
  }
  statusSel.addEventListener('change', syncFormToStatus);
  syncFormToStatus();

  // Auto-fill from Open Library (Issues #1 & #3)
  document.getElementById('autoFillBtn').addEventListener('click', async () => {
    const q = document.getElementById('autoFillInput').value.trim();
    if (!q) return;
    showToast('Searching…');
    const results = await fetchBooks(q, 5, "General", "title");
    if (results === null) {
      showToast('Search failed — check your connection, or fill details manually');
      return;
    }
    if (results.length) {
      showBookSelection(results);
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

    const dupe = findExistingBook(title, author);
    if (dupe) {
      const shelfName = { read: 'Books Read', tbr: 'TBR list', currentlyReading: 'Currently Reading' }[dupe.shelf];
      showToast(`"${title}" is already in your ${shelfName} shelf`);
      return;
    }

    const color = BOOK_COLORS[Math.floor(Math.random() * BOOK_COLORS.length)];
    const book  = { id: uid(), title, author, genre, color, cover: selectedCover, totalPages, addedAt: Date.now(), notes };

    if (status === 'READ') {
      const dateVal = document.getElementById('mDateFinished').value;
      // Blank date -> book doesn't count toward the reading challenge
      // until the user sets a finished date (Issue #3).
      const finishedDate = dateVal ? new Date(dateVal) : null;
      state.readBooks.unshift({
        ...book, rating: currentRating,
        finishedDate: finishedDate ? finishedDate.toISOString() : null,
        finishedYear: finishedDate ? finishedDate.getFullYear() : null,
        finishedMonth: finishedDate ? finishedDate.getMonth() : null
      });
      saveState();
      refreshAll();
      renderRecommendations("all");
      showToast(`"${title}" added to your shelf!`);
      resetAndClose();
    } else if (status === 'TBR') {
      state.tbrBooks.unshift(book);
      saveState();
      refreshAll();
      renderRecommendations("all");
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

function showBookSelection(results){

    window.searchResults = results;

    const body = document.getElementById("searchModalBody");

    body.innerHTML = "";

    results.forEach((book,index)=>{

        body.innerHTML += `

        <div class="search-item">

            <img src="${book.cover}" alt="">

            <div class="search-item-info">

                <h4>${book.title}</h4>

                <p>${book.author}</p>

                <p>${book.genre}</p>

            </div>

            <button onclick="selectBook(${index})">

                Select

            </button>

        </div>

        `;

    });

    document
        .getElementById("searchModal")
        .classList.add("open");

}
function selectBook(index){

    const book = window.searchResults[index];

    document.getElementById("mTitle").value = book.title;

    document.getElementById("mAuthor").value = book.author;

    document.getElementById("mGenre").value = book.genre;

    document.getElementById("mPages").value =
        book.totalPages || "";

    document
        .getElementById("searchModal")
        .classList.remove("open");

    showToast("Book selected!");

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