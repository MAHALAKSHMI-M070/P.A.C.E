require('dotenv').config()

const crypto = require('node:crypto')
const express = require('express')
const cors = require('cors')
const mongoose = require('mongoose')

const app = express()
const port = Number(process.env.PORT || 5000)
const sessionDays = Number(process.env.SESSION_DAYS || 7)

const allowedOrigins = [...new Set([
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'https://pacetodo.vercel.app',
  ...(process.env.CLIENT_URL || '').split(','),
].map((origin) => origin.trim()).filter(Boolean))]
app.use(cors({ origin: (requestOrigin, callback) => {
  const isLocalOrigin = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(requestOrigin || '')
  if (!requestOrigin || allowedOrigins.includes(requestOrigin) || isLocalOrigin) return callback(null, true)
  return callback(new Error('Origin is not allowed by CORS'))
} }))
app.use(express.json())

const userSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  passwordHash: { type: String, required: true },
  passwordSalt: { type: String, required: true },
  streak: { type: Number, default: 0 },
  streakFreezeAvailable: { type: Boolean, default: true },
  lastActiveDate: { type: String, default: '' },
}, { timestamps: true })

const taskSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  title: { type: String, required: true, trim: true, maxlength: 200 },
  category: { type: String, enum: ['Work', 'Personal', 'Ideas'], default: 'Personal' },
  due: { type: String, default: 'Today' },
  completed: { type: Boolean, default: false },
}, { timestamps: true })

const sessionSchema = new mongoose.Schema({
  tokenHash: { type: String, required: true, unique: true, index: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  expiresAt: { type: Date, required: true, index: { expires: 0 } },
}, { timestamps: true })

const User = mongoose.model('User', userSchema)
const Task = mongoose.model('Task', taskSchema)
const Session = mongoose.model('Session', sessionSchema)

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.pbkdf2Sync(password, salt, 120000, 64, 'sha512').toString('hex')
  return { hash, salt }
}

function createToken() {
  return crypto.randomBytes(32).toString('hex')
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex')
}

function publicUser(user) {
  return { id: user._id, name: user.name, email: user.email, streak: user.streak, streakFreezeAvailable: user.streakFreezeAvailable }
}

async function requireAuth(req, res, next) {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '')
    if (!token) return res.status(401).json({ message: 'Authentication required.' })
    const session = await Session.findOne({ tokenHash: hashToken(token), expiresAt: { $gt: new Date() } })
    if (!session) return res.status(401).json({ message: 'Session expired. Please log in again.' })
    req.user = await User.findById(session.userId)
    if (!req.user) return res.status(401).json({ message: 'User not found.' })
    next()
  } catch (error) { next(error) }
}

async function createSession(userId) {
  const token = createToken()
  await Session.create({ tokenHash: hashToken(token), userId, expiresAt: new Date(Date.now() + sessionDays * 86400000) })
  return token
}

app.get('/api/health', (req, res) => res.json({
  ok: mongoose.connection.readyState === 1,
  service: 'pace-api',
  database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
}))

app.post('/api/auth/register', async (req, res, next) => {
  try {
    const { name, email, password } = req.body
    if (!name?.trim() || !email?.trim() || !password || password.length < 6) return res.status(400).json({ message: 'Name, email, and a password of at least 6 characters are required.' })
    const normalizedEmail = email.trim().toLowerCase()
    if (await User.exists({ email: normalizedEmail })) return res.status(409).json({ message: 'An account with that email already exists.' })
    const credentials = hashPassword(password)
    const user = await User.create({ name: name.trim(), email: normalizedEmail, passwordHash: credentials.hash, passwordSalt: credentials.salt })
    const token = await createSession(user._id)
    res.status(201).json({ token, user: publicUser(user) })
  } catch (error) { next(error) }
})

app.post('/api/auth/login', async (req, res, next) => {
  try {
    const user = await User.findOne({ email: req.body.email?.trim().toLowerCase() })
    const attempted = user && hashPassword(req.body.password || '', user.passwordSalt).hash
    if (!user || attempted !== user.passwordHash) return res.status(401).json({ message: 'Invalid email or password.' })
    const token = await createSession(user._id)
    res.json({ token, user: publicUser(user) })
  } catch (error) { next(error) }
})

