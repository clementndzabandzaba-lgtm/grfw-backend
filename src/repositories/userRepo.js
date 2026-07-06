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

// $1–$16 unchanged; $17 = widowhoodCategory, $18 = registrationFeePaid
function userToParams(u) {
  return [
    u.id,
    u.name,
    u.email,
    u.role,
    u.password,
    u.country               || null,
    u.isVerified            ? 1 : 0,
    u.status,
    u.avatar                || null,
    JSON.stringify(u.profile || {}),
    u.isSubscribed          ? 1 : 0,
    u.subscriptionPlan      || null,
    u.subscriptionExpiry    || null,
    u.rejectionReason       || null,
    u.createdAt,
    u.updatedAt             || u.createdAt,
    u.widowhoodCategory     || null,
    u.registrationFeePaid   ? 1 : 0,
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
    userToParams(user)
  )
}

async function update(user) {
  const updatedAt = new Date().toISOString()
  await pool.query(
    `UPDATE users SET
       name=$2, email=$3, role=$4, password=$5, country=$6,
       "isVerified"=$7, status=$8, avatar=$9, profile=$10,
       "isSubscribed"=$11, "subscriptionPlan"=$12, "subscriptionExpiry"=$13,
       "rejectionReason"=$14, "updatedAt"=$16,
       "widowhoodCategory"=$17, "registrationFeePaid"=$18
     WHERE id=$1`,
    userToParams({ ...user, updatedAt })
  )
}

async function remove(id) {
  await pool.query('DELETE FROM users WHERE id = $1', [id])
}

module.exports = { loadAll, insert, update, remove }
