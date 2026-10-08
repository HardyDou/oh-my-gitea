import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { readFile } from 'node:fs/promises'
import net from 'node:net'
import test from 'node:test'
import pg from 'pg'

// 仅显式指定测试数据库时运行；所有测试表放入独立临时 schema，结束后删除。
test('Gitea 页面配置：鉴权、加密持久化、重启、实例保护', { skip: !process.env.TEST_DATABASE_URL, timeout: 40000 }, async (t) => {
  const schema = `pm_test_${crypto.randomBytes(8).toString('hex')}`
  const connection = new URL(process.env.TEST_DATABASE_URL)
  connection.searchParams.set('options', `-c search_path=${schema}`)
  const db = new pg.Client({ connectionString: connection.toString() })
  await db.connect()
  let server
  const stop = async () => {
    if (server && server.exitCode === null && server.signalCode === null) {
      const exited = once(server, 'exit')
      server.kill('SIGTERM')
      await exited
    }
  }
  t.after(async () => {
    await stop()
    await db.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`)
    await db.end()
  })
  await db.query(`CREATE SCHEMA ${schema}`)
  for (const file of ['001_init.sql', '002_stage_config.sql', '003_system_settings.sql']) {
    await db.query(await readFile(new URL(`../db/${file}`, import.meta.url), 'utf8'))
  }
  const socket = net.createServer()
  socket.listen(0, '127.0.0.1')
  await once(socket, 'listening')
  const port = socket.address().port
  await new Promise((resolve) => socket.close(resolve))
  const base = `http://127.0.0.1:${port}`
  const adminToken = crypto.randomBytes(32).toString('hex')
  const sessionSecret = crypto.randomBytes(32).toString('hex')
  const start = async () => {
    server = spawn(process.execPath, ['dist/server.js'], {
      env: { ...process.env, DATABASE_URL: connection.toString(), PORT: String(port), NODE_ENV: 'production', SESSION_SECRET: sessionSecret, SYSTEM_CONFIG_TOKEN: adminToken, GITEA_BASE_URL: '', GITEA_CLIENT_ID: '', GITEA_CLIENT_SECRET: '', GITEA_WEBHOOK_SECRET: '', CORS_ORIGIN: base, GITEA_REDIRECT_URI: `${base}/auth/gitea/callback` },
      stdio: ['ignore', 'ignore', 'ignore'],
    })
    for (let attempt = 0; attempt < 100; attempt++) {
      if (server.exitCode !== null) throw new Error('测试后端启动失败')
      try { if ((await fetch(`${base}/health`)).ok) return } catch {}
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    throw new Error('测试后端启动超时')
  }
  const call = (path, method = 'GET', token, body) => fetch(`${base}${path}`, { method, headers: { 'Content-Type': 'application/json', ...(token ? { 'X-System-Config-Token': token } : {}) }, body: body ? JSON.stringify(body) : undefined, redirect: 'manual' })
  const endpoint = '/api/v1/config/gitea'
  await start()
  assert.deepEqual(await (await call('/api/v1/setup/status')).json(), { configured: false })
  assert.equal((await call('/auth/gitea')).status, 503)
  assert.equal((await call('/webhooks/gitea', 'POST', undefined, {})).status, 401)
  assert.equal((await call(endpoint)).status, 403)
  assert.equal((await call(endpoint, 'PUT', 'invalid', {})).status, 403)
  const empty = await call(endpoint, 'GET', adminToken)
  assert.equal(empty.headers.get('cache-control'), 'no-store')
  assert.equal((await empty.json()).hasClientSecret, false)
  const settings = { baseUrl: 'https://gitea.example.com/', clientId: 'test-client', clientSecret: 'test-oauth-secret', webhookSecret: 'test-webhook-secret' }
  for (const baseUrl of ['file:///etc/passwd', 'https://user:password@example.com', 'https://example.com/?key=secret']) {
    assert.equal((await call(endpoint, 'PUT', adminToken, { ...settings, baseUrl })).status, 400)
  }
  const saved = await call(endpoint, 'PUT', adminToken, settings)
  assert.equal(saved.status, 200)
  const visible = await saved.json()
  assert.equal(visible.baseUrl, 'https://gitea.example.com')
  assert.equal(visible.hasClientSecret, true)
  assert.equal(visible.hasWebhookSecret, true)
  assert.equal(visible.clientSecret, undefined)
  assert.equal(visible.webhookSecret, undefined)
  const encrypted = (await db.query('SELECT encrypted_value FROM system_settings')).rows[0].encrypted_value
  assert.equal(encrypted.includes(settings.clientSecret), false)
  const [iv, tag, ciphertext] = encrypted.split('.').map((value) => Buffer.from(value, 'base64'))
  const key = crypto.createHash('sha256').update(`gitea-settings:${sessionSecret}`).digest()
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(tag)
  assert.equal(JSON.parse(Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString()).clientSecret, settings.clientSecret)
  const audit = JSON.stringify((await db.query('SELECT payload FROM audit_log')).rows)
  assert.equal(audit.includes(settings.clientSecret), false)
  assert.equal(audit.includes(settings.webhookSecret), false)
  await stop()
  await start()
  assert.deepEqual(await (await call('/api/v1/setup/status')).json(), { configured: true })
  const login = await call('/auth/gitea')
  assert.equal(login.status, 302)
  const location = new URL(login.headers.get('location'))
  assert.equal(location.origin, 'https://gitea.example.com')
  assert.equal(location.searchParams.get('client_id'), settings.clientId)
  assert.equal(location.searchParams.get('redirect_uri'), `${base}/auth/gitea/callback`)
  const keepSecrets = await call(endpoint, 'PUT', adminToken, { ...settings, clientSecret: '', webhookSecret: '' })
  assert.equal(keepSecrets.status, 200)
  assert.equal((await keepSecrets.json()).hasClientSecret, true)
  // 保存配置后，先前的 OAuth state 作废。
  assert.equal((await call(`/auth/gitea/callback?code=test&state=${location.searchParams.get('state')}`)).status, 400)
  await db.query("INSERT INTO app_user (gitea_user_id, login) VALUES (1, 'test')")
  const switchInstance = await call(endpoint, 'PUT', adminToken, { ...settings, baseUrl: 'https://other.example.com' })
  assert.equal(switchInstance.status, 400)
  assert.equal((await call(endpoint, 'GET', adminToken)).status, 200)
})
