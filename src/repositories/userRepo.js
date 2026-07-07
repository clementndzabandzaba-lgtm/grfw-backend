const pool = require('../db')

function rowToUser(row) {
  if (!row) return null
  return {
    ...row,
    isVerified:          !!(row.isVerified          ?? row.isverified          ?? 0),
    isSubscribed:        !!(row.isSubscribed        ?? row.issubscribed        ?? 0),
    registrationFeePaid: !!(row.registrationFeePaid ?? row.registrationfeepaid ?? 0),
    profile: row.profile
      ? (typeof row.profile === 'string' ? JSON.parse(row.profile) : row.profile)
      : {},
  }
}

// INSERT params — 18 values including createdAt ($15) and updatedAt ($16)
function insertParams(u) {
  return [
    u.id, u.name, u.email, u.role, u.password,
    u.country             || null,
    u.isVerified          ? 1 : 0,
    u.status,
    u.avatar              || null,
    JSON.stringify(u.profile || {}),
    u.isSubscribed        ? 1 : 0,
    u.subscriptionPlan    || null,
    u.subscriptionExpiry  || null,
    u.rejectionReason     || null,
    u.createdAt,                      // $15
    u.updatedAt           || u.createdAt, // $16
    u.widowhoodCategory   || null,    // $17
    u.registrationFeePaid ? 1 : 0,    // $18
  ]
}

// UPDATE params — 17 values, no gap (createdAt is never updated)
// $1=id  $2=name … $14=rejectionReason  $15=updatedAt  $16=widowhoodCategory  $17=registrationFeePaid
function updateParams(u, updatedAt) {
  return [
    u.id, u.name, u.email, u.role, u.password,
    u.country             || null,
    u.isVerified          ? 1 : 0,
    u.status,
    u.avatar              || null,
    JSON.stringify(u.profile || {}),
    u.isSubscribed        ? 1 : 0,
    u.subscriptionPlan    || null,
    u.subscriptionExpiry  || null,
    u.rejectionReason     || null,
    updatedAt,                        // $15
    u.widowhoodCategory   || null,    // $16
    u.registrationFeePaid ? 1 : 0,    // $17
  ]
}

async function loadAll() {
  const { rows } = await pool.query('SELECT * FROM users')
  return rows.map(rowToUser)
}

async function insert(user) {
  await pool.query(
    `INSERT INTO users
       (id, name, email, role, password, country,
        "isVerified", status, avatar, profile,
        "isSubscribed", "subscriptionPlan", "subscriptionExpiry", "rejectionReason",
        "createdAt", "updatedAt", "widowhoodCategory", "registrationFeePaid")
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
     ON CONFLICT (id) DO NOTHING`,
    insertParams(user)
  )
}

async function update(user) {
  const updatedAt = new Date().toISOString()
  await pool.query(
    `UPDATE users SET
       name=$2, email=$3, role=$4, password=$5, country=$6,
       "isVerified"=$7, status=$8, avatar=$9, profile=$10,
       "isSubscribed"=$11, "subscriptionPlan"=$12, "subscriptionExpiry"=$13,
       "rejectionReason"=$14, "updatedAt"=$15,
       "widowhoodCategory"=$16, "registrationFeePaid"=$17
     WHERE id=$1`,
    updateParams(user, updatedAt)
  )
}

async function remove(id) {
  await pool.query('DELETE FROM users WHERE id = $1', [id])
}

module.exports = { loadAll, insert, update, remove }
