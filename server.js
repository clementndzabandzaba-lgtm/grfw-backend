require('dotenv').config()
const express = require('express')
const cors    = require('cors')
const helmet  = require('helmet')
const morgan  = require('morgan')
const path    = require('path')

const app  = express()
const PORT = process.env.PORT || 5000

// iisnode fix — IIS URL Rewrite passes the original URL in x-original-url header.
// Without this, req.url arrives as '/server.js' for every request on SmarterASP.
app.use((req, _res, next) => {
  const orig = req.headers['x-original-url']
  if (orig) {
    try {
      const parsed = new URL(orig, 'http://localhost')
      req.url = parsed.pathname + (parsed.search || '')
    } catch (_) {}
  }
  next()
})

// Middleware
app.use(helmet({ contentSecurityPolicy: false }))
const allowedOrigins = [
  'http://localhost:3000',
  'http://localhost:3001',
  process.env.FRONTEND_URL,
].filter(Boolean)
app.use(cors({ origin: allowedOrigins, credentials: true }))
app.use(express.json({ limit: '10mb' }))
app.use(morgan('dev'))

// Serve uploaded files — allow cross-origin so the frontend can load images/PDFs from backend
app.use('/uploads', (req, res, next) => {
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin')
  next()
}, express.static(path.join(__dirname, 'uploads')))

// ── Mount routes ─────────────────────────────────────────────────────────────
const authModule    = require('./src/routes/auth')
const skillsMod     = require('./src/routes/skills')
const newsMod       = require('./src/routes/news')
const pubsMod       = require('./src/routes/publications')
const eventsMod     = require('./src/routes/events')
const jobsMod       = require('./src/routes/jobs')
const mentorsMod    = require('./src/routes/mentors')
const superadminMod = require('./src/routes/superadmin')

app.use('/api/auth',       authModule.router)
app.use('/api/skills',     skillsMod.router)
app.use('/api/news',       newsMod.router)
app.use('/api/publications', pubsMod.router)
app.use('/api/events',     eventsMod.router)
app.use('/api/jobs',       jobsMod.router)
app.use('/api/mentors',    mentorsMod.router)
app.use('/api/superadmin', superadminMod)

// Newsletter
app.post('/api/newsletter/subscribe', (req, res) => {
  const { email } = req.body
  if (!email) return res.status(400).json({ success: false, error: 'Email required' })
  res.json({ success: true, message: 'Subscribed successfully!' })
})

// Donations
app.post('/api/finance/donate', (req, res) => {
  const { amount } = req.body
  if (!amount || amount < 1) return res.status(400).json({ success: false, error: 'Valid amount required' })
  res.json({ success: true, message: `Thank you for your donation of $${amount}!` })
})

// Records
app.get('/api/records', (_req, res) => {
  res.json({ success: true, data: [], pagination: { total: 0, page: 1, totalPages: 1 } })
})

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'GRFW Portal API', timestamp: new Date().toISOString() })
})

// 404
app.use((req, res) => {
  res.status(404).json({ success: false, error: `Route ${req.method} ${req.path} not found` })
})

// Error handler
app.use((err, req, res, _next) => {
  console.error(err)
  res.status(500).json({ success: false, error: 'Internal server error' })
})

// ── Startup — load all data from PostgreSQL then start listening ───────────
async function start() {
  console.log('\n  Loading data from PostgreSQL...')
  try {
    // Auth must be first — other modules reference the users array via require('./auth')
    await authModule.init()
    await Promise.all([
      skillsMod.init(),
      newsMod.init(),
      pubsMod.init(),
      eventsMod.init(),
      jobsMod.init(),
      mentorsMod.init(),
    ])
    console.log('  All data loaded from PostgreSQL ✓\n')
  } catch (err) {
    console.error('  Failed to load data from PostgreSQL:', err.message)
    process.exit(1)
  }

  app.listen(PORT, () => {
    console.log(` GRFW Portal API — http://localhost:${PORT}`)
    console.log(` Health: http://localhost:${PORT}/health`)
    console.log(` Super Admin: ${process.env.SUPER_ADMIN_EMAIL || 'superadmin@grfw.org'}\n`)
  })
}

start()
