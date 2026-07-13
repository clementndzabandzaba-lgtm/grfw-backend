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

  const { name = 'Attendee', email } = req.body
  event.registered++
  await repo.update(event).catch((err) => console.error('DB update failed:', err.message))

  // Send confirmation email if email provided and Resend key is set
  if (email && process.env.RESEND_API_KEY) {
    const { Resend } = require('resend')
    const resend = new Resend(process.env.RESEND_API_KEY)
    const eventDate = new Date(event.date).toLocaleDateString('en', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
    const html = `
      <!DOCTYPE html><html><body style="font-family:Arial,sans-serif;background:#f0e8ff;padding:40px 0;margin:0">
      <div style="max-width:520px;margin:0 auto;background:white;border-radius:20px;overflow:hidden;box-shadow:0 8px 40px rgba(74,0,170,0.12)">
        <div style="background:linear-gradient(135deg,#1a0042,#4a00aa);padding:32px;text-align:center">
          <h1 style="color:#d97706;font-size:20px;margin:0;letter-spacing:1px">GRFW</h1>
          <p style="color:rgba(255,255,255,0.65);font-size:12px;margin:4px 0 0">Global Resilience Foundation for Widows</p>
        </div>
        <div style="padding:36px 32px">
          <h2 style="color:#4a00aa;font-family:Georgia,serif;font-size:22px;margin:0 0 8px">You're Registered!</h2>
          <p style="color:#6b7280;font-size:14px;margin:0 0 24px">Hi ${name}, your spot is confirmed for:</p>
          <div style="background:#f5f0ff;border-left:4px solid #4a00aa;border-radius:0 12px 12px 0;padding:20px 24px;margin:0 0 24px">
            <p style="margin:0 0 8px;font-weight:700;color:#1a0042;font-size:16px">${event.title}</p>
            <p style="margin:0 0 4px;color:#6b7280;font-size:13px">📅 ${eventDate}</p>
            <p style="margin:0 0 4px;color:#6b7280;font-size:13px">🕐 ${event.time}</p>
            <p style="margin:0;color:#6b7280;font-size:13px">📍 ${event.location}</p>
            ${event.meetingLink ? `<p style="margin:12px 0 0"><a href="${event.meetingLink}" style="color:#4a00aa;font-weight:600;font-size:13px">Join Link: ${event.meetingLink}</a></p>` : ''}
          </div>
          <p style="color:#9ca3af;font-size:12px;margin:0">Hosted by <strong>${event.host}</strong>. We look forward to seeing you there!</p>
        </div>
        <div style="background:#f9f7ff;padding:16px;text-align:center;border-top:1px solid #ede0ff">
          <p style="color:#d97706;font-size:11px;margin:0">Empower · Support · Transform · Thrive · grfwportal.net</p>
        </div>
      </div></body></html>`
    resend.emails.send({
      from: 'GRFW Events <onboarding@resend.dev>',
      to: email,
      subject: `You're registered: ${event.title}`,
      html,
    }).catch((err) => console.error('Event confirmation email failed:', err.message))
  }

  res.json({ success: true, message: 'Registered successfully! A confirmation has been sent to your email.', data: event })
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
