const router = require('express').Router()
const { v4: uuidv4 } = require('uuid')
const { requireAuth, requireRole } = require('../middleware/auth')
const { createRepo } = require('../repositories/contentRepo')

const jobsRepo     = createRepo('jobs')
const jobs         = []
const applications = []
const alerts       = []

async function init() {
  const loaded = await jobsRepo.loadAll()
  jobs.length = 0
  jobs.push(...loaded)
}

// ── GET /api/jobs ────────────────────────────────────────────────────────────
router.get('/', (req, res) => {
  const { type, sector, search } = req.query
  let result = jobs.filter((j) => j.isActive)
  if (type   && type   !== 'all') result = result.filter((j) => j.type   === type)
  if (sector && sector !== 'all') result = result.filter((j) => j.sector === sector)
  if (search) {
    const q = search.toLowerCase()
    result = result.filter((j) =>
      j.title.toLowerCase().includes(q)        ||
      j.employerName.toLowerCase().includes(q) ||
      j.location.toLowerCase().includes(q)     ||
      j.sector.toLowerCase().includes(q)
    )
  }
  result.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
  res.json({ success: true, data: result, total: result.length })
})

// ── GET /api/jobs/admin/all ──────────────────────────────────────────────────
router.get('/admin/all', requireAuth, requireRole('admin', 'super_admin'), (req, res) => {
  const sorted = [...jobs].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
  res.json({ success: true, data: sorted, total: sorted.length })
})

// ── GET /api/jobs/my/applications ───────────────────────────────────────────
router.get('/my/applications', requireAuth, (req, res) => {
  const userApps = applications.filter((a) => a.userId === req.user.id)
  res.json({ success: true, data: userApps })
})

// ── GET /api/jobs/:id ────────────────────────────────────────────────────────
router.get('/:id', (req, res) => {
  const job = jobs.find((j) => j.id === req.params.id)
  if (!job) return res.status(404).json({ success: false, error: 'Job not found' })
  res.json({ success: true, data: job })
})

// ── POST /api/jobs ───────────────────────────────────────────────────────────
router.post('/', requireAuth, requireRole('admin', 'super_admin'), async (req, res) => {
  const { title, employerName, location, type, sector, salaryRange, deadline, description, requiredSkills, applyUrl, isVerifiedEmployer } = req.body
  if (!title || !employerName || !location || !deadline) {
    return res.status(400).json({ success: false, error: 'Title, employer name, location, and deadline are required' })
  }
  const newJob = {
    id: uuidv4(), title: title.trim(), employerName: employerName.trim(),
    location: location.trim(), type: type || 'full_time', sector: sector || 'General',
    salaryRange: salaryRange || '', deadline, description: description || '',
    requiredSkills: Array.isArray(requiredSkills)
      ? requiredSkills
      : (requiredSkills || '').split(',').map((s) => s.trim()).filter(Boolean),
    applyUrl: applyUrl || '',
    isVerifiedEmployer: isVerifiedEmployer === true || isVerifiedEmployer === 'true',
    isActive: true, applicantCount: 0, postedBy: req.user.name,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  }
  jobs.push(newJob)
  await jobsRepo.insert(newJob).catch((err) => console.error('DB insert failed:', err.message))
  res.status(201).json({ success: true, data: newJob, message: 'Job listing published successfully' })
})

// ── PATCH /api/jobs/:id ──────────────────────────────────────────────────────
router.patch('/:id', requireAuth, requireRole('admin', 'super_admin'), async (req, res) => {
  const job = jobs.find((j) => j.id === req.params.id)
  if (!job) return res.status(404).json({ success: false, error: 'Job not found' })
  const allowed = ['title','employerName','location','type','sector','salaryRange','deadline','description','requiredSkills','applyUrl','isVerifiedEmployer','isActive']
  for (const key of allowed) { if (req.body[key] !== undefined) job[key] = req.body[key] }
  job.updatedAt = new Date().toISOString()
  await jobsRepo.update(job).catch((err) => console.error('DB update failed:', err.message))
  res.json({ success: true, data: job, message: 'Job updated' })
})

// ── DELETE /api/jobs/:id ─────────────────────────────────────────────────────
router.delete('/:id', requireAuth, requireRole('admin', 'super_admin'), async (req, res) => {
  const idx = jobs.findIndex((j) => j.id === req.params.id)
  if (idx === -1) return res.status(404).json({ success: false, error: 'Job not found' })
  const [deleted] = jobs.splice(idx, 1)
  await jobsRepo.remove(deleted.id).catch((err) => console.error('DB remove failed:', err.message))
  res.json({ success: true, message: `"${deleted.title}" deleted successfully` })
})

// ── POST /api/jobs/:id/apply ────────────────────────────────────────────────
router.post('/:id/apply', requireAuth, async (req, res) => {
  const job = jobs.find((j) => j.id === req.params.id)
  if (!job) return res.status(404).json({ success: false, error: 'Job not found' })
  const existing = applications.find((a) => a.userId === req.user.id && a.jobId === req.params.id)
  if (existing) return res.status(409).json({ success: false, error: 'Already applied' })
  const application = {
    id: uuidv4(), userId: req.user.id, jobId: req.params.id,
    jobTitle: job.title, employer: job.employerName,
    status: 'applied', appliedAt: new Date().toISOString(),
  }
  applications.push(application)
  job.applicantCount++
  await jobsRepo.update(job).catch((err) => console.error('DB update failed:', err.message))
  res.status(201).json({ success: true, data: application, message: 'Application submitted!' })
})

// ── POST /api/jobs/alerts/subscribe ─────────────────────────────────────────
router.post('/alerts/subscribe', (req, res) => {
  const { email, categories } = req.body
  if (!email) return res.status(400).json({ success: false, error: 'Email required' })
  alerts.push({ email, categories, subscribedAt: new Date().toISOString() })
  res.json({ success: true, message: 'Subscribed to job alerts!' })
})

module.exports = { router, jobs, applications, init }
