// Shared in-memory audit log — records key admin/super-admin actions across the system.
const auditLog = []

function logAction({ actorName, actorId, actorRole, action, target, risk = 'low' }) {
  auditLog.unshift({
    id: 'AUD-' + String(auditLog.length + 1).padStart(4, '0'),
    actor: actorName,
    actorId,
    actorRole,
    action,
    target,
    risk, // 'low' | 'medium' | 'high'
    timestamp: new Date().toISOString(),
  })
  if (auditLog.length > 500) auditLog.length = 500
}

module.exports = { auditLog, logAction }
