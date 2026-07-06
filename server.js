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
  process.env.FRONTEND_URL || 'https://grfwportal.net',
].filter(Boolean)
app.use(cors({ origin: allowedOrigins, credentials: true }))
app.use(express.json({ limit: '10mb' }))
app.use(express.urlencoded({ extended: false }))  // PayFast ITN posts form-encoded data
app.use(morgan('dev'))

// Serve uploaded files — allow cross-origin so the frontend can load images/PDFs from backend
app.use('/uploads', (req, res, next) => {
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin')
  next()
}, express.static(path.join(__dirname, 'uploads')))

// ── Mount routes ─────────────────────────────────────────────────────────────
const initDb        = require('./src/initDb')
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

// Donations — initiate PayFast payment
app.post('/api/finance/donate', (req, res) => {
  const { amount, name, email, recurring } = req.body
  if (!amount || amount < 1) return res.status(400).json({ success: false, error: 'Valid amount required.' })

  const { buildPaymentData } = require('./src/utils/payfast')
  const frontendUrl = process.env.FRONTEND_URL || 'https://grfw-frontend.vercel.app'
  const backendUrl  = process.env.BACKEND_URL  || 'https://grfw-backend-production.up.railway.app'

  const { fields, url } = buildPaymentData({
    paymentId:  `don-${Date.now()}`,
    name:       name || 'Anonymous Donor',
    email:      email || 'donor@grfw.org',
    amount,
    itemName:   `GRFW Donation${recurring ? ' (Monthly)' : ''}`,
    itemDesc:   'Supporting widows and widowers through GRFW',
    returnUrl:  `${frontendUrl}/donate/thank-you`,
    cancelUrl:  `${frontendUrl}/donate`,
    notifyUrl:  `${backendUrl}/api/finance/donation-itn`,
  })
  res.json({ success: true, data: { fields, url } })
})

// Donation ITN — log received payment
app.post('/api/finance/donation-itn', (req, res) => {
  res.sendStatus(200)
  const { verifyItn } = require('./src/utils/payfast')
  if (!verifyItn(req.body)) { console.warn('Donation ITN signature mismatch'); return }
  if (req.body.payment_status === 'COMPLETE') {
    console.log(`  Donation received: R${req.body.amount_gross} from ${req.body.email_address}`)
  }
})

// Records
app.get('/api/records', (_req, res) => {
  res.json({ success: true, data: [], pagination: { total: 0, page: 1, totalPages: 1 } })
})

// Health check — no database access, always responds if the process is alive
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'GRFW Portal API',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  })
})

// Deep health check — verifies the database connection is alive
app.get('/health/db', async (_req, res) => {
  try {
    const pool = require('./src/db')
    const { rows } = await pool.query('SELECT 1 AS alive')
    res.json({ status: 'ok', db: 'connected', alive: rows[0].alive, timestamp: new Date().toISOString() })
  } catch (err) {
    res.status(503).json({ status: 'error', db: 'unreachable', error: err.message, timestamp: new Date().toISOString() })
  }
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
function ts() {
  return new Date().toISOString()
}

async function start() {
  console.log(`\n[${ts()}] [server] ── GRFW Backend starting ──`)
  console.log(`[${ts()}] [server] PORT = ${PORT}`)

  // Log DATABASE_URL presence and masked value so we can confirm the env var is set
  if (process.env.DATABASE_URL) {
    const masked = process.env.DATABASE_URL.replace(/:([^:@]+)@/, ':****@')
    console.log(`[${ts()}] [server] DATABASE_URL = ${masked}`)
  } else {
    console.warn(`[${ts()}] [server] WARNING: DATABASE_URL is not set — falling back to individual DB_* vars`)
    console.log(`[${ts()}] [server] DB_HOST=${process.env.DB_HOST || '(unset)'} DB_PORT=${process.env.DB_PORT || '(unset)'} DB_NAME=${process.env.DB_NAME || '(unset)'} DB_USER=${process.env.DB_USER || '(unset)'}`)
  }

  // Abort the whole startup if it takes longer than 60 s — prevents a silent hang
  const startupTimeout = setTimeout(() => {
    console.error(`[${ts()}] [server] FATAL: startup timed out after 60 s — database never responded`)
    process.exit(1)
  }, 60_000)
  startupTimeout.unref() // don't keep the process alive on its own

  try {
    console.log(`[${ts()}] [server] Step 1/3 — initDb()`)
    await initDb()
    console.log(`[${ts()}] [server] Step 1/3 — initDb() complete`)

    console.log(`[${ts()}] [server] Step 2/3 — authModule.init()`)
    // Auth must be first — other modules reference the users array via require('./auth')
    await authModule.init()
    console.log(`[${ts()}] [server] Step 2/3 — authModule.init() complete`)

    console.log(`[${ts()}] [server] Step 3/3 — loading all content modules`)
    await Promise.all([
      skillsMod.init(),
      newsMod.init(),
      pubsMod.init(),
      eventsMod.init(),
      jobsMod.init(),
      mentorsMod.init(),
    ])
    console.log(`[${ts()}] [server] Step 3/3 — all content modules loaded`)

    clearTimeout(startupTimeout)
    console.log(`[${ts()}] [server] All data loaded from PostgreSQL ✓\n`)
  } catch (err) {
    clearTimeout(startupTimeout)
    console.error(`[${ts()}] [server] FATAL: failed during startup initialisation`)
    console.error(`[${ts()}] [server] Error: ${err.message}`)
    console.error(err.stack)
    process.exit(1)
  }

  app.listen(PORT, () => {
    console.log(`[${ts()}] [server] GRFW Portal API — http://localhost:${PORT}`)
    console.log(`[${ts()}] [server] Health: http://localhost:${PORT}/health`)
    console.log(`[${ts()}] [server] Super Admin: ${process.env.SUPER_ADMIN_EMAIL || 'superadmin@grfw.org'}\n`)
  })
}

// Catch any unhandled promise rejections that escape the try/catch above
process.on('unhandledRejection', (reason, promise) => {
  console.error(`[${ts()}] [server] Unhandled promise rejection:`, reason)
  if (reason && reason.stack) console.error(reason.stack)
})

process.on('uncaughtException', (err) => {
  console.error(`[${ts()}] [server] Uncaught exception: ${err.message}`)
  console.error(err.stack)
  process.exit(1)
})

start()
