// Protect routes — redirect to login if not logged in
const requireAuth = (req, res, next) => {
  if (req.session && req.session.userId) {
    return next();
  }
  res.redirect('/login');
};

// Guest only — redirect to dashboard if already logged in
const requireGuest = (req, res, next) => {
  if (req.session && req.session.userId) {
    return res.redirect('/dashboard');
  }
  next();
};

module.exports = { requireAuth, requireGuest };