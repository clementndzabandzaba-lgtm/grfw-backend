const router   = require('express').Router()
const bcrypt   = require('bcryptjs')
const jwt      = require('jsonwebtoken')
const { v4: uuidv4 } = require('uuid')
const { requireAuth, JWT_SECRET } = require('../middleware/auth')
const { logAction }    = require('../utils/auditLog')
const { sendResetCode } = require('../utils/email')
const { buildPaymentData, verifyItn } = require('../utils/payfast')
const userRepo = require('../repositories/userRepo')

// Shared in-memory user store — write-through cache backed by PostgreSQL.
// superadmin.js imports this same array reference.
const users = []

async function init() {
  const loaded = await userRepo.loadAll()
  users.length = 0
  users.push(...loaded)
  await seedSuperAdmin()
}

async function seedSuperAdmin() {
  const email    = process.env.SUPER_ADMIN_EMAIL    || 'superadmin@grfw.org'
  const password = process.env.SUPER_ADMIN_PASSWORD || 'ChangeMe@2026!'
  const name     = process.env.SUPER_ADMIN_NAME     || 'GRFW Super Admin'

  const existing = users.find((u) => u.email.toLowerCase() === email.toLowerCase())
  if (!existing) {
    const superAdmin = {
      id: 'sa-001', name, email,
      role: 'super_admin',
      password: await bcrypt.hash(password, 12),
      country: 'South Africa', isVerified: true, status: 'active',
      avatar: null, isSubscribed: true, subscriptionPlan: null, subscriptionExpiry: null,
      widowhoodCategory: null, registrationFeePaid: true,
      createdAt: new Date().toISOString(),
    }
    users.push(superAdmin)
    await userRepo.insert(superAdmin)
    console.log(`\n  Super Admin seeded: ${email}`)
  } else {
    // Always ensure the super admin stays active and has correct flags
    let changed = false
    if (existing.status !== 'active')           { existing.status = 'active'; changed = true }
    if (!existing.registrationFeePaid)           { existing.registrationFeePaid = true; changed = true }
    if (existing.role !== 'super_admin')         { existing.role = 'super_admin'; changed = true }
    if (changed) {
      await userRepo.update(existing)
      console.log(`  Super Admin record corrected in DB: ${email}`)
    }
  }
}

// ── Widowhood fee tables (USD — displayed with $ sign) ───────────────────────
const REGISTRATION_FEES = {
  new_to_widowhood: 15,
  mid_widowhood:    15,
  established:      15,
}
const SUBSCRIPTION_FEES = {
  new_to_widowhood: 30,
  mid_widowhood:    60,
  established:      99,
}
const CATEGORY_LABELS = {
  new_to_widowhood: 'New to Widowhood (0–12 months)',
  mid_widowhood:    'Mid Widowhood (1–3 years)',
  established:      'Established (3+ years)',
}

function registrationFee(category) { return REGISTRATION_FEES[category] || REGISTRATION_FEES.established }
function subscriptionFee(category) { return SUBSCRIPTION_FEES[category] || SUBSCRIPTION_FEES.established }

const FRONTEND_URL = () => process.env.FRONTEND_URL || 'https://grfw-frontend.vercel.app'
const BACKEND_URL  = () => process.env.BACKEND_URL  || 'https://grfw-backend-production.up.railway.app'

const sign = (user) => jwt.sign(
  { id: user.id, email: user.email, role: user.role, name: user.name },
  JWT_SECRET,
  { expiresIn: '7d' }
)

