import crypto from 'node:crypto'
import { promisify } from 'node:util'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { config } from './config.js'
import { query } from './db.js'

const scrypt = promisify(crypto.scrypt)
const sessions = new Map<string, number>()
const attempts = new Map<string, { count: number; until: number }>()
const lifetime = 30 * 60 * 1000
const cookieOptions = { httpOnly: true, signed: true, sameSite: 'strict' as const, secure: config.sessionCookieSecure, path: '/api/v1', maxAge: lifetime / 1000 }

export async function initializeAdministrator() {
  await query(`CREATE TABLE IF NOT EXISTS system_administrator (id INTEGER PRIMARY KEY CHECK (id = 1), password_hash TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now())`)
}
async function passwordHash() {
  return (await query<{ password_hash: string }>('SELECT password_hash FROM system_administrator WHERE id = 1')).rows[0]?.password_hash
}
function sessionId(request: FastifyRequest) {
  const raw = request.cookies.pm_admin
  if (!raw) return undefined
  const unsigned = request.unsignCookie(raw)
  return unsigned.valid ? unsigned.value : undefined
}
function authenticated(request: FastifyRequest) {
  const id = sessionId(request)
  if (!id) return false
  if ((sessions.get(id) ?? 0) > Date.now()) return true
  sessions.delete(id)
  return false
}
function sameOrigin(request: FastifyRequest, reply: FastifyReply) {
  if (request.headers.origin && request.headers.origin !== config.corsOrigin) {
    reply.code(403).send({ message: '不允许跨站修改系统配置' })
    return false
  }
  return true
}
export function requireAdministrator(request: FastifyRequest, reply: FastifyReply) {
  if (!sameOrigin(request, reply)) return false
  if (authenticated(request)) return true
  reply.code(401).send({ message: '请先输入管理员密码解锁配置' })
  return false
}
function limitAttempts(request: FastifyRequest, reply: FastifyReply) {
  const now = Date.now()
  for (const [ip, attempt] of attempts) if (attempt.until <= now) attempts.delete(ip)
  const attempt = attempts.get(request.ip) ?? { count: 0, until: now + 15 * 60 * 1000 }
  if (attempt.count >= 10 || (!attempts.has(request.ip) && attempts.size >= 10000)) {
    reply.header('Retry-After', Math.max(1, Math.ceil((attempt.until - now) / 1000))).code(429).send({ message: '尝试次数过多，请 15 分钟后重试' })
    return false
  }
  attempt.count++
  attempts.set(request.ip, attempt)
  return true
}
function grantSession(request: FastifyRequest, reply: FastifyReply) {
  const now = Date.now()
  for (const [id, expiresAt] of sessions) if (expiresAt <= now) sessions.delete(id)
  const old = sessionId(request)
  if (old) sessions.delete(old)
  const id = crypto.randomBytes(32).toString('base64url')
  sessions.set(id, now + lifetime)
  attempts.delete(request.ip)
  reply.setCookie('pm_admin', id, cookieOptions)
  return { ok: true }
}
function passwordInput(body: unknown) {
  if (!body || typeof body !== 'object') return undefined
  const password = (body as Record<string, unknown>).password
  return typeof password === 'string' && password.length >= 8 && password.length <= 128 && password.trim().length >= 8 ? password : undefined
}

export function registerAdministratorRoutes(app: FastifyInstance) {
  app.get('/api/v1/admin/status', async (request, reply) => {
    reply.header('Cache-Control', 'no-store')
    return { initialized: Boolean(await passwordHash()), authenticated: authenticated(request) }
  })
  app.post('/api/v1/admin/setup', async (request, reply) => {
    reply.header('Cache-Control', 'no-store')
    if (!sameOrigin(request, reply) || !limitAttempts(request, reply)) return
    if (await passwordHash()) return reply.code(409).send({ message: '管理员密码已经设置，请使用现有密码登录' })
    const password = passwordInput(request.body)
    if (!password) return reply.code(400).send({ message: '请设置 8～128 位密码（不能仅包含空格），建议混合字母、数字和符号' })
    const salt = crypto.randomBytes(16).toString('hex')
    const hash = (await scrypt(password, salt, 64)) as Buffer
    const stored = `scrypt:${salt}:${hash.toString('hex')}`
    // 单行唯一键保证并发初始化只有一个请求能成功，不允许覆盖旧密码。
    const result = await query('INSERT INTO system_administrator (id, password_hash) VALUES (1, $1) ON CONFLICT (id) DO NOTHING RETURNING id', [stored])
    if (!result.rows.length) return reply.code(409).send({ message: '管理员密码已由其他请求设置，请刷新后登录' })
    return grantSession(request, reply)
  })
  app.post('/api/v1/admin/login', async (request, reply) => {
    reply.header('Cache-Control', 'no-store')
    if (!sameOrigin(request, reply) || !limitAttempts(request, reply)) return
    const password = passwordInput(request.body)
    const stored = await passwordHash()
    if (!stored || !password) return reply.code(401).send({ message: '管理员密码错误或尚未初始化' })
    const [, salt, expected] = stored.split(':')
    const hash = (await scrypt(password, salt, 64)) as Buffer
    const expectedHash = Buffer.from(expected, 'hex')
    if (hash.length !== expectedHash.length || !crypto.timingSafeEqual(hash, expectedHash)) return reply.code(401).send({ message: '管理员密码错误' })
    return grantSession(request, reply)
  })
  app.post('/api/v1/admin/logout', async (request, reply) => {
    reply.header('Cache-Control', 'no-store')
    if (!sameOrigin(request, reply)) return
    const id = sessionId(request)
    if (id) sessions.delete(id)
    return reply.clearCookie('pm_admin', { path: '/api/v1', sameSite: 'strict', secure: config.sessionCookieSecure, httpOnly: true }).send({ ok: true })
  })
}
