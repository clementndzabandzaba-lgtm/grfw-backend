const router = require('express').Router()
const { requireAuth, requireRole } = require('../middleware/auth')
const { auditLog, logAction } = require('../utils/auditLog')
const { users } = require('./auth')
const userRepo = require('../repositories/userRepo')
const { skills }       = require('./skills')
const { jobs }          = require('./jobs')
const { articles }      = require('./news')
const { events }        = require('./events')
const { publications }  = require('./publications')

// All routes below require super admin
router.use(requireAuth, requireRole('super_admin'))

const safeUser = (u) => ({
  id: u.id, name: u.name, email: u.email, role: u.role,
  country: u.country, status: u.status, avatar: u.avatar || null,
  isSubscribed: u.isSubscribed || false, createdAt: u.createdAt,
})

// ── GET /api/superadmin/users — list every user on the platform ────────────
router.get('/users', (_req, res) => {
  const sorted = [...users].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
  res.json({ success: true, data: sorted.map(safeUser), total: sorted.length })
})

// ── PATCH /api/superadmin/users/:id/role — change a user's role ────────────
router.patch('/users/:id/role', (req, res) => {
  const { role } = req.body
  const allowedRoles = ['member', 'admin', 'super_admin']
  if (!allowedRoles.includes(role)) {
    return res.status(400).json({ success: false, error: 'Invalid role.' })
  }

  const target = users.find((u) => u.id === req.params.id)
  if (!target) return res.status(404).json({ success: false, error: 'User not found.' })

  if (target.id === req.user.id) {
    return res.status(400).json({ success: false, error: 'You cannot change your own role.' })
  }

  const oldRole = target.role
  target.role = role
  // Promoting to admin/super_admin should also mark them active if they were pending
  if ((role === 'admin' || role === 'super_admin') && target.status?.startsWith('pending')) {
    target.status = 'active'
  }
  userRepo.update(target)

  logAction({
    actorName: req.user.name, actorId: req.user.id, actorRole: req.user.role,
    action: 'ROLE_CHANGE',
    target: `${target.name} — ${oldRole} → ${role}`,
    risk: 'high',
  })

  res.json({ success: true, message: `${target.name}'s role updated to ${role}.`, data: safeUser(target) })
})

// ── PATCH /api/superadmin/users/:id/status — suspend / reactivate a user ──
router.patch('/users/:id/status', (req, res) => {
  const { status } = req.body
  if (!['active', 'suspended'].includes(status)) {
    return res.status(400).json({ success: false, error: 'Status must be "active" or "suspended".' })
  }

  const target = users.find((u) => u.id === req.params.id)
  if (!target) return res.status(404).json({ success: false, error: 'User not found.' })

  if (target.id === req.user.id) {
    return res.status(400).json({ success: false, error: 'You cannot suspend your own account.' })
  }

  target.status = status
  userRepo.update(target)

  logAction({
    actorName: req.user.name, actorId: req.user.id, actorRole: req.user.role,
    action: status === 'suspended' ? 'SUSPENDED_USER' : 'REACTIVATED_USER',
    target: `${target.name} (${target.email})`,
    risk: 'medium',
  })

  res.json({ success: true, message: `${target.name} has been ${status === 'suspended' ? 'suspended' : 'reactivated'}.`, data: safeUser(target) })
})

// ── DELETE /api/superadmin/users/:id — permanently remove a user ──────────
router.delete('/users/:id', (req, res) => {
  const idx = users.findIndex((u) => u.id === req.params.id)
  if (idx === -1) return res.status(404).json({ success: false, error: 'User not found.' })
  if (users[idx].id === req.user.id) {
    return res.status(400).json({ success: false, error: 'You cannot delete your own account.' })
  }

  const [deleted] = users.splice(idx, 1)
  userRepo.remove(deleted.id)

  logAction({
    actorName: req.user.name, actorId: req.user.id, actorRole: req.user.role,
    action: 'DELETED_USER',
    target: `${deleted.name} (${deleted.email})`,
    risk: 'high',
  })

  res.json({ success: true, message: `${deleted.name}'s account has been permanently deleted.` })
})

// ── GET /api/superadmin/audit — audit log ──────────────────────────────────
router.get('/audit', (req, res) => {
  const { risk, search } = req.query
  let result = [...auditLog]
  if (risk && risk !== 'all') result = result.filter((a) => a.risk === risk)
  if (search) {
    const q = search.toLowerCase()
    result = result.filter((a) =>
      a.actor.toLowerCase().includes(q) ||
      a.action.toLowerCase().includes(q) ||
      a.target.toLowerCase().includes(q)
    )
  }
  res.json({ success: true, data: result, total: result.length })
})

