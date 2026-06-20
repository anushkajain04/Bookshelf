/* ============================================================
   Bookish — server.js
   Location: BOOKISH/folio/backend/server.js
   Run from:  cd BOOKISH/folio/backend  →  node server.js
   ============================================================ */

require('dotenv').config();   // MUST be first line — loads .env

const express    = require('express');
const session    = require('express-session');
const MongoStore = require('connect-mongo');
const path       = require('path');
const connectDB  = require('./config/db');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── 1. Connect to MongoDB FIRST ─────────────────────────────
connectDB();

// ── 2. Work out where your HTML/CSS/JS files live ───────────
//  server.js is at: BOOKISH/folio/backend/server.js
//  html files are at: BOOKISH/html/
//  css files are at:  BOOKISH/css/
//  js files are at:   BOOKISH/js/      (frontend JS)
//  images are at:     BOOKISH/Image/
const ROOT    = path.join(__dirname, '..', '..');   // goes up to BOOKISH/
const htmlDir = path.join(ROOT, 'html');
const cssDir  = path.join(ROOT, 'css');
const jsDir   = path.join(ROOT, 'js');             // frontend JS folder
const imgDir  = path.join(ROOT, 'Image');

// ── 3. Serve static files ────────────────────────────────────
app.use('/css',   express.static(cssDir));
app.use('/js',    express.static(jsDir));
app.use('/Image', express.static(imgDir));
app.use('/html',  express.static(htmlDir));   // fallback direct access

// ── 4. Body parsers ──────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ── 5. Sessions ──────────────────────────────────────────────
app.use(session({
  secret:            process.env.SESSION_SECRET || 'fallback-secret-change-this',
  resave:            false,
  saveUninitialized: false,
  name:              'bookish.sid',
  store: MongoStore.create({
    mongoUrl:       process.env.MONGO_URI,
    collectionName: 'sessions',
    ttl:            24 * 60 * 60,   // 1 day
    autoRemove:     'native'
  }),
  cookie: {
    httpOnly: true,
    secure:   false,   // set true when you deploy with HTTPS
    maxAge:   24 * 60 * 60 * 1000
  }
}));

// ── 6. Middleware to pass user info to all routes ────────────
app.use((req, res, next) => {
  res.locals.userId    = req.session?.userId    || null;
  res.locals.firstName = req.session?.firstName || null;
  next();
});

// ── 7. Auth & book route protection helpers ─────────────────
const { requireAuth, requireGuest } = require('./middleware/auth');

// ── 8. PAGE ROUTES ───────────────────────────────────────────

// Home / landing page
app.get('/', (req, res) => {
  // If already logged in, skip welcome and go to dashboard
  if (req.session?.userId) return res.redirect('/dashboard');
  res.sendFile(path.join(htmlDir, 'welcome.html'));
});

// Auth pages — only for guests (not logged in)
app.get('/login',           requireGuest, (req, res) => res.sendFile(path.join(htmlDir, 'login.html')));
app.get('/register',        requireGuest, (req, res) => res.sendFile(path.join(htmlDir, 'register.html')));
app.get('/forgot-password',              (req, res) => res.sendFile(path.join(htmlDir, 'forgot.html')));
app.get('/reset-password',               (req, res) => res.sendFile(path.join(htmlDir, 'reset.html')));

// Protected pages — must be logged in
app.get('/dashboard', requireAuth, (req, res) => res.sendFile(path.join(htmlDir, 'dashboard.html')));

// ── 9. API ROUTES ────────────────────────────────────────────
app.use('/auth',   require('./routes/auth'));
app.use('/api/books', requireAuth, require('./routes/books'));

// ── 10. Health check (useful for testing) ───────────────────
app.get('/health', (req, res) => {
  res.json({
    status:    'ok',
    dbUri:     process.env.MONGO_URI ? 'set ✓' : 'MISSING ✗',
    sessionKey: process.env.SESSION_SECRET ? 'set ✓' : 'MISSING ✗',
    emailUser: process.env.EMAIL_USER ? 'set ✓' : 'MISSING ✗',
    port:      PORT
  });
});

// ── 11. 404 fallback ─────────────────────────────────────────
app.use((req, res) => {
  res.status(404).sendFile(path.join(htmlDir, '404.html'), err => {
    // if 404.html doesn't exist yet, send plain text
    if (err) res.status(404).send('Page not found.');
  });
});

// ── 12. Global error handler ─────────────────────────────────
app.use((err, req, res, next) => {
  console.error('[Server Error]', err);
  res.status(500).json({ message: 'Server error. Please try again.' });
});

// ── 13. Start ────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log('');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`  📚 Bookish running on port ${PORT}`);
  console.log(`  🌐 Open: http://localhost:${PORT}`);
  console.log(`  🔍 Health: http://localhost:${PORT}/health`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('');
});