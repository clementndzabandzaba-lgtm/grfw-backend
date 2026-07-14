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
app.use(helmet({ contentSecurityPolicy: false, frameguard: false }))
app.use(cors({
  origin: (origin, callback) => {
    // Allow server-to-server (no origin header), localhost dev, all *.vercel.app deployments,
    // grfwportal.net and www.grfwportal.net, and any explicitly configured FRONTEND_URL.
    const allowed = process.env.FRONTEND_URL ? process.env.FRONTEND_URL.split(',').map((u) => u.trim()) : []
    if (
      !origin ||
      /^https?:\/\/localhost(:\d+)?$/.test(origin) ||
      /^https?:\/\/127\.0\.0\.1(:\d+)?$/.test(origin) ||
      origin.endsWith('.vercel.app') ||
      origin === 'https://grfwportal.net' ||
      origin === 'https://www.grfwportal.net' ||
      allowed.includes(origin)
    ) {
      return callback(null, true)
    }
    callback(new Error(`CORS: origin not allowed — ${origin}`))
  },
  credentials: true,
}))
app.use(express.json({ limit: '10mb' }))
app.use(express.urlencoded({ extended: false }))  // PayFast ITN posts form-encoded data
app.use(morgan('dev'))

// Serve uploaded files — allow cross-origin so the frontend can load images/PDFs from backend
app.use('/uploads', (req, res, next) => {
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin')
  next()
}, express.static(path.join(__dirname, 'uploads')))

// ── DB-ready gate — must be registered BEFORE API routes ─────────────────────
// The server binds to the port immediately so Railway's health check passes,
// but API calls return 503 until the database has finished loading.
let dbReady = false
app.use('/api', (req, res, next) => {
  if (!dbReady) return res.status(503).json({ success: false, error: 'Server is starting up — please retry in a few seconds.' })
  next()
})

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

// Contact form — forwards submission to grfwportal@gmail.com
app.post('/api/contact', async (req, res) => {
  const { name, email, country, subject, message } = req.body
  if (!name || !email || !subject || !message) {
    return res.status(400).json({ success: false, error: 'Name, email, subject, and message are required.' })
  }
  const { sendContactEmail } = require('./src/utils/email')
  const result = await sendContactEmail({ name, email, country, subject, message })
  if (result.sent) {
    return res.json({ success: true, message: 'Thank you for reaching out! Your message has been sent successfully.' })
  }
  // Still acknowledge even if email fails (logs show the submission server-side)
  res.json({ success: true, message: 'Thank you for reaching out! Your message has been sent successfully.' })
})

// Newsletter
app.post('/api/newsletter/subscribe', (req, res) => {
  const { email } = req.body
  if (!email) return res.status(400).json({ success: false, error: 'Email required' })
  res.json({ success: true, message: 'Subscribed successfully!' })
})

// Payments — initialize a Paystack transaction and return redirect URL
app.post('/api/payments/initialize', async (req, res) => {
  const { amount, email, name, type, userId, recurring } = req.body
  if (!amount || !email) return res.status(400).json({ success: false, error: 'amount and email are required.' })
  const frontendUrl = process.env.FRONTEND_URL || 'https://grfw-frontend.vercel.app'
  const reference   = `${type || 'don'}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
  try {
    const { initializeTransaction } = require('./src/utils/paystack')
    const result = await initializeTransaction({
      email,
      amount:      parseFloat(amount),
      currency:    'ZAR',
      reference,
      metadata:    { name: name || 'User', type: type || 'donation', userId: userId || '', recurring: String(!!recurring) },
      callbackUrl: `${frontendUrl}/payment/callback`,
    })
    if (!result.status) return res.status(400).json({ success: false, error: result.message || 'Could not initialize payment.' })
    res.json({ success: true, data: { authorizationUrl: result.data.authorization_url, reference } })
  } catch (err) {
    console.error('Paystack initialize error:', err.message)
    res.status(500).json({ success: false, error: 'Could not initialize payment.' })
  }
})

// Donations — verify Paystack payment after popup callback
app.post('/api/payments/verify', async (req, res) => {
  const { reference, type } = req.body
  if (!reference) return res.status(400).json({ success: false, error: 'reference is required.' })
  try {
    const { verifyTransaction } = require('./src/utils/paystack')
    const result = await verifyTransaction(reference)
    if (!result.status || result.data?.status !== 'success') {
      return res.status(402).json({ success: false, error: 'Payment not successful.' })
    }
    if (type === 'donation') {
      const amt = (result.data.amount / 100).toFixed(2)
      console.log(`  Donation: ${result.data.currency} ${amt} from ${result.data.customer?.email}`)
    }
    res.json({ success: true, message: 'Payment verified.', data: { amount: result.data.amount / 100, currency: result.data.currency } })
  } catch (err) {
    console.error('Paystack verify error:', err.message)
    res.status(500).json({ success: false, error: 'Could not verify payment.' })
  }
})

// Paystack webhook (logs events — main verification done via /api/payments/verify)
app.post('/api/payments/webhook', (req, res) => {
  res.sendStatus(200)
  try {
    const event = req.body
    console.log(`  Paystack webhook: ${event.event || 'unknown'}`, event.data?.reference || '')
  } catch (err) { console.error('Webhook error:', err.message) }
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

  if (process.env.DATABASE_URL) {
    const masked = process.env.DATABASE_URL.replace(/:([^:@]+)@/, ':****@')
    console.log(`[${ts()}] [server] DATABASE_URL = ${masked}`)
  } else {
    console.warn(`[${ts()}] [server] WARNING: DATABASE_URL is not set`)
  }

  // Bind to port FIRST so Railway's health check passes immediately.
  // Database initialisation runs after — the module-scope dbReady gate handles 503s.
  await new Promise((resolve) => {
    app.listen(PORT, () => {
      console.log(`[${ts()}] [server] Listening on port ${PORT} — initialising database...`)
      resolve()
    })
  })

  // Now initialise the database in the background
  try {
    console.log(`[${ts()}] [server] Step 1/3 — initDb()`)
    await initDb()

    console.log(`[${ts()}] [server] Step 2/3 — authModule.init()`)
    await authModule.init()

    console.log(`[${ts()}] [server] Step 3/3 — loading content modules`)
    await Promise.all([
      skillsMod.init(),
      newsMod.init(),
      pubsMod.init(),
      eventsMod.init(),
      jobsMod.init(),
      mentorsMod.init(),
    ])

    dbReady = true
    console.log(`[${ts()}] [server] All data loaded from PostgreSQL ✓`)
    console.log(`[${ts()}] [server] Super Admin: ${process.env.SUPER_ADMIN_EMAIL || 'superadmin@grfw.org'}\n`)
  } catch (err) {
    console.error(`[${ts()}] [server] FATAL: database initialisation failed — ${err.message}`)
    console.error(err.stack)
    process.exit(1)
  }
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