// ── GET /api/superadmin/analytics — real platform stats ────────────────────
router.get('/analytics', (_req, res) => {
  const members      = users.filter((u) => u.role === 'member')
  const admins        = users.filter((u) => u.role === 'admin')
  const superAdmins   = users.filter((u) => u.role === 'super_admin')
  const activeUsers   = users.filter((u) => u.status === 'active')
  const pendingMembers = users.filter((u) => u.status === 'pending_admin')
  const pendingAdmins  = users.filter((u) => u.status === 'pending_superadmin')
  const suspended      = users.filter((u) => u.status === 'suspended')
  const subscribed     = users.filter((u) => u.isSubscribed)

  // Members by country — real distribution from registered users
  const countryCounts = {}
  users.forEach((u) => {
    if (!u.country) return
    countryCounts[u.country] = (countryCounts[u.country] || 0) + 1
  })
  const byCountry = Object.entries(countryCounts)
    .map(([country, count]) => ({ country, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8)

  // Content distribution — real counts from each module
  const contentCounts = [
    { name: 'Skills',        value: skills.length },
    { name: 'Jobs',          value: jobs.length },
    { name: 'News Articles', value: articles.length },
    { name: 'Live Events',   value: events.length },
    { name: 'Publications',  value: publications.length },
  ]

  res.json({
    success: true,
    data: {
      kpis: {
        totalUsers:      users.length,
        totalMembers:    members.length,
        totalAdmins:     admins.length,
        totalSuperAdmins:superAdmins.length,
        activeUsers:     activeUsers.length,
        suspendedUsers:  suspended.length,
        pendingMembers:  pendingMembers.length,
        pendingAdmins:   pendingAdmins.length,
        subscribedUsers: subscribed.length,
        totalSkills:      skills.length,
        totalJobs:        jobs.length,
        totalNews:        articles.length,
        totalEvents:      events.length,
        totalPublications:publications.length,
        countriesActive: Object.keys(countryCounts).length,
      },
      byCountry,
      contentCounts,
    },
  })
})

// ── System Config — in-memory store ─────────────────────────────────────────
let systemConfig = {
  orgName:      'Global Resilience Foundation for Widows',
  tagline:      'Empower • Support • Transform • Thrive',
  supportEmail: 'hello@grfw.org',
  whatsapp:     '+254700000001',
  defaultCurrency: 'USD',
}

let featureFlags = [
  { key: 'community_forum',    label: 'Community Forum',          desc: 'Enable the member forum and discussion boards', enabled: true  },
  { key: 'mentorship',         label: 'Mentorship Marketplace',   desc: 'Allow members to book mentorship sessions',     enabled: true  },
  { key: 'career_compass',     label: 'Career Compass',           desc: 'Enable the AI-assisted career guidance tool',   enabled: true  },
  { key: 'entrepreneur_hub',   label: 'Entrepreneur Hub',         desc: 'Enable the business directory and pitch tool',  enabled: true  },
  { key: 'live_streaming',     label: 'Live Workshop Streaming',  desc: 'Enable live event streaming',                   enabled: false },
  { key: 'low_bandwidth_mode', label: 'Low-Bandwidth Mode',       desc: 'Allow users to toggle data-saving text mode',   enabled: true  },
  { key: 'subscriptions',      label: 'Paid Subscriptions',       desc: 'Require an active subscription for member access', enabled: true },
  { key: 'employer_portal',    label: 'Employer Job Submissions', desc: 'Allow employers to submit job listings',        enabled: true  },
]

// GET /api/superadmin/config
router.get('/config', (_req, res) => {
  res.json({ success: true, data: { ...systemConfig, flags: featureFlags } })
})

// PUT /api/superadmin/config — update general settings
router.put('/config', (req, res) => {
  const { orgName, tagline, supportEmail, whatsapp, defaultCurrency } = req.body
  systemConfig = {
    orgName:         orgName         ?? systemConfig.orgName,
    tagline:         tagline         ?? systemConfig.tagline,
    supportEmail:    supportEmail    ?? systemConfig.supportEmail,
    whatsapp:        whatsapp        ?? systemConfig.whatsapp,
    defaultCurrency: defaultCurrency ?? systemConfig.defaultCurrency,
  }

  logAction({
    actorName: req.user.name, actorId: req.user.id, actorRole: req.user.role,
    action: 'CONFIG_CHANGE',
    target: 'General settings updated',
    risk: 'high',
  })

  res.json({ success: true, message: 'System configuration saved.', data: systemConfig })
})

// PATCH /api/superadmin/config/flags/:key — toggle a feature flag
router.patch('/config/flags/:key', (req, res) => {
  const flag = featureFlags.find((f) => f.key === req.params.key)
  if (!flag) return res.status(404).json({ success: false, error: 'Feature flag not found.' })

  flag.enabled = req.body.value !== undefined ? !!req.body.value : !flag.enabled

  logAction({
    actorName: req.user.name, actorId: req.user.id, actorRole: req.user.role,
    action: 'CONFIG_CHANGE',
    target: `Feature flag: ${flag.label} → ${flag.enabled ? 'enabled' : 'disabled'}`,
    risk: 'high',
  })

  res.json({ success: true, data: flag })
})

module.exports = router