const safeUser = (u) => ({
  id: u.id, name: u.name, email: u.email, role: u.role,
  country: u.country, isVerified: u.isVerified, status: u.status,
  avatar: u.avatar || null, createdAt: u.createdAt,
  isSubscribed:         u.isSubscribed         || false,
  subscriptionPlan:     u.subscriptionPlan     || null,
  subscriptionExpiry:   u.subscriptionExpiry   || null,
  widowhoodCategory:    u.widowhoodCategory    || null,
  registrationFeePaid:  !!u.registrationFeePaid,
})

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const { email, password } = req.body
  if (!email || !password) return res.status(400).json({ success: false, error: 'Email and password are required.' })

  const user = users.find((u) => u.email.toLowerCase() === email.toLowerCase())
  if (!user) return res.status(401).json({ success: false, error: 'Invalid email or password.' })

  const passwordMatch = await bcrypt.compare(password, user.password)
  if (!passwordMatch) return res.status(401).json({ success: false, error: 'Invalid email or password.' })

  if (user.status === 'pending_payment') {
    return res.status(403).json({
      success: false,
      error: 'Your registration fee has not been paid. Complete payment to activate your account.',
      code: 'PENDING_PAYMENT',
      userId: user.id,
      widowhoodCategory: user.widowhoodCategory,
      amount: registrationFee(user.widowhoodCategory),
    })
  }
  if (user.status === 'pending_admin')      return res.status(403).json({ success: false, error: 'Your account is pending approval by a GRFW administrator.', code: 'PENDING_ADMIN' })
  if (user.status === 'pending_superadmin') return res.status(403).json({ success: false, error: 'Your admin account request is pending approval by GRFW leadership.', code: 'PENDING_SUPERADMIN' })
  if (user.status === 'rejected')           return res.status(403).json({ success: false, error: 'Your account was not approved.', code: 'REJECTED' })
  if (user.status === 'suspended')          return res.status(403).json({ success: false, error: 'Your account has been suspended. Please contact GRFW support.', code: 'SUSPENDED' })

  res.json({ success: true, data: { token: sign(user), user: safeUser(user) } })
})

// POST /api/auth/register
router.post('/register', async (req, res) => {
  const { name, email, password, country, role, avatar, profile, widowhoodCategory } = req.body
  if (!name || !email || !password) return res.status(400).json({ success: false, error: 'Name, email, and password are required.' })
  if (password.length < 8) return res.status(400).json({ success: false, error: 'Password must be at least 8 characters.' })
  if (users.find((u) => u.email.toLowerCase() === email.toLowerCase())) {
    return res.status(409).json({ success: false, error: 'An account with this email already exists.' })
  }

  const requestedRole = role === 'admin' ? 'admin' : 'member'
  const validCategory = ['new_to_widowhood', 'mid_widowhood', 'established'].includes(widowhoodCategory)
    ? widowhoodCategory : 'established'

  // Admins go to pending_superadmin; members must pay before activation
  const status = requestedRole === 'admin' ? 'pending_superadmin' : 'pending_payment'

  const newUser = {
    id: uuidv4(), name: name.trim(), email: email.toLowerCase().trim(),
    role: requestedRole, password: await bcrypt.hash(password, 12),
    country: country || 'Unknown', isVerified: false, status,
    avatar: avatar || null, profile: profile || {},
    isSubscribed: false, subscriptionPlan: null, subscriptionExpiry: null,
    widowhoodCategory: requestedRole === 'member' ? validCategory : null,
    registrationFeePaid: requestedRole === 'admin',  // admins skip payment
    createdAt: new Date().toISOString(),
  }
  users.push(newUser)
  try {
    await userRepo.insert(newUser)
  } catch (err) {
    console.error('DB insert failed during register:', err.message, err.stack)
    // Remove from in-memory so state doesn't diverge from DB
    users.splice(users.indexOf(newUser), 1)
    return res.status(500).json({ success: false, error: 'Account could not be created. Please try again.' })
  }

  const fee = requestedRole === 'member' ? registrationFee(validCategory) : 0

  res.status(201).json({
    success: true,
    message: requestedRole === 'admin'
      ? 'Your admin request has been submitted and is awaiting super admin approval.'
      : 'Account created. Please pay the registration fee to activate your account.',
    data: {
      userId: newUser.id,
      status,
      role: requestedRole,
      widowhoodCategory: newUser.widowhoodCategory,
      registrationFee: fee,
      categoryLabel: CATEGORY_LABELS[validCategory] || '',
    },
  })
})

// GET /api/auth/me
router.get('/me', requireAuth, (req, res) => {
  const user = users.find((u) => u.id === req.user.id)
  if (!user) return res.status(404).json({ success: false, error: 'User not found.' })
  res.json({ success: true, data: safeUser(user) })
})

