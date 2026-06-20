const mongoose = require('mongoose');

// ─────────────────────────────────────────────────────────────────
//  Book model
//  Each document = one book belonging to one user.
//  A single user can have the same book appear in READ or TBR —
//  the "status" field controls which list it shows up in.
// ─────────────────────────────────────────────────────────────────

const bookSchema = new mongoose.Schema({

  // Which user owns this book entry
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true           // speeds up "find all books for this user"
  },

  title: {
    type: String,
    required: [true, 'Book title is required'],
    trim: true,
    maxlength: 200
  },

  author: {
    type: String,
    trim: true,
    default: 'Unknown',
    maxlength: 100
  },

  genre: {
    type: String,
    trim: true,
    default: 'General'
  },

  // cover color (hex) — used for the colored book spine in the UI
  color: {
    type: String,
    default: '#1A237E'
  },

  // READ  = finished reading
  // TBR   = to be read (want to read)
  // READING = currently reading
  status: {
    type: String,
    enum: ['READ', 'TBR', 'READING'],
    default: 'TBR'
  },

  // Only relevant when status = READ
  rating: {
    type: Number,
    min: 0,
    max: 5,
    default: 0
  },

  notes: {
    type: String,
    trim: true,
    maxlength: 1000,
    default: ''
  },

  // The year the user finished this book (for "books read this year" stat)
  finishedYear: {
    type: Number,
    default: null
  },

  // Prices fetched from external APIs — stored as a simple object
  // e.g. { amazon: 299, flipkart: 349, meesho: 319 }
  prices: {
    type: Map,
    of: Number,
    default: {}
  },

  addedAt: {
    type: Date,
    default: Date.now
  }

});

// ── Compound index so querying "all READ books for user X" is fast
bookSchema.index({ userId: 1, status: 1 });

module.exports = mongoose.model('Book', bookSchema);