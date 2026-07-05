const pool = require('./db')

function ts() {
  return new Date().toISOString()
}

async function initDb() {
  console.log(`[${ts()}] [initDb] Starting database initialisation`)

  // ── Schema check: does the users table have the 'name' column? ────────────
  const schemaQuery = `
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'name'
  `
  console.log(`[${ts()}] [initDb] Checking users table schema (looking for 'name' column)`)
  let colCheck
  try {
    const result = await pool.query(schemaQuery)
    colCheck = result.rows
    console.log(`[${ts()}] [initDb] Schema check result: ${colCheck.length} row(s) returned`)
  } catch (err) {
    console.error(`[${ts()}] [initDb] ERROR during schema check query`)
    console.error(`[${ts()}] [initDb] Query: ${schemaQuery.trim()}`)
    console.error(`[${ts()}] [initDb] ${err.message}`)
    console.error(err.stack)
    throw err
  }

  if (colCheck.length === 0) {
    // Table exists with wrong schema (id + data only) — drop and recreate
    console.log(`[${ts()}] [initDb] 'name' column missing — dropping users table for recreation`)
    try {
      await pool.query('DROP TABLE IF EXISTS users CASCADE')
      console.log(`[${ts()}] [initDb] users table dropped`)
    } catch (err) {
      console.error(`[${ts()}] [initDb] ERROR dropping users table: ${err.message}`)
      console.error(err.stack)
      throw err
    }
  }

  // ── Users table ───────────────────────────────────────────────────────────
  const createUsersSQL = `
    CREATE TABLE IF NOT EXISTS users (
      id                   TEXT PRIMARY KEY,
      name                 TEXT NOT NULL,
      email                TEXT NOT NULL,
      role                 TEXT NOT NULL DEFAULT 'member',
      password             TEXT NOT NULL,
      country              TEXT,
      "isVerified"         INTEGER NOT NULL DEFAULT 0,
      status               TEXT NOT NULL DEFAULT 'pending',
      avatar               TEXT,
      profile              TEXT,
      "isSubscribed"       INTEGER NOT NULL DEFAULT 0,
      "subscriptionPlan"   TEXT,
      "subscriptionExpiry" TEXT,
      "rejectionReason"    TEXT,
      "createdAt"          TEXT NOT NULL,
      "updatedAt"          TEXT
    )
  `
  console.log(`[${ts()}] [initDb] Creating users table (if not exists)`)
  try {
    await pool.query(createUsersSQL)
    console.log(`[${ts()}] [initDb] users table ready`)
  } catch (err) {
    console.error(`[${ts()}] [initDb] ERROR creating users table: ${err.message}`)
    console.error(err.stack)
    throw err
  }

  // ── Content tables — simple id + JSON blob ────────────────────────────────
  const contentTables = ['skills', 'news', 'publications', 'events', 'jobs', 'mentors', 'audit_logs', 'approved_mentors', 'mentor_applications']
  for (const table of contentTables) {
    const sql = `
      CREATE TABLE IF NOT EXISTS "${table}" (
        id   TEXT PRIMARY KEY,
        data TEXT NOT NULL
      )
    `
    console.log(`[${ts()}] [initDb] Creating table '${table}' (if not exists)`)
    try {
      await pool.query(sql)
      console.log(`[${ts()}] [initDb] '${table}' table ready`)
    } catch (err) {
      console.error(`[${ts()}] [initDb] ERROR creating '${table}' table: ${err.message}`)
      console.error(`[${ts()}] [initDb] Query: ${sql.trim()}`)
      console.error(err.stack)
      throw err
    }
  }

  console.log(`[${ts()}] [initDb] All database tables ready ✓`)
}

module.exports = initDb
