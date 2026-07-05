require('dotenv').config()
const { Pool } = require('pg')

const usingConnectionString = Boolean(process.env.DATABASE_URL)

if (usingConnectionString) {
  const masked = process.env.DATABASE_URL.replace(/:([^:@]+)@/, ':****@')
  console.log(`[db] Pool config: connectionString=${masked} ssl=true`)
} else {
  console.log(
    `[db] Pool config: host=${process.env.DB_HOST || 'localhost'} ` +
    `port=${process.env.DB_PORT || 5432} ` +
    `database=${process.env.DB_NAME || 'grfw'} ` +
    `user=${process.env.DB_USER || 'postgres'}`
  )
}

const pool = new Pool(
  usingConnectionString
    ? {
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false },
        connectionTimeoutMillis: 10000,
        idleTimeoutMillis: 30000,
      }
    : {
        host:     process.env.DB_HOST     || 'localhost',
        port:     parseInt(process.env.DB_PORT) || 5432,
        database: process.env.DB_NAME     || 'grfw',
        user:     process.env.DB_USER     || 'postgres',
        password: process.env.DB_PASSWORD || '',
        max: 10,
        connectionTimeoutMillis: 10000,
        idleTimeoutMillis: 30000,
      }
)

pool.on('connect', () => console.log('[db] New client connected to PostgreSQL pool'))
pool.on('error', (err) => console.error('[db] PostgreSQL pool error:', err.message, err.stack))

module.exports = pool