// GET /api/auth/pending
router.get('/pending', requireAuth, (req, res) => {
  const caller = users.find((u) => u.id === req.user.id)
  if (!caller || !['admin', 'super_admin'].includes(caller.role)) return res.status(403).json({ success: false, error: 'Insufficient permissions.' })
  res.json({ success: true, data: users.filter((u) => u.status === 'pending_admin').map(safeUser) })
})

// GET /api/auth/pending-admins
router.get('/pending-admins', requireAuth, (req, res) => {
  const caller = users.find((u) => u.id === req.user.id)
  if (!caller || caller.role !== 'super_admin') return res.status(403).json({ success: false, error: 'Only super admins can view pending admin requests.' })
  res.json({ success: true, data: users.filter((u) => u.status === 'pending_superadmin').map(safeUser) })
})

// PATCH /api/auth/approve/:id
router.patch('/approve/:id', requireAuth, async (req, res) => {
  const caller = users.find((u) => u.id === req.user.id)
  if (!caller || !['admin', 'super_admin'].includes(caller.role)) return res.status(403).json({ success: false, error: 'Insufficient permissions.' })
  const target = users.find((u) => u.id === req.params.id)
  if (!target) return res.status(404).json({ success: false, error: 'User not found.' })

  if (target.status === 'pending_admin' && ['admin', 'super_admin'].includes(caller.role)) {
    target.status = 'active'
  } else if (target.status === 'pending_superadmin' && caller.role === 'super_admin') {
    target.status = 'active'
  } else {
    return res.status(403).json({ success: false, error: 'You do not have permission to approve this account.' })
  }

  try {
    await userRepo.update(target)
  } catch (err) {
    console.error('DB update failed during approve:', err.message, err.stack)
    return res.status(500).json({ success: false, error: 'Approval could not be saved to database. Please try again.' })
  }
  logAction({ actorName: caller.name, actorId: caller.id, actorRole: caller.role, action: target.role === 'admin' ? 'APPROVED_ADMIN' : 'APPROVED_MEMBER', target: `${target.name} (${target.email})`, risk: target.role === 'admin' ? 'high' : 'low' })
  res.json({ success: true, message: `${target.name}'s account has been approved.`, data: safeUser(target) })
})

// PATCH /api/auth/reject/:id
router.patch('/reject/:id', requireAuth, async (req, res) => {
  const caller = users.find((u) => u.id === req.user.id)
  if (!caller || !['admin', 'super_admin'].includes(caller.role)) return res.status(403).json({ success: false, error: 'Insufficient permissions.' })
  const target = users.find((u) => u.id === req.params.id)
  if (!target) return res.status(404).json({ success: false, error: 'User not found.' })

  target.status = 'rejected'
  target.rejectionReason = req.body.reason || 'Application not approved.'
  try {
    await userRepo.update(target)
  } catch (err) {
    console.error('DB update failed during reject:', err.message, err.stack)
    return res.status(500).json({ success: false, error: 'Rejection could not be saved. Please try again.' })
  }
  logAction({ actorName: caller.name, actorId: caller.id, actorRole: caller.role, action: target.role === 'admin' ? 'REJECTED_ADMIN' : 'REJECTED_MEMBER', target: `${target.name} (${target.email})`, risk: 'medium' })
  res.json({ success: true, message: `${target.name}'s account has been rejected.` })
})

// GET /api/auth/all
router.get('/all', requireAuth, (req, res) => {
  const caller = users.find((u) => u.id === req.user.id)
  if (!caller || !['admin', 'super_admin'].includes(caller.role)) return res.status(403).json({ success: false, error: 'Insufficient permissions.' })
  res.json({ success: true, data: users.filter((u) => u.role !== 'super_admin').map(safeUser) })
})

