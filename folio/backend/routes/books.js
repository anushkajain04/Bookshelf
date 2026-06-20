/* ============================================================
   Bookish — routes/books.js
   Location: BOOKISH/folio/backend/routes/books.js
   ============================================================ */

const express = require('express');
const Book    = require('../models/Book');
const router  = express.Router();

// ─── GET /api/books — load all books for logged-in user ──────
router.get('/', async (req, res) => {
  try {
    const books   = await Book.find({ userId: req.session.userId }).sort({ addedAt: -1 });
    const read    = books.filter(b => b.status === 'READ');
    const tbr     = books.filter(b => b.status === 'TBR');
    const reading = books.filter(b => b.status === 'READING');
    res.json({ success: true, read, tbr, reading });
  } catch (err) {
    console.error('[GET /api/books]', err);
    res.status(500).json({ message: 'Could not load books.' });
  }
});

// ─── GET /api/books/stats — reading statistics ───────────────
// NOTE: this route must be BEFORE /:id or Express confuses
// "stats" as an id parameter
router.get('/stats', async (req, res) => {
  try {
    const books     = await Book.find({ userId: req.session.userId });
    const thisYear  = new Date().getFullYear();
    const readBooks = books.filter(b => b.status === 'READ');
    const tbrBooks  = books.filter(b => b.status === 'TBR');
    const yearBooks = readBooks.filter(b => b.finishedYear === thisYear);
    const ratings   = readBooks.filter(b => b.rating > 0).map(b => b.rating);
    const avgRating = ratings.length
      ? (ratings.reduce((a, b) => a + b, 0) / ratings.length).toFixed(1)
      : null;

    const genreCounts = {};
    readBooks.forEach(b => {
      const g = b.genre || 'General';
      genreCounts[g] = (genreCounts[g] || 0) + 1;
    });
    const topGenre = Object.entries(genreCounts).sort((a, b) => b[1] - a[1])[0] || null;

    res.json({
      success: true,
      stats: {
        totalRead:    readBooks.length,
        totalTBR:     tbrBooks.length,
        readThisYear: yearBooks.length,
        avgRating,
        topGenre:     topGenre ? { name: topGenre[0], count: topGenre[1] } : null,
        toGoal:       Math.max(0, 12 - yearBooks.length),
        genreCounts
      }
    });
  } catch (err) {
    console.error('[GET /api/books/stats]', err);
    res.status(500).json({ message: 'Could not load stats.' });
  }
});

// ─── POST /api/books — add a new book ────────────────────────
router.post('/', async (req, res) => {
  try {
    const { title, author, genre, status, rating, notes, color } = req.body;

    if (!title || !title.trim()) {
      return res.status(400).json({ message: 'Book title is required.' });
    }

    // Prevent duplicate books for same user
    const existing = await Book.findOne({
      userId: req.session.userId,
      title:  title.trim()
    });
    if (existing) {
      return res.status(409).json({
        message: `"${title}" is already in your library (${existing.status}).`
      });
    }

    const book = await Book.create({
      userId:       req.session.userId,
      title:        title.trim(),
      author:       author?.trim()  || 'Unknown',
      genre:        genre?.trim()   || 'General',
      status:       status          || 'TBR',
      rating:       Number(rating)  || 0,
      notes:        notes?.trim()   || '',
      color:        color           || '#1A237E',
      finishedYear: status === 'READ' ? new Date().getFullYear() : null,
      addedAt:      new Date()
    });

    res.status(201).json({ success: true, book });
  } catch (err) {
    console.error('[POST /api/books]', err);
    res.status(500).json({ message: 'Could not save book.' });
  }
});

// ─── PATCH /api/books/:id — update status/rating/notes ───────
router.patch('/:id', async (req, res) => {
  try {
    const { status, rating, notes, color, progress } = req.body;
    const update = {};

    if (status   !== undefined) {
      update.status = status;
      if (status === 'READ') update.finishedYear = new Date().getFullYear();
      if (status === 'TBR' || status === 'READING') update.finishedYear = null;
    }
    if (rating   !== undefined) update.rating   = Number(rating);
    if (notes    !== undefined) update.notes    = notes;
    if (color    !== undefined) update.color    = color;
    if (progress !== undefined) update.progress = Number(progress);

    // userId check = only update YOUR books (security)
    const book = await Book.findOneAndUpdate(
      { _id: req.params.id, userId: req.session.userId },
      { $set: update },
      { new: true }
    );

    if (!book) return res.status(404).json({ message: 'Book not found.' });
    res.json({ success: true, book });
  } catch (err) {
    console.error('[PATCH /api/books/:id]', err);
    res.status(500).json({ message: 'Could not update book.' });
  }
});

// ─── DELETE /api/books/:id — remove a book ───────────────────
router.delete('/:id', async (req, res) => {
  try {
    const book = await Book.findOneAndDelete({
      _id:    req.params.id,
      userId: req.session.userId
    });

    if (!book) return res.status(404).json({ message: 'Book not found.' });
    res.json({ success: true, message: `"${book.title}" removed.` });
  } catch (err) {
    console.error('[DELETE /api/books/:id]', err);
    res.status(500).json({ message: 'Could not delete book.' });
  }
});

module.exports = router;