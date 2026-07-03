const router = require('express').Router()
const { requireAuth } = require('../middleware/auth')

const courses = [
  { id: '1', title: 'Digital Skills for the Modern Workforce', provider: 'GRFW Academy', category: 'digital', duration: '8 weeks', level: 'beginner', cost: 0, isFree: true, deliveryMode: 'online', accredited: true, description: 'Master essential digital tools for the modern workforce.', instructorName: 'Chiamaka Nwosu', rating: 4.9, enrolledCount: 1240, createdAt: '2025-01-10T00:00:00Z' },
  { id: '2', title: 'Starting & Running Your Own Business', provider: 'GRFW x Strathmore', category: 'business', duration: '12 weeks', level: 'intermediate', cost: 49, isFree: false, deliveryMode: 'hybrid', accredited: true, description: 'From idea to launch: complete business programme.', instructorName: 'Dr. Naomi Okafor', rating: 4.8, enrolledCount: 890, createdAt: '2025-02-01T00:00:00Z' },
  { id: '3', title: 'Understanding Your Legal Rights as a Widow', provider: 'GRFW Legal Network', category: 'legal', duration: '4 weeks', level: 'beginner', cost: 0, isFree: true, deliveryMode: 'online', accredited: false, description: 'Know your inheritance, property, and custody rights.', instructorName: 'Adv. Nathalie Kone', rating: 4.95, enrolledCount: 2100, createdAt: '2024-11-15T00:00:00Z' },
]

const enrolments = []

router.get('/', (req, res) => {
  const { category, level, mode, free } = req.query
  let result = [...courses]
  if (category && category !== 'all') result = result.filter((c) => c.category === category)
  if (level    && level    !== 'all') result = result.filter((c) => c.level === level)
  if (mode     && mode     !== 'all') result = result.filter((c) => c.deliveryMode === mode)
  if (free === 'true') result = result.filter((c) => c.isFree)
  res.json({ success: true, data: result, pagination: { total: result.length, page: 1, totalPages: 1 } })
})

router.get('/my/enrolments', requireAuth, (req, res) => {
  const userEnrolments = enrolments.filter((e) => e.userId === req.user.id)
  res.json({ success: true, data: userEnrolments })
})

router.get('/:id', (req, res) => {
  const course = courses.find((c) => c.id === req.params.id)
  if (!course) return res.status(404).json({ success: false, error: 'Course not found' })
  res.json({ success: true, data: course })
})

router.post('/:id/enrol', requireAuth, (req, res) => {
  const course = courses.find((c) => c.id === req.params.id)
  if (!course) return res.status(404).json({ success: false, error: 'Course not found' })
  const existing = enrolments.find((e) => e.userId === req.user.id && e.courseId === req.params.id)
  if (existing) return res.status(409).json({ success: false, error: 'Already enrolled' })
  const enrolment = { id: Date.now().toString(), userId: req.user.id, courseId: req.params.id, progress: 0, createdAt: new Date().toISOString() }
  enrolments.push(enrolment)
  res.status(201).json({ success: true, data: enrolment, message: 'Enrolled successfully!' })
})

module.exports = router
