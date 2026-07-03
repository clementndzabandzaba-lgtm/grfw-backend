const router = require('express').Router()
const { v4: uuidv4 } = require('uuid')
const { requireAuth, requireRole } = require('../middleware/auth')
const { createRepo } = require('../repositories/contentRepo')
const { logAction } = require('../utils/auditLog')

const applicationsRepo = createRepo('mentor_applications')
const mentorsRepo      = createRepo('approved_mentors')

const applications    = []
const approvedMentors = []

async function init() {
  const [loadedApps, loadedMentors] = await Promise.all([
    applicationsRepo.loadAll(),
    mentorsRepo.loadAll(),
  ])
  applications.length = 0
  applications.push(...loadedApps)
  approvedMentors.length = 0
  approvedMentors.push(...loadedMentors)
}

// ── GET /api/mentors ─────────────────────────────────────────────────────────
router.get('/', (_req, res) => {
  const result = approvedMentors.filter((m) => m.isActive)
  res.json({ success: true, data: result, total: result.length })
})

// ── POST /api/mentors/apply ──────────────────────────────────────────────────
router.post('/apply', requireAuth, async (req, res) => {
  const existing = applications.find((a) => a.userId === req.user.id)
  if (existing) {
    return res.status(409).json({
      success: false,
      error: `You already submitted an application (status: ${existing.status}). We will be in touch.`,
    })
  }
  const { fullName, email, country, currentTitle, organisation, expertise, bio, whyMentor, availability, sessionTypes, linkedin, languages } = req.body
  if (!currentTitle || !bio || !whyMentor) {
    return res.status(400).json({ success: false, error: 'Job title, bio, and motivation are required.' })
  }
  if (!Array.isArray(expertise) || expertise.length === 0) {
    return res.status(400).json({ success: false, error: 'Select at least one area of expertise.' })
  }
  const application = {
    id: uuidv4(), userId: req.user.id,
    fullName: fullName || req.user.name, email: email || req.user.email,
    country: country || '', currentTitle, organisation: organisation || '',
    expertise, bio, whyMentor,
    availability: Array.isArray(availability) ? availability : [],
    sessionTypes:  Array.isArray(sessionTypes)  ? sessionTypes  : [],
    linkedin: linkedin || '', languages: languages || '',
    status: 'pending', appliedAt: new Date().toISOString(),
    reviewedAt: null, reviewedBy: null, rejectionNote: '',
  }
  applications.push(application)
  await applicationsRepo.insert(application).catch((err) => console.error('DB insert failed:', err.message))
  res.status(201).json({
    success: true,
    message: 'Your mentor application has been submitted! Our team will review it and you will be notified once a decision is made.',
    data: application,
  })
})

// ── GET /api/mentors/applications ────────────────────────────────────────────
router.get('/applications', requireAuth, requireRole('admin', 'super_admin'), (_req, res) => {
  const sorted = [...applications].sort((a, b) => new Date(b.appliedAt).getTime() - new Date(a.appliedAt).getTime())
  res.json({ success: true, data: sorted, total: sorted.length })
})

// ── GET /api/mentors/approved ─────────────────────────────────────────────────
router.get('/approved', requireAuth, requireRole('admin', 'super_admin'), (_req, res) => {
  res.json({ success: true, data: approvedMentors, total: approvedMentors.length })
})

// ── PATCH /api/mentors/applications/:id/approve ──────────────────────────────
router.patch('/applications/:id/approve', requireAuth, requireRole('admin', 'super_admin'), async (req, res) => {
  const application = applications.find((a) => a.id === req.params.id)
  if (!application) return res.status(404).json({ success: false, error: 'Application not found.' })
  if (application.status !== 'pending') {
    return res.status(400).json({ success: false, error: `Application already ${application.status}.` })
  }
  application.status     = 'approved'
  application.reviewedAt = new Date().toISOString()
  application.reviewedBy = req.user.name
  await applicationsRepo.update(application).catch((err) => console.error('DB update failed:', err.message))

  const mentor = {
    id: uuidv4(), applicationId: application.id, userId: application.userId,
    name: application.fullName, title: application.currentTitle,
    company: application.organisation, expertise: application.expertise,
    bio: application.bio, availability: application.availability,
    sessionTypes: application.sessionTypes, linkedin: application.linkedin,
    languages: application.languages, rating: 0, sessions: 0,
    isActive: true, approvedAt: new Date().toISOString(), approvedBy: req.user.name,
  }
  approvedMentors.push(mentor)
  await mentorsRepo.insert(mentor).catch((err) => console.error('DB insert failed:', err.message))

  logAction({
    actorName: req.user.name, actorId: req.user.id, actorRole: req.user.role,
    action: 'APPROVED_MENTOR', target: `${mentor.name} (${application.email})`, risk: 'low',
  })
  res.json({ success: true, message: `${mentor.name} approved and published on the Mentorship page!`, data: mentor })
})

// ── PATCH /api/mentors/applications/:id/reject ───────────────────────────────
router.patch('/applications/:id/reject', requireAuth, requireRole('admin', 'super_admin'), async (req, res) => {
  const application = applications.find((a) => a.id === req.params.id)
  if (!application) return res.status(404).json({ success: false, error: 'Application not found.' })
  if (application.status !== 'pending') {
    return res.status(400).json({ success: false, error: `Application already ${application.status}.` })
  }
  application.status        = 'rejected'
  application.reviewedAt    = new Date().toISOString()
  application.reviewedBy    = req.user.name
  application.rejectionNote = req.body.reason || 'Application not approved at this time.'
  await applicationsRepo.update(application).catch((err) => console.error('DB update failed:', err.message))

  logAction({
    actorName: req.user.name, actorId: req.user.id, actorRole: req.user.role,
    action: 'REJECTED_MENTOR', target: `${application.fullName} (${application.email})`, risk: 'medium',
  })
  res.json({ success: true, message: 'Application rejected.' })
})

// ── PATCH /api/mentors/:id/toggle ────────────────────────────────────────────
router.patch('/:id/toggle', requireAuth, requireRole('admin', 'super_admin'), async (req, res) => {
  const mentor = approvedMentors.find((m) => m.id === req.params.id)
  if (!mentor) return res.status(404).json({ success: false, error: 'Mentor not found.' })
  mentor.isActive = !mentor.isActive
  await mentorsRepo.update(mentor).catch((err) => console.error('DB update failed:', err.message))
  res.json({ success: true, data: mentor })
})

// ── DELETE /api/mentors/:id ───────────────────────────────────────────────────
router.delete('/:id', requireAuth, requireRole('admin', 'super_admin'), async (req, res) => {
  const idx = approvedMentors.findIndex((m) => m.id === req.params.id)
  if (idx === -1) return res.status(404).json({ success: false, error: 'Mentor not found.' })
  const [deleted] = approvedMentors.splice(idx, 1)
  await mentorsRepo.remove(deleted.id).catch((err) => console.error('DB remove failed:', err.message))
  res.json({ success: true, message: `${deleted.name} removed.` })
})

module.exports = { router, applications, approvedMentors, init }