// PATCH /api/auth/members/:id/status
router.patch('/members/:id/status', requireAuth, async (req, res) => {
  const caller = users.find((u) => u.id === req.user.id)
  if (!caller || !['admin', 'super_admin'].includes(caller.role)) return res.status(403).json({ success: false, error: 'Insufficient permissions.' })
  const { status } = req.body
  if (!['active', 'suspended'].includes(status)) return res.status(400).json({ success: false, error: 'Status must be "active" or "suspended".' })
  const target = users.find((u) => u.id === req.params.id)
  if (!target) return res.status(404).json({ success: false, error: 'Member not found.' })
  if (target.role !== 'member') return res.status(403).json({ success: false, error: 'Admins can only suspend member accounts.' })
  target.status = status
  await userRepo.update(target).catch((err) => console.error('DB update failed:', err.message))
  logAction({ actorName: caller.name, actorId: caller.id, actorRole: caller.role, action: status === 'suspended' ? 'SUSPENDED_MEMBER' : 'REACTIVATED_MEMBER', target: `${target.name} (${target.email})`, risk: 'medium' })
  res.json({ success: true, message: `${target.name} has been ${status === 'suspended' ? 'suspended' : 'reactivated'}.`, data: safeUser(target) })
})

// POST /api/auth/admin/add-user
router.post('/admin/add-user', requireAuth, async (req, res) => {
  const caller = users.find((u) => u.id === req.user.id)
  if (!caller || !['admin', 'super_admin'].includes(caller.role)) return res.status(403).json({ success: false, error: 'Insufficient permissions.' })
  const { name, email, password, role, widowhoodCategory } = req.body
  if (!name || !email || !password) return res.status(400).json({ success: false, error: 'Name, email, and password are required.' })
  if (password.length < 8) return res.status(400).json({ success: false, error: 'Password must be at least 8 characters.' })
  const requestedRole = ['member', 'admin'].includes(role) ? role : 'member'
  if (users.find((u) => u.email.toLowerCase() === email.toLowerCase())) return res.status(409).json({ success: false, error: 'An account with that email already exists.' })

  const validCategory = ['new_to_widowhood', 'mid_widowhood', 'established'].includes(widowhoodCategory) ? widowhoodCategory : 'established'
  const status = requestedRole === 'admin' ? 'pending_admin' : 'active'

  const newUser = {
    id: uuidv4(), name: name.trim(), email: email.toLowerCase().trim(),
    role: requestedRole, password: await bcrypt.hash(password, 12),
    country: req.body.country || '', isVerified: true, status,
    avatar: null, profile: {},
    isSubscribed: false, subscriptionPlan: null, subscriptionExpiry: null,
    widowhoodCategory: requestedRole === 'member' ? validCategory : null,
    registrationFeePaid: true,  // admin-created accounts skip payment
    createdAt: new Date().toISOString(), addedBy: caller.name,
  }
  users.push(newUser)
  try {
    await userRepo.insert(newUser)
  } catch (err) {
    console.error('DB insert failed during admin/add-user:', err.message, err.stack)
    users.splice(users.indexOf(newUser), 1)
    return res.status(500).json({ success: false, error: 'Account could not be saved to database. Please try again.' })
  }
  logAction({ actorName: caller.name, actorId: caller.id, actorRole: caller.role, action: `CREATED_${requestedRole.toUpperCase()}`, target: `${newUser.name} (${newUser.email}) — status: ${status}`, risk: requestedRole === 'admin' ? 'high' : 'low' })
  res.status(201).json({
    success: true,
    message: requestedRole === 'admin' ? `Admin account created. Approve it from the Approvals page before ${name} can log in.` : 'Member account created and activated.',
    data: safeUser(newUser),
  })
})

// PATCH /api/auth/admin/users/:id/status
router.patch('/admin/users/:id/status', requireAuth, async (req, res) => {
  const caller = users.find((u) => u.id === req.user.id)
  if (!caller || !['admin', 'super_admin'].includes(caller.role)) return res.status(403).json({ success: false, error: 'Insufficient permissions.' })
  const { status } = req.body
  if (!['active', 'suspended'].includes(status)) return res.status(400).json({ success: false, error: 'Status must be "active" or "suspended".' })
  const target = users.find((u) => u.id === req.params.id)
  if (!target) return res.status(404).json({ success: false, error: 'User not found.' })
  if (target.id === caller.id) return res.status(400).json({ success: false, error: 'You cannot suspend your own account.' })
  if (target.role === 'super_admin') return res.status(403).json({ success: false, error: 'Cannot modify a super admin account.' })
  target.status = status
  await userRepo.update(target).catch((err) => console.error('DB update failed:', err.message))
  logAction({ actorName: caller.name, actorId: caller.id, actorRole: caller.role, action: status === 'suspended' ? 'SUSPENDED_USER' : 'REACTIVATED_USER', target: `${target.name} (${target.email})`, risk: 'medium' })
  res.json({ success: true, message: `${target.name} ${status === 'suspended' ? 'suspended' : 'reactivated'}.`, data: safeUser(target) })
})

