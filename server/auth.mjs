/**
 * Email accounts for MONOCHROME.
 *
 * This is a local, single-file account store: each user has an email, a salted
 * scrypt password hash, and their own library (likes, playlists, history).
 * Nothing leaves the machine — the same JSON file the audio proxy already runs
 * beside. It is deliberately dependency-free so `npm run dev` needs no database.
 */
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), '.data')
const DB_PATH = join(DATA_DIR, 'accounts.json')

const SCRYPT_KEYLEN = 64
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 90 // 90 days

/** @typedef {{ id: string, email: string, name: string, hash: string, salt: string, createdAt: number }} User */

function load() {
  try {
    const raw = JSON.parse(readFileSync(DB_PATH, 'utf8'))
    return {
      users: Array.isArray(raw.users) ? raw.users : [],
      sessions: raw.sessions && typeof raw.sessions === 'object' ? raw.sessions : {},
      libraries: raw.libraries && typeof raw.libraries === 'object' ? raw.libraries : {},
    }
  } catch {
    return { users: [], sessions: {}, libraries: {} }
  }
}

let db = load()

/** Write atomically: a crash mid-write must not truncate the account file. */
function save() {
  mkdirSync(DATA_DIR, { recursive: true })
  const tmp = `${DB_PATH}.${process.pid}.tmp`
  writeFileSync(tmp, JSON.stringify(db, null, 2))
  renameSync(tmp, DB_PATH)
}

function hashPassword(password, salt = randomBytes(16).toString('hex')) {
  const hash = scryptSync(password, salt, SCRYPT_KEYLEN).toString('hex')
  return { salt, hash }
}

function verifyPassword(password, salt, expected) {
  const actual = scryptSync(password, salt, SCRYPT_KEYLEN)
  const want = Buffer.from(expected, 'hex')
  return actual.length === want.length && timingSafeEqual(actual, want)
}

export function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase()
}

export function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

/** Public shape of a user — never expose the hash or salt. */
export function publicUser(user) {
  return { id: user.id, email: user.email, name: user.name, createdAt: user.createdAt }
}

function newSession(userId) {
  const token = randomBytes(32).toString('hex')
  db.sessions[token] = { userId, expiresAt: Date.now() + SESSION_TTL_MS }
  save()
  return token
}

function findUserByEmail(email) {
  return db.users.find((u) => u.email === normalizeEmail(email)) || null
}

export function register({ email, password, name }) {
  const clean = normalizeEmail(email)
  if (!isValidEmail(clean)) return { error: 'Введите корректный адрес почты' }
  if (String(password || '').length < 6) return { error: 'Пароль должен быть не короче 6 символов' }
  if (findUserByEmail(clean)) return { error: 'Аккаунт с такой почтой уже существует' }

  const { salt, hash } = hashPassword(password)
  /** @type {User} */
  const user = {
    id: `u-${Date.now()}-${randomBytes(4).toString('hex')}`,
    email: clean,
    name: String(name || '').trim() || clean.split('@')[0],
    salt,
    hash,
    createdAt: Date.now(),
  }
  db.users.push(user)
  const token = newSession(user.id)
  return { token, user: publicUser(user) }
}

export function login({ email, password }) {
  const user = findUserByEmail(email)
  // Same message for "no such user" and "wrong password": don't leak which
  // emails are registered.
  const invalid = { error: 'Неверная почта или пароль' }
  if (!user) return invalid
  if (!verifyPassword(String(password || ''), user.salt, user.hash)) return invalid
  return { token: newSession(user.id), user: publicUser(user) }
}

export function logout(token) {
  if (token && db.sessions[token]) {
    delete db.sessions[token]
    save()
  }
  return { ok: true }
}

/** Resolve a bearer token to a user, pruning the session if it expired. */
export function userForToken(token) {
  const session = token ? db.sessions[token] : null
  if (!session) return null
  if (session.expiresAt < Date.now()) {
    delete db.sessions[token]
    save()
    return null
  }
  return db.users.find((u) => u.id === session.userId) || null
}

export function getLibrary(userId) {
  return db.libraries[userId] || { liked: [], playlists: [], recentlyPlayed: [] }
}

export function setLibrary(userId, library) {
  db.libraries[userId] = {
    liked: Array.isArray(library?.liked) ? library.liked : [],
    playlists: Array.isArray(library?.playlists) ? library.playlists : [],
    recentlyPlayed: Array.isArray(library?.recentlyPlayed) ? library.recentlyPlayed : [],
  }
  save()
  return db.libraries[userId]
}
