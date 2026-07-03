const router = require('express').Router()
const { v4: uuidv4 } = require('uuid')
const { requireAuth, requireRole } = require('../middleware/auth')
const { createRepo } = require('../repositories/contentRepo')

const repo   = createRepo('events')
const events = []

async function init() {
  const loaded = await repo.loadAll()
  events.length = 0
  events.push(...loaded)
}

// ── GET /api/events ──────────────────────────────────────────────────────────
router.get('/', (req, res) => {
  const { type, category, upcoming } = req.query
  let result = events.filter((e) => e.published)
  if (type     && type     !== 'all') result = result.filter((e) => e.type     === type)
  if (category && category !== 'all') result = result.filter((e) => e.category === category)
  const now = new Date()
  if (upcoming === 'true')  result = result.filter((e) => new Date(e.date) >= now)
  if (upcoming === 'false') result = result.filter((e) => new Date(e.date) <  now)
  result.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
  res.json({ success: true, data: result, total: result.length })
})

// ── GET /api/events/admin/all ────────────────────────────────────────────────
router.get('/admin/all', requireAuth, requireRole('admin', 'super_admin'), (_req, res) => {
  const sorted = [...events].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
  res.json({ success: true, data: sorted, total: sorted.length })
})

// ── GET /api/events/:id ──────────────────────────────────────────────────────
router.get('/:id', (req, res) => {
  const event = events.find((e) => e.id === req.params.id)
  if (!event) return res.status(404).json({ success: false, error: 'Event not found' })
  res.json({ success: true, data: event })
})

// ── POST /api/events ─────────────────────────────────────────────────────────
router.post('/', requireAuth, requireRole('admin', 'super_admin'), async (req, res) => {
  const { title, host, date, time, location, type, category, description, meetingLink, capacity, isFree, cost, published } = req.body
  if (!title || !date || !host) {
    return res.status(400).json({ success: false, error: 'Title, host, and date are required' })
  }
  const costNum = parseFloat(cost) || 0
  const event = {
    id: uuidv4(), title: title.trim(), host: host.trim(), date,
    time: time || '10:00 AM', location: location || 'Online (Live)',
    type: type || 'online', category: category || 'general',
    description: description || '', meetingLink: meetingLink || '',
    capacity: parseInt(capacity) || 100, registered: 0,
    isFree: isFree !== 'false' && costNum === 0, cost: costNum,
    isLive: false, published: published !== 'false',
    createdBy: req.user.name, createdAt: new Date().toISOString(),
  }
  events.push(event)
  await repo.insert(event).catch((err) => console.error('DB insert failed:', err.message))
  res.status(201).json({ success: true, data: event, message: 'Event created successfully' })
})

// ── PATCH /api/events/:id ────────────────────────────────────────────────────
router.patch('/:id', requireAuth, requireRole('admin', 'super_admin'), async (req, res) => {
  const event = events.find((e) => e.id === req.params.id)
  if (!event) return res.status(404).json({ success: false, error: 'Event not found' })
  const allowed = ['title','host','date','time','location','type','category','description','meetingLink','capacity','isFree','cost','isLive','published']
  for (const key of allowed) { if (req.body[key] !== undefined) event[key] = req.body[key] }
  await repo.update(event).catch((err) => console.error('DB update failed:', err.message))
  res.json({ success: true, data: event, message: 'Event updated' })
})

// ── POST /api/events/:id/register ────────────────────────────────────────────
router.post('/:id/register', async (req, res) => {
  const event = events.find((e) => e.id === req.params.id)
  if (!event) return res.status(404).json({ success: false, error: 'Event not found' })
  if (event.registered >= event.capacity) {
    return res.status(409).json({ success: false, error: 'This event is fully booked' })
  }
  event.registered++
  await repo.update(event).catch((err) => console.error('DB update failed:', err.message))
  res.json({ success: true, message: 'Registered successfully! Check your email for the event link.', data: event })
})

// ── DELETE /api/events/:id ───────────────────────────────────────────────────
router.delete('/:id', requireAuth, requireRole('admin', 'super_admin'), async (req, res) => {
  const idx = events.findIndex((e) => e.id === req.params.id)
  if (idx === -1) return res.status(404).json({ success: false, error: 'Event not found' })
  const [deleted] = events.splice(idx, 1)
  await repo.remove(deleted.id).catch((err) => console.error('DB remove failed:', err.message))
  res.json({ success: true, message: `"${deleted.title}" deleted` })
})

module.exports = { router, events, init }