// DELETE /api/auth/admin/users/:id
router.delete('/admin/users/:id', requireAuth, async (req, res) => {
  const caller = users.find((u) => u.id === req.user.id)
  if (!caller || !['admin', 'super_admin'].includes(caller.role)) return res.status(403).json({ success: false, error: 'Insufficient permissions.' })
  const idx = users.findIndex((u) => u.id === req.params.id)
  if (idx === -1) return res.status(404).json({ success: false, error: 'User not found.' })
  const target = users[idx]
  if (target.id === caller.id) return res.status(400).json({ success: false, error: 'You cannot delete your own account.' })
  if (target.role === 'super_admin') return res.status(403).json({ success: false, error: 'Cannot delete a super admin account.' })
  users.splice(idx, 1)
  await userRepo.remove(target.id).catch((err) => console.error('DB remove failed:', err.message))
  logAction({ actorName: caller.name, actorId: caller.id, actorRole: caller.role, action: 'DELETED_USER', target: `${target.name} (${target.email})`, risk: 'high' })
  res.json({ success: true, message: `${target.name}'s account has been deleted.` })
})

// GET /api/auth/admin-stats
router.get('/admin-stats', requireAuth, (req, res) => {
  const caller = users.find((u) => u.id === req.user.id)
  if (!caller || !['admin', 'super_admin'].includes(caller.role)) return res.status(403).json({ success: false, error: 'Insufficient permissions.' })

  const pendingMembers   = users.filter((u) => u.status === 'pending_admin').map(safeUser)
  const activeMembers    = users.filter((u) => u.role === 'member' && u.status === 'active')
  const recentlyApproved = [...activeMembers].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).slice(0, 5).map(safeUser)

  const { jobs }         = require('./jobs')
  const { skills }       = require('./skills')
  const { articles }     = require('./news')
  const { events }       = require('./events')
  const { publications } = require('./publications')

  res.json({
    success: true,
    data: {
      totalMembers:    activeMembers.length,
      activeJobs:      jobs.filter((j) => j.isActive).length,
      publishedSkills: skills.filter((s) => s.published).length,
      publishedNews:   articles.filter((a) => a.published).length,
      publishedEvents: events.filter((e) => e.published).length,
      publishedPubs:   publications.filter((p) => p.published).length,
      pendingMembers,
      recentlyApproved,
    },
  })
})

// ── Subscriptions (ZAR, category-based) ──────────────────────────────────────

router.get('/subscription', requireAuth, (req, res) => {
  const user = users.find((u) => u.id === req.user.id)
  if (!user) return res.status(404).json({ success: false, error: 'User not found.' })
  const now = new Date()
  const isActive = user.isSubscribed && user.subscriptionExpiry && new Date(user.subscriptionExpiry) > now
  if (user.isSubscribed && !isActive) {
    user.isSubscribed = false; user.subscriptionPlan = null
    userRepo.update(user).catch((err) => console.error('DB update failed:', err.message))
  }
  const monthlyFee = subscriptionFee(user.widowhoodCategory)
  res.json({
    success: true,
    data: {
      isSubscribed: isActive,
      subscriptionPlan:   user.subscriptionPlan,
      subscriptionExpiry: user.subscriptionExpiry,
      widowhoodCategory:  user.widowhoodCategory,
      monthlyFee,
      daysRemaining: isActive ? Math.ceil((new Date(user.subscriptionExpiry) - now) / (1000 * 60 * 60 * 24)) : 0,
    },
  })
})