app.post('/api/auth/logout', requireAuth, async (req, res, next) => {
  try {
    await Session.deleteOne({ tokenHash: hashToken(req.headers.authorization.replace('Bearer ', '')) })
    res.status(204).end()
  } catch (error) { next(error) }
})

app.get('/api/me', requireAuth, (req, res) => res.json({ user: publicUser(req.user) }))

app.patch('/api/me', requireAuth, async (req, res, next) => {
  try {
    const updates = {}
    if (typeof req.body.name === 'string' && req.body.name.trim()) updates.name = req.body.name.trim()
    if (typeof req.body.email === 'string' && req.body.email.trim()) updates.email = req.body.email.trim().toLowerCase()
    const user = await User.findByIdAndUpdate(req.user._id, updates, { new: true, runValidators: true })
    res.json({ user: publicUser(user) })
  } catch (error) { next(error) }
})

app.get('/api/tasks', requireAuth, async (req, res, next) => {
  try {
    const query = { userId: req.user._id }
    if (req.query.completed === 'true' || req.query.completed === 'false') query.completed = req.query.completed === 'true'
    if (req.query.search) query.title = { $regex: req.query.search, $options: 'i' }
    res.json({ tasks: await Task.find(query).sort({ createdAt: -1 }) })
  } catch (error) { next(error) }
})

app.post('/api/tasks', requireAuth, async (req, res, next) => {
  try {
    if (!req.body.title?.trim()) return res.status(400).json({ message: 'Task title is required.' })
    const task = await Task.create({ userId: req.user._id, title: req.body.title, category: req.body.category, due: req.body.due })
    res.status(201).json({ task })
  } catch (error) { next(error) }
})

app.patch('/api/tasks/:id', requireAuth, async (req, res, next) => {
  try {
    const allowed = ['title', 'category', 'due', 'completed']
    const updates = Object.fromEntries(Object.entries(req.body).filter(([key]) => allowed.includes(key)))
    const task = await Task.findOneAndUpdate({ _id: req.params.id, userId: req.user._id }, updates, { new: true, runValidators: true })
    if (!task) return res.status(404).json({ message: 'Task not found.' })
    res.json({ task })
  } catch (error) { next(error) }
})

app.delete('/api/tasks/:id', requireAuth, async (req, res, next) => {
  try {
    const result = await Task.deleteOne({ _id: req.params.id, userId: req.user._id })
    if (!result.deletedCount) return res.status(404).json({ message: 'Task not found.' })
    res.status(204).end()
  } catch (error) { next(error) }
})

app.get('/api/dashboard', requireAuth, async (req, res, next) => {
  try {
    const [total, completed] = await Promise.all([Task.countDocuments({ userId: req.user._id }), Task.countDocuments({ userId: req.user._id, completed: true })])
    res.json({ total, completed, active: total - completed, streak: req.user.streak, streakFreezeAvailable: req.user.streakFreezeAvailable, badges: ['First step', 'On a roll'] })
  } catch (error) { next(error) }
})

app.post('/api/dashboard/streak-freeze', requireAuth, async (req, res, next) => {
  try {
    if (!req.user.streakFreezeAvailable) return res.status(409).json({ message: 'No Streak Freeze is available.' })
    req.user.streakFreezeAvailable = false
    await req.user.save()
    res.json({ streakFreezeAvailable: false })
  } catch (error) { next(error) }
})

app.use((error, req, res, next) => {
  if (error.code === 11000) return res.status(409).json({ message: 'That value is already in use.' })
  console.error(error)
  res.status(500).json({ message: 'Something went wrong on the server.' })
})

async function start() {
  await mongoose.connect(process.env.MONGODB_URI)
  app.listen(port, () => console.log(`P.A.C.E. API running at ${process.env.SERVER_URL || `http://localhost:${port}`}`))
}

if (require.main === module) start().catch((error) => { console.error('MongoDB connection failed:', error.message); process.exit(1) })

module.exports = app
