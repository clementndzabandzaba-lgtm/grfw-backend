const pool = require('./db')

async function initDb() {
  // Check if users table has the correct schema (name column)
  const { rows: colCheck } = await pool.query(`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'name'
  `)

  if (colCheck.length === 0) {
    // Table exists with wrong schema (id + data only) — drop and recreate
    await pool.query('DROP TABLE IF EXISTS users CASCADE')
  }

  // Users table with dedicated columns
  await pool.query(`
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
  `)

  // Content tables — simple id + JSON blob
  const contentTables = ['skills', 'news', 'publications', 'events', 'jobs', 'mentors', 'audit_logs']
  for (const table of contentTables) {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS "${table}" (
        id   TEXT PRIMARY KEY,
        data TEXT NOT NULL
      )
    `)
  }

  console.log('  Database tables ready ✓')
}

module.exports = initDb