// POST /api/auth/payfast/initiate-subscription — generate PayFast payment fields
router.post('/payfast/initiate-subscription', requireAuth, async (req, res) => {
  const user = users.find((u) => u.id === req.user.id)
  if (!user) return res.status(404).json({ success: false, error: 'User not found.' })
  if (!['member'].includes(user.role)) return res.status(403).json({ success: false, error: 'Subscriptions are for member accounts only.' })

  const amount = subscriptionFee(user.widowhoodCategory)
  const { fields, url } = buildPaymentData({
    paymentId:  `sub-${user.id}-${Date.now()}`,
    name:       user.name,
    email:      user.email,
    amount,
    itemName:   'GRFW Monthly Subscription',
    itemDesc:   `${CATEGORY_LABELS[user.widowhoodCategory] || 'Member'} — R${amount}/month`,
    returnUrl:  `${FRONTEND_URL()}/subscribe/success`,
    cancelUrl:  `${FRONTEND_URL()}/subscribe`,
    notifyUrl:  `${BACKEND_URL()}/api/auth/payfast/subscription-itn`,
    customStr1: user.id,
  })
  res.json({ success: true, data: { fields, url, amount } })
})

// POST /api/auth/payfast/subscription-itn — PayFast ITN webhook
router.post('/payfast/subscription-itn', async (req, res) => {
  res.sendStatus(200)  // acknowledge immediately
  try {
    if (!verifyItn(req.body)) { console.warn('PayFast sub ITN signature mismatch'); return }
    if (req.body.payment_status !== 'COMPLETE') return

    const userId = req.body.custom_str1
    const user   = users.find((u) => u.id === userId)
    if (!user) return

    const expiry = new Date()
    expiry.setMonth(expiry.getMonth() + 1)
    user.isSubscribed       = true
    user.subscriptionPlan   = 'monthly'
    user.subscriptionExpiry = expiry.toISOString()
    await userRepo.update(user).catch((err) => console.error('DB update failed:', err.message))
    console.log(`  Subscription activated for ${user.email}`)
  } catch (err) { console.error('Subscription ITN error:', err.message) }
})

// POST /api/auth/cancel-subscription
router.post('/cancel-subscription', requireAuth, async (req, res) => {
  const user = users.find((u) => u.id === req.user.id)
  if (!user) return res.status(404).json({ success: false, error: 'User not found.' })
  user.isSubscribed = false; user.subscriptionPlan = null; user.subscriptionExpiry = null
  await userRepo.update(user).catch((err) => console.error('DB update failed:', err.message))
  res.json({ success: true, message: 'Subscription cancelled. You can re-subscribe at any time.' })
})

// ── Registration PayFast routes ───────────────────────────────────────────────

// POST /api/auth/payfast/initiate-registration
router.post('/payfast/initiate-registration', async (req, res) => {
  const { userId } = req.body
  if (!userId) return res.status(400).json({ success: false, error: 'userId is required.' })
  const user = users.find((u) => u.id === userId)
  if (!user) return res.status(404).json({ success: false, error: 'User not found.' })
  if (user.registrationFeePaid) return res.status(400).json({ success: false, error: 'Registration fee already paid.' })

  const amount = registrationFee(user.widowhoodCategory)
  const { fields, url } = buildPaymentData({
    paymentId:  `reg-${user.id}`,
    name:       user.name,
    email:      user.email,
    amount,
    itemName:   'GRFW Registration Fee',
    itemDesc:   `${CATEGORY_LABELS[user.widowhoodCategory] || 'Member'} — one-time R${amount}`,
    returnUrl:  `${FRONTEND_URL()}/auth/payment-success`,
    cancelUrl:  `${FRONTEND_URL()}/auth/register`,
    notifyUrl:  `${BACKEND_URL()}/api/auth/payfast/registration-itn`,
    customStr1: user.id,
  })
  res.json({ success: true, data: { fields, url, amount } })
})

