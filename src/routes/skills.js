const router  = require('express').Router()
const multer  = require('multer')
const path    = require('path')
const fs      = require('fs')
const { v4: uuidv4 } = require('uuid')
const { requireAuth, requireRole } = require('../middleware/auth')
const { createRepo } = require('../repositories/contentRepo')

const repo = createRepo('skills')
const skills = []

async function init() {
  const loaded = await repo.loadAll()
  skills.length = 0
  skills.push(...loaded)
}

const UPLOAD_DIR = path.join(__dirname, '../../uploads/skills')
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true })

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename:    (_req, file, cb) => {
    const unique  = uuidv4().slice(0, 8)
    const safeName = file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_')
    cb(null, `${Date.now()}-${unique}-${safeName}`)
  },
})
const fileFilter = (_req, file, cb) => {
  file.mimetype === 'application/pdf' ? cb(null, true) : cb(new Error('Only PDF files are allowed'), false)
}
const upload = multer({ storage, fileFilter, limits: { fileSize: 50 * 1024 * 1024 } })

// ── GET /api/skills ─────────────────────────────────────────────────────────
router.get('/', (req, res) => {
  const { category, level, mode, free, search } = req.query
  let result = skills.filter((s) => s.published)
  if (category && category !== 'all') result = result.filter((s) => s.category === category)
  if (level    && level    !== 'all') result = result.filter((s) => s.level    === level)
  if (mode     && mode     !== 'all') result = result.filter((s) => s.deliveryMode === mode)
  if (free === 'true')                result = result.filter((s) => s.isFree)
  if (search) {
    const q = search.toLowerCase()
    result = result.filter((s) =>
      s.title.toLowerCase().includes(q) ||
      s.description.toLowerCase().includes(q) ||
      s.provider.toLowerCase().includes(q)
    )
  }
  res.json({ success: true, data: result, total: result.length })
})

// ── GET /api/skills/all ─────────────────────────────────────────────────────
router.get('/all', requireAuth, requireRole('admin', 'super_admin'), (req, res) => {
  res.json({ success: true, data: skills, total: skills.length })
})

// ── GET /api/skills/:id ─────────────────────────────────────────────────────
router.get('/:id', (req, res) => {
  const skill = skills.find((s) => s.id === req.params.id)
  if (!skill) return res.status(404).json({ success: false, error: 'Skill not found' })
  res.json({ success: true, data: skill })
})

// ── GET /api/skills/:id/view ────────────────────────────────────────────────
router.get('/:id/view', (req, res) => {
  const skill = skills.find((s) => s.id === req.params.id)
  if (!skill) return res.status(404).json({ success: false, error: 'Skill not found' })
  const filePath = path.join(UPLOAD_DIR, skill.fileName)
  if (!fs.existsSync(filePath)) return res.status(404).json({ success: false, error: 'PDF file not found on server' })
  const frontendUrl = process.env.FRONTEND_URL || ''
  const frameAncestors = `'self' http://localhost:3000 http://localhost:3001${frontendUrl ? ` ${frontendUrl}` : ''}`
  res.removeHeader('X-Frame-Options')
  res.setHeader('Content-Security-Policy', `frame-ancestors ${frameAncestors}`)
  res.setHeader('Content-Type', 'application/pdf')
  res.setHeader('Content-Disposition', `inline; filename="${skill.originalName}"`)
  fs.createReadStream(filePath).pipe(res)
})

// ── POST /api/skills ────────────────────────────────────────────────────────
router.post('/', requireAuth, requireRole('admin', 'super_admin'), upload.single('pdf'), async (req, res) => {
  if (!req.file) return res.status(400).json({ success: false, error: 'PDF file is required' })
  const { title, provider, category, duration, level, cost, deliveryMode, description, accredited } = req.body
  if (!title || !category || !level) {
    fs.unlinkSync(req.file.path)
    return res.status(400).json({ success: false, error: 'Title, category, and level are required' })
  }
  const costNum = parseFloat(cost) || 0
  const newSkill = {
    id: uuidv4(), title: title.trim(), provider: provider || 'GRFW Academy',
    category, duration: duration || 'Self-paced', level, cost: costNum, isFree: costNum === 0,
    deliveryMode: deliveryMode || 'online', description: description || '',
    accredited: accredited === 'true', rating: 0, enrolledCount: 0,
    fileName: req.file.filename, originalName: req.file.originalname, fileSize: req.file.size,
    published: true, uploadedBy: req.user.name,
    uploadedAt: new Date().toISOString(), createdAt: new Date().toISOString(),
  }
  skills.push(newSkill)
  await repo.insert(newSkill).catch((err) => console.error('DB insert failed:', err.message))
  res.status(201).json({ success: true, data: newSkill, message: 'Skill PDF uploaded successfully' })
})

// ── PATCH /api/skills/:id ───────────────────────────────────────────────────
router.patch('/:id', requireAuth, requireRole('admin', 'super_admin'), async (req, res) => {
  const skill = skills.find((s) => s.id === req.params.id)
  if (!skill) return res.status(404).json({ success: false, error: 'Skill not found' })
  const allowed = ['title','provider','category','duration','level','cost','deliveryMode','description','accredited','published']
  for (const key of allowed) { if (req.body[key] !== undefined) skill[key] = req.body[key] }
  if (req.body.cost !== undefined) { skill.cost = parseFloat(req.body.cost) || 0; skill.isFree = skill.cost === 0 }
  await repo.update(skill).catch((err) => console.error('DB update failed:', err.message))
  res.json({ success: true, data: skill, message: 'Skill updated' })
})

// ── DELETE /api/skills/:id ──────────────────────────────────────────────────
router.delete('/:id', requireAuth, requireRole('admin', 'super_admin'), async (req, res) => {
  const idx = skills.findIndex((s) => s.id === req.params.id)
  if (idx === -1) return res.status(404).json({ success: false, error: 'Skill not found' })
  const [deleted] = skills.splice(idx, 1)
  await repo.remove(deleted.id).catch((err) => console.error('DB remove failed:', err.message))
  const filePath = path.join(UPLOAD_DIR, deleted.fileName)
  if (fs.existsSync(filePath)) try { fs.unlinkSync(filePath) } catch (_) {}
  res.json({ success: true, message: `"${deleted.title}" deleted successfully` })
})

module.exports = { router, skills, init }
