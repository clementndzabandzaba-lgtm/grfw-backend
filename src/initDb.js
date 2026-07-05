const pool = require('./db')

const TABLES = [
  'users',
  'skills',
  'news',
  'publications',
  'events',
  'jobs',
  'mentors',
  'audit_logs',
]

async function initDb() {
  for (const table of TABLES) {
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