// POST /api/auth/payfast/registration-itn — PayFast webhook activates account
router.post('/payfast/registration-itn', async (req, res) => {
  res.sendStatus(200)  // acknowledge immediately
  try {
    if (!verifyItn(req.body)) { console.warn('PayFast reg ITN signature mismatch'); return }
    if (req.body.payment_status !== 'COMPLETE') return

    const userId = req.body.custom_str1
    const user   = users.find((u) => u.id === userId)
    if (!user) return

    user.status              = 'pending_admin'  // payment confirmed — now awaits admin approval
    user.registrationFeePaid = true
    user.isVerified          = true
    await userRepo.update(user).catch((err) => console.error('DB update failed:', err.message))
    logAction({ actorName: 'PayFast', actorId: 'system', actorRole: 'system', action: 'REGISTRATION_PAID', target: `${user.name} (${user.email})`, risk: 'low' })
    console.log(`  Registration fee paid — pending admin approval: ${user.email}`)
  } catch (err) { console.error('Registration ITN error:', err.message) }
})

// ── Password Reset ────────────────────────────────────────────────────────────

const resetCodes = []

router.post('/forgot-password', async (req, res) => {
  const { email } = req.body
  if (!email) return res.status(400).json({ success: false, error: 'Email is required.' })
  const user = users.find((u) => u.email.toLowerCase() === email.toLowerCase())
  if (!user) return res.status(404).json({ success: false, error: 'No account found with that email address. Please check and try again.' })

  const existing = resetCodes.findIndex((r) => r.email === email.toLowerCase())
  if (existing !== -1) resetCodes.splice(existing, 1)

  const code      = String(Math.floor(100000 + Math.random() * 900000))
  const expiresAt = Date.now() + 90 * 1000
  resetCodes.push({ email: email.toLowerCase(), code, expiresAt })

  console.log(`\n  PASSWORD RESET CODE for ${email}: ${code}`)
  const emailResult = await sendResetCode(email, code, user.name)

  res.json({
    success: true,
    message: emailResult.sent ? `A 6-digit reset code has been sent to ${email}.` : 'Code generated. Check server console — email not configured yet.',
    _devCode: !emailResult.sent ? code : undefined,
  })
})

router.post('/verify-reset-code', (req, res) => {
  const { email, code } = req.body
  if (!email || !code) return res.status(400).json({ success: false, error: 'Email and code are required.' })
  const entry = resetCodes.find((r) => r.email === email.toLowerCase() && r.code === code)
  if (!entry) return res.status(400).json({ success: false, error: 'Invalid reset code.' })
  if (Date.now() > entry.expiresAt) {
    resetCodes.splice(resetCodes.indexOf(entry), 1)
    return res.status(400).json({ success: false, error: 'Code expired. Request a new one.', code: 'EXPIRED' })
  }
  entry.verified = true
  res.json({ success: true, message: 'Code verified. You may now set a new password.' })
})

router.post('/reset-password', async (req, res) => {
  const { email, code, newPassword } = req.body
  if (!email || !code || !newPassword) return res.status(400).json({ success: false, error: 'Email, code, and new password are required.' })
  if (newPassword.length < 8) return res.status(400).json({ success: false, error: 'Password must be at least 8 characters.' })
  const entry = resetCodes.find((r) => r.email === email.toLowerCase() && r.code === code && r.verified)
  if (!entry) return res.status(400).json({ success: false, error: 'Invalid or unverified reset code. Please start over.' })
  if (Date.now() > entry.expiresAt + 60000) {
    resetCodes.splice(resetCodes.indexOf(entry), 1)
    return res.status(400).json({ success: false, error: 'Session expired. Please request a new reset code.', code: 'EXPIRED' })
  }
  const user = users.find((u) => u.email.toLowerCase() === email.toLowerCase())
  if (!user) return res.status(404).json({ success: false, error: 'User not found.' })
  user.password  = await bcrypt.hash(newPassword, 12)
  user.updatedAt = new Date().toISOString()
  await userRepo.update(user).catch((err) => console.error('DB update failed:', err.message))
  resetCodes.splice(resetCodes.indexOf(entry), 1)
  res.json({ success: true, message: 'Password updated successfully. You can now sign in with your new password.' })
})

module.exports = { router, users, init }
