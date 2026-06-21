/* ============================================================
   Bookish — routes/auth.js
   Location: BOOKISH/folio/backend/routes/auth.js
   ============================================================ */

'use strict';

const express    = require('express');
const crypto     = require('crypto');
const nodemailer = require('nodemailer');
const User       = require('../models/User');
const { requireGuest } = require('../middleware/auth');

const router = express.Router();

/* ── Email transporter ── */
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS    // Gmail App Password — NOT your real password
  }
});


/* ════════════════════════════════════════════════════
   POST /auth/register
════════════════════════════════════════════════════ */
router.post('/register', requireGuest, async (req, res) => {
  try {
    const { firstName, lastName, email, password, confirmPassword } = req.body;

    // ── Validation ──
    if (!firstName?.trim() || !lastName?.trim() || !email?.trim() || !password || !confirmPassword) {
      return res.status(400).json({ message: 'All fields are required.' });
    }
    if (password.length < 8) {
      return res.status(400).json({ message: 'Password must be at least 8 characters.' });
    }
    if (password !== confirmPassword) {
      return res.status(400).json({ message: 'Passwords do not match.' });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ message: 'Please enter a valid email address.' });
    }

    // ── Check duplicate email ──
    const existing = await User.findOne({ email: email.toLowerCase().trim() });
    if (existing) {
      return res.status(409).json({ message: 'An account with this email already exists.' });
    }

    // ── Create user (password hashed by User model pre-save hook) ──
    const user = await User.create({
      firstName: firstName.trim(),
      lastName:  lastName.trim(),
      email:     email.toLowerCase().trim(),
      password
    });

    // ── Log in immediately after registering ──
    req.session.userId    = user._id;
    req.session.lastName  = user.lastName;
    req.session.firstName = user.firstName;
    req.session.email     = user.email;

    return res.status(201).json({
      message:   'Account created successfully!',
      firstName: user.firstName,
      email:     user.email,
      redirect:  '/dashboard'
    });

  } catch (err) {
    console.error('[Register Error]', err);

    // Mongoose duplicate key error (race condition)
    if (err.code === 11000) {
      return res.status(409).json({ message: 'An account with this email already exists.' });
    }
    return res.status(500).json({ message: 'Server error. Please try again.' });
  }
});

/* ════════════════════════════════════════════════════
   POST /auth/login
════════════════════════════════════════════════════ */
router.post('/login', requireGuest, async (req, res) => {
  try {
    const { email, password, remember } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password are required.' });
    }

    // ── Find user ──
    const user = await User.findOne({ email: email.toLowerCase().trim() });
    if (!user) {
      // Vague message — don't reveal if email exists
      return res.status(401).json({ message: 'Invalid email or password.' });
    }

    // ── Check password ──
    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({ message: 'Invalid email or password.' });
    }

    // ── Set session ──
    req.session.userId    = user._id;
    req.session.firstName = user.firstName;
    req.session.lastName  = user.lastName;
    req.session.email     = user.email;

    // ── Remember me: 30 days vs 1 day ──
    req.session.cookie.maxAge = remember
      ? 30 * 24 * 60 * 60 * 1000
      :      24 * 60 * 60 * 1000;

    return res.status(200).json({
      message:   'Logged in successfully!',
      firstName: user.firstName,
      lastName:  user.lastName,
      email:     user.email,
      redirect:  '/dashboard'
    });

  } catch (err) {
    console.error('[Login Error]', err);
    return res.status(500).json({ message: 'Server error. Please try again.' });
  }
});

/* ════════════════════════════════════════════════════
   POST /auth/logout
════════════════════════════════════════════════════ */
router.post('/logout', (req, res) => {
  req.session.destroy(err => {
    if (err) return res.status(500).json({ message: 'Logout failed.' });
    res.clearCookie('bookish.sid');
    res.json({ success: true, redirect: '/login' });
  });
});

