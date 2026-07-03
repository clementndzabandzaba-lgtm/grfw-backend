const router  = require('express').Router()
const multer  = require('multer')
const path    = require('path')
const fs      = require('fs')
const { v4: uuidv4 } = require('uuid')
const { requireAuth, requireRole } = require('../middleware/auth')
const { createRepo } = require('../repositories/contentRepo')

const repo     = createRepo('news')
const articles = []

async function init() {
  const loaded = await repo.loadAll()
  articles.length = 0
  articles.push(...loaded)
}

const UPLOAD_DIR = path.join(__dirname, '../../uploads/news')
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true })

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename:    (_req, file, cb) => {
    const ext    = path.extname(file.originalname).toLowerCase()
    const unique = uuidv4().slice(0, 8)
    cb(null, `${Date.now()}-${unique}${ext}`)
  },
})
const fileFilter = (_req, file, cb) => {
  const allowed = ['image/jpeg','image/jpg','image/png','image/webp','image/gif']
  allowed.includes(file.mimetype) ? cb(null, true) : cb(new Error('Only image files are allowed'), false)
}
const upload = multer({ storage, fileFilter, limits: { fileSize: 10 * 1024 * 1024 } })

const slugify = (str) => str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

// ── GET /api/news ────────────────────────────────────────────────────────────
router.get('/', (req, res) => {
  const { category, search, featured } = req.query
  let result = articles.filter((a) => a.published)
  if (category && category !== 'all') result = result.filter((a) => a.category === category)
  if (featured === 'true')            result = result.filter((a) => a.featured)
  if (search) {
    const q = search.toLowerCase()
    result = result.filter((a) =>
      a.title.toLowerCase().includes(q) ||
      a.excerpt.toLowerCase().includes(q) ||
      a.content.toLowerCase().includes(q)
    )
  }
  result.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
  res.json({ success: true, data: result, total: result.length })
})

// ── GET /api/news/admin/all ──────────────────────────────────────────────────
router.get('/admin/all', requireAuth, requireRole('admin', 'super_admin'), (_req, res) => {
  const sorted = [...articles].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
  res.json({ success: true, data: sorted, total: sorted.length })
})

// ── GET /api/news/:id ────────────────────────────────────────────────────────
router.get('/:id', (req, res) => {
  const article = articles.find((a) => a.id === req.params.id || a.slug === req.params.id)
  if (!article || (!article.published && !req.headers.authorization)) {
    return res.status(404).json({ success: false, error: 'Article not found' })
  }
  res.json({ success: true, data: article })
})

// ── GET /api/news/:id/image ──────────────────────────────────────────────────
router.get('/:id/image', (req, res) => {
  const article = articles.find((a) => a.id === req.params.id)
  if (!article || !article.imageFileName) return res.status(404).json({ success: false, error: 'Image not found' })
  const filePath = path.join(UPLOAD_DIR, article.imageFileName)
  if (!fs.existsSync(filePath)) return res.status(404).json({ success: false, error: 'Image file not found on server' })
  res.sendFile(filePath)
})

// ── POST /api/news ───────────────────────────────────────────────────────────
router.post('/', requireAuth, requireRole('admin', 'super_admin'), upload.single('image'), async (req, res) => {
  const { title, category, excerpt, content, featured, published } = req.body
  if (!title || !content) {
    if (req.file) fs.unlinkSync(req.file.path)
    return res.status(400).json({ success: false, error: 'Title and content are required' })
  }
  const article = {
    id: uuidv4(), title: title.trim(), slug: slugify(title.trim()),
    category: category || 'news',
    excerpt: (excerpt || content.slice(0, 200)).trim(), content: content.trim(),
    imageFileName:     req.file ? req.file.filename     : null,
    imageOriginalName: req.file ? req.file.originalname : null,
    imageUrl:          req.file ? `/uploads/news/${req.file.filename}` : null,
    author: req.user.name, featured: featured === 'true',
    published: published !== 'false',
    readTime: Math.ceil(content.split(' ').length / 200) + ' min',
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  }
  articles.push(article)
  await repo.insert(article).catch((err) => console.error('DB insert failed:', err.message))
  res.status(201).json({ success: true, data: article, message: 'Article published successfully' })
})

// ── PATCH /api/news/:id ──────────────────────────────────────────────────────
router.patch('/:id', requireAuth, requireRole('admin', 'super_admin'), upload.single('image'), async (req, res) => {
  const article = articles.find((a) => a.id === req.params.id)
  if (!article) return res.status(404).json({ success: false, error: 'Article not found' })
  const allowed = ['title','category','excerpt','content','featured','published']
  for (const key of allowed) { if (req.body[key] !== undefined) article[key] = req.body[key] }
  if (req.body.title) article.slug = slugify(req.body.title)
  if (req.file) {
    if (article.imageFileName) {
      const old = path.join(UPLOAD_DIR, article.imageFileName)
      if (fs.existsSync(old)) try { fs.unlinkSync(old) } catch (_) {}
    }
    article.imageFileName     = req.file.filename
    article.imageOriginalName = req.file.originalname
    article.imageUrl          = `/uploads/news/${req.file.filename}`
  }
  article.updatedAt = new Date().toISOString()
  if (article.content) article.readTime = Math.ceil(article.content.split(' ').length / 200) + ' min'
  await repo.update(article).catch((err) => console.error('DB update failed:', err.message))
  res.json({ success: true, data: article, message: 'Article updated' })
})

// ── DELETE /api/news/:id ─────────────────────────────────────────────────────
router.delete('/:id', requireAuth, requireRole('admin', 'super_admin'), async (req, res) => {
  const idx = articles.findIndex((a) => a.id === req.params.id)
  if (idx === -1) return res.status(404).json({ success: false, error: 'Article not found' })
  const [deleted] = articles.splice(idx, 1)
  await repo.remove(deleted.id).catch((err) => console.error('DB remove failed:', err.message))
  if (deleted.imageFileName) {
    const filePath = path.join(UPLOAD_DIR, deleted.imageFileName)
    if (fs.existsSync(filePath)) try { fs.unlinkSync(filePath) } catch (_) {}
  }
  res.json({ success: true, message: `"${deleted.title}" deleted successfully` })
})

module.exports = { router, articles, init }
