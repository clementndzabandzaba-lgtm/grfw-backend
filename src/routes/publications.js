const router  = require('express').Router()
const multer  = require('multer')
const path    = require('path')
const fs      = require('fs')
const { v4: uuidv4 } = require('uuid')
const { requireAuth, requireRole } = require('../middleware/auth')
const { createRepo } = require('../repositories/contentRepo')

const repo         = createRepo('publications')
const publications = []

async function init() {
  const loaded = await repo.loadAll()
  publications.length = 0
  publications.push(...loaded)
}

const UPLOAD_DIR = path.join(__dirname, '../../uploads/publications')
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true })

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename:    (_req, file, cb) => {
    const safe   = file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_')
    const unique = uuidv4().slice(0, 8)
    cb(null, `${Date.now()}-${unique}-${safe}`)
  },
})
const fileFilter = (_req, file, cb) => {
  file.mimetype === 'application/pdf' ? cb(null, true) : cb(new Error('Only PDF files are allowed'), false)
}
const upload = multer({ storage, fileFilter, limits: { fileSize: 50 * 1024 * 1024 } })

// ── GET /api/publications ────────────────────────────────────────────────────
router.get('/', (req, res) => {
  const { topic, lang, free, search } = req.query
  let result = publications.filter((p) => p.published)
  if (topic  && topic  !== 'all') result = result.filter((p) => p.topic    === topic)
  if (lang   && lang   !== 'all') result = result.filter((p) => p.language === lang)
  if (free   === 'true')          result = result.filter((p) => p.isFree)
  if (search) {
    const q = search.toLowerCase()
    result = result.filter((p) =>
      p.title.toLowerCase().includes(q) ||
      p.description.toLowerCase().includes(q)
    )
  }
  result.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
  res.json({ success: true, data: result, total: result.length })
})

// ── GET /api/publications/admin/all ─────────────────────────────────────────
router.get('/admin/all', requireAuth, requireRole('admin', 'super_admin'), (_req, res) => {
  const sorted = [...publications].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
  res.json({ success: true, data: sorted, total: sorted.length })
})

// ── GET /api/publications/:id/view ───────────────────────────────────────────
router.get('/:id/view', (req, res) => {
  const frontendUrl = process.env.FRONTEND_URL || ''
  const frameAncestors = `'self' http://localhost:3000 http://localhost:3001${frontendUrl ? ` ${frontendUrl}` : ''}`
  res.removeHeader('X-Frame-Options')
  res.setHeader('Content-Security-Policy', `frame-ancestors ${frameAncestors}`)

  const pub = publications.find((p) => p.id === req.params.id)
  if (!pub) return res.status(404).json({ success: false, error: 'Publication not found' })
  const filePath = path.join(UPLOAD_DIR, pub.fileName)
  if (!fs.existsSync(filePath)) return res.status(404).json({ success: false, error: 'PDF file not found on server' })
  res.setHeader('Content-Type', 'application/pdf')
  res.setHeader('Content-Disposition', `inline; filename="${pub.originalName}"`)
  res.setHeader('X-Content-Type-Options', 'nosniff')
  fs.createReadStream(filePath).pipe(res)
})

// ── POST /api/publications ───────────────────────────────────────────────────
router.post('/', requireAuth, requireRole('admin', 'super_admin'), upload.single('pdf'), async (req, res) => {
  if (!req.file) return res.status(400).json({ success: false, error: 'PDF file is required' })
  const { title, topic, language, description, type, isFree, published } = req.body
  if (!title) { fs.unlinkSync(req.file.path); return res.status(400).json({ success: false, error: 'Title is required' }) }
  const pub = {
    id: uuidv4(), title: title.trim(),
    topic: topic || 'general', language: language || 'English',
    description: description || '', type: type || 'Guide',
    isFree: true, cost: 0,
    fileName: req.file.filename, originalName: req.file.originalname,
    fileSize: req.file.size, views: 0,
    published: published !== 'false', uploadedBy: req.user.name,
    createdAt: new Date().toISOString(),
  }
  publications.push(pub)
  await repo.insert(pub).catch((err) => console.error('DB insert failed:', err.message))
  res.status(201).json({ success: true, data: pub, message: 'Publication uploaded successfully' })
})

// ── PATCH /api/publications/:id ──────────────────────────────────────────────
router.patch('/:id', requireAuth, requireRole('admin', 'super_admin'), async (req, res) => {
  const pub = publications.find((p) => p.id === req.params.id)
  if (!pub) return res.status(404).json({ success: false, error: 'Publication not found' })
  const allowed = ['title','topic','language','description','type','isFree','cost','published']
  for (const key of allowed) { if (req.body[key] !== undefined) pub[key] = req.body[key] }
  await repo.update(pub).catch((err) => console.error('DB update failed:', err.message))
  res.json({ success: true, data: pub, message: 'Updated' })
})

// ── DELETE /api/publications/:id ─────────────────────────────────────────────
router.delete('/:id', requireAuth, requireRole('admin', 'super_admin'), async (req, res) => {
  const idx = publications.findIndex((p) => p.id === req.params.id)
  if (idx === -1) return res.status(404).json({ success: false, error: 'Publication not found' })
  const [deleted] = publications.splice(idx, 1)
  await repo.remove(deleted.id).catch((err) => console.error('DB remove failed:', err.message))
  const filePath = path.join(UPLOAD_DIR, deleted.fileName)
  if (fs.existsSync(filePath)) try { fs.unlinkSync(filePath) } catch (_) {}
  res.json({ success: true, message: `"${deleted.title}" deleted` })
})

module.exports = { router, publications, init }