/* ════════════════════════════════════════════════════
   POST /auth/forgot-password
════════════════════════════════════════════════════ */
router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ message: 'Email is required.' });

    const user = await User.findOne({ email: email.toLowerCase().trim() });

    // Always respond the same — never reveal if email exists
    const okMsg = { message: 'If that email is registered, a reset link has been sent.' };
    if (!user) return res.status(200).json(okMsg);

    // ── Generate token ──
    const token  = crypto.randomBytes(32).toString('hex');
    const expiry = Date.now() + 60 * 60 * 1000;   // 1 hour

    user.resetToken       = token;
    user.resetTokenExpiry = expiry;
    await user.save({ validateBeforeSave: false });

    // ── Send email ──
    const resetURL = `${process.env.BASE_URL}/reset-password?token=${token}`;

 console.log('Reset URL:', resetURL);


    const info = await transporter.sendMail({
      from:    `"Bookish" <${process.env.EMAIL_USER}>`,
      to:      user.email,
      subject: 'Reset your Bookish password',
      html: `
        <div style="font-family:sans-serif;max-width:500px;margin:auto;padding:32px;background:#F5F0E8;border-radius:12px">
          <h2 style="font-family:Georgia,serif;color:#1A1208">Reset your password</h2>
          <p style="color:#3D2E1A">Hi ${user.firstName},</p>
          <p style="color:#3D2E1A">We received a request to reset your Bookish password.
             Click the button below — this link expires in <strong>1 hour</strong>.</p>
          <a href="${resetURL}"
             style="display:inline-block;margin:24px 0;padding:13px 28px;
                    background:#C17F3A;color:#fff;border-radius:22px;
                    text-decoration:none;font-weight:600;font-family:sans-serif">
            Reset Password →
          </a>
          <p style="color:#7A6650;font-size:13px">
            If you didn't request this, you can safely ignore this email.
          </p>
          <hr style="border:none;border-top:1px solid #d4c9b5;margin:24px 0"/>
          <p style="color:#B8A898;font-size:11px">
            Or copy this link:<br/>${resetURL}
          </p>
        </div>`
    });

    /*temparary test to check if email sending works*/
console.log('Email sent:', info);

    return res.status(200).json(okMsg);

  } catch (err) {
    console.error('[Forgot Password Error]', err);
    return res.status(500).json({ message: 'Server error. Please try again.' });
  }
});

/* ════════════════════════════════════════════════════
   POST /auth/reset-password
════════════════════════════════════════════════════ */
router.post('/reset-password', async (req, res) => {
  try {
    const { token, password, confirmPassword } = req.body;

    if (!token || !password || !confirmPassword) {
      return res.status(400).json({ message: 'All fields are required.' });
    }
    if (password.length < 8) {
      return res.status(400).json({ message: 'Password must be at least 8 characters.' });
    }
    if (password !== confirmPassword) {
      return res.status(400).json({ message: 'Passwords do not match.' });
    }

    // ── Find user with valid, non-expired token ──
    const user = await User.findOne({
      resetToken:       token,
      resetTokenExpiry: { $gt: Date.now() }
    });

    if (!user) {
      return res.status(400).json({ message: 'Reset link is invalid or has expired. Please request a new one.' });
    }

    // ── Update password (bcrypt hook handles hashing) ──
    user.password         = password;
    user.resetToken       = null;
    user.resetTokenExpiry = null;
    await user.save();

    return res.status(200).json({
      message:  'Password reset successfully! You can now log in.',
      redirect: '/login'
    });

  } catch (err) {
    console.error('[Reset Password Error]', err);
    return res.status(500).json({ message: 'Server error. Please try again.' });
  }
});

/* ════════════════════════════════════════════════════
   GET /auth/me — check if user is logged in
   Used by frontend to get current user info
════════════════════════════════════════════════════ */
router.get('/me', (req, res) => {
  if (!req.session?.userId) {
    return res.status(401).json({ loggedIn: false });
  }
  res.json({
    loggedIn:  true,
    firstName: req.session.firstName,
    lastName: req.session.lastName,
    email:     req.session.email,
    userId:    req.session.userId
  });
});

module.exports = router;
