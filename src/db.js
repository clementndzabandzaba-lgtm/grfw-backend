require('dotenv').config()
const { Pool } = require('pg')

const pool = new Pool({
  host:     process.env.DB_HOST     || 'pg8001.site4now.net',
  port:     parseInt(process.env.DB_PORT) || 6432,
  database: process.env.DB_NAME     || 'db_acb7e8_grfw',
  user:     process.env.DB_USER     || 'acb7e8_grfw',
  password: process.env.DB_PASSWORD || 'Grfw@2026!',
  max: 10,
})

pool.on('error', (err) => console.error('PostgreSQL pool error:', err.message))

module.exports = pool
