const pool = require('../db')

function createRepo(table) {
  return {
    async loadAll() {
      const { rows } = await pool.query(`SELECT data FROM "${table}"`)
      return rows.map((r) => JSON.parse(r.data))
    },
    async insert(obj) {
      await pool.query(
        `INSERT INTO "${table}" (id, data) VALUES ($1, $2) ON CONFLICT (id) DO UPDATE SET data = $2`,
        [obj.id, JSON.stringify(obj)]
      )
    },
    async update(obj) {
      await pool.query(`UPDATE "${table}" SET data = $1 WHERE id = $2`, [JSON.stringify(obj), obj.id])
    },
    async remove(id) {
      await pool.query(`DELETE FROM "${table}" WHERE id = $1`, [id])
    },
  }
}

module.exports = { createRepo }
