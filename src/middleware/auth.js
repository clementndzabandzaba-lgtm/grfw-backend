const jwt = require('jsonwebtoken')

const JWT_SECRET = process.env.JWT_SECRET || 'grfw-dev-secret-change-in-production'

function requireAuth(req, res, next) {
  const header = req.headers.authorization
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, error: 'Authentication required' })
  }
  try {
    const token = header.slice(7)
    const payload = jwt.verify(token, JWT_SECRET)
    req.user = payload
    next()
  } catch {
    return res.status(401).json({ success: false, error: 'Invalid or expired token' })
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ success: false, error: 'Insufficient permissions' })
    }
    next()
  }
}

// Members can only use their account while their monthly subscription is active.
// Admins and super admins are exempt. Use after requireAuth.
function requireSubscription(req, res, next) {
  if (!req.user) return res.status(401).json({ success: false, error: 'Authentication required' })
  if (['admin', 'super_admin'].includes(req.user.role)) return next()
  // Lazy require: routes/auth.js itself imports this file.
  const { users } = require('../routes/auth')
  const user = users.find((u) => u.id === req.user.id)
  const active = user && user.isSubscribed && user.subscriptionExpiry && new Date(user.subscriptionExpiry) > new Date()
  if (!active) {
    return res.status(402).json({ success: false, error: 'An active subscription is required. Please subscribe to access your account.', code: 'SUBSCRIPTION_REQUIRED' })
  }
  next()
}

module.exports = { requireAuth, requireRole, requireSubscription, JWT_SECRET }
