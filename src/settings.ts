import crypto from 'node:crypto'
import { config } from './config.js'
import { query, withTransaction } from './db.js'

export type GiteaSettings = { baseUrl: string; clientId: string; clientSecret: string; webhookSecret: string }
const encryptionKey = () => crypto.createHash('sha256').update(`gitea-settings:${config.sessionSecret}`).digest()

function encrypt(value: GiteaSettings) {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv)
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()])
  return [iv, cipher.getAuthTag(), ciphertext].map((part) => part.toString('base64')).join('.')
}
function decrypt(value: string): GiteaSettings {
  const [iv, tag, ciphertext] = value.split('.').map((part) => Buffer.from(part, 'base64'))
  const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), iv)
  decipher.setAuthTag(tag)
  return JSON.parse(Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8'))
}
function apply(value: GiteaSettings) {
  config.giteaBaseUrl = value.baseUrl
  config.giteaClientId = value.clientId
  config.giteaClientSecret = value.clientSecret
  config.giteaWebhookSecret = value.webhookSecret
}
function current(): GiteaSettings {
  return { baseUrl: config.giteaBaseUrl, clientId: config.giteaClientId, clientSecret: config.giteaClientSecret, webhookSecret: config.giteaWebhookSecret }
}
export const giteaConfigured = () => Boolean(config.giteaBaseUrl && config.giteaClientId)
export function publicGiteaSettings() {
  const value = current()
  return { baseUrl: value.baseUrl, clientId: value.clientId, hasClientSecret: Boolean(value.clientSecret), hasWebhookSecret: Boolean(value.webhookSecret), redirectUri: config.giteaRedirectUri }
}
export async function initializeGiteaSettings() {
  await query(`CREATE TABLE IF NOT EXISTS system_settings (key TEXT PRIMARY KEY, encrypted_value TEXT NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT now())`)
  const result = await query<{ encrypted_value: string }>('SELECT encrypted_value FROM system_settings WHERE key = $1', ['gitea'])
  if (result.rows[0]) {
    try { apply(decrypt(result.rows[0].encrypted_value)) }
    catch { throw new Error('Gitea 配置解密失败，请恢复原 SESSION_SECRET') }
  }
}
export async function saveGiteaSettings(input: unknown) {
  if (!input || typeof input !== 'object') throw new Error('invalid_gitea_settings')
  const body = input as Record<string, unknown>
  for (const field of ['baseUrl', 'clientId', 'clientSecret', 'webhookSecret']) {
    if (body[field] !== undefined && (typeof body[field] !== 'string' || (body[field] as string).length > 4096)) throw new Error('invalid_gitea_settings')
  }
  let url: URL
  try { url = new URL(String(body.baseUrl ?? '').trim()) } catch { throw new Error('invalid_gitea_settings') }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('invalid_gitea_settings')
  const baseUrl = url.toString().replace(/\/+$/, '')
  const clientId = String(body.clientId ?? '').trim()
  if (!clientId) throw new Error('invalid_gitea_settings')
  if (config.sessionSecret.length < 32 || config.sessionSecret === 'local-development-session-secret-change-me') throw new Error('unsafe_settings_key')
  await withTransaction(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(472019)")
    const stored = await client.query<{ encrypted_value: string }>("SELECT encrypted_value FROM system_settings WHERE key = 'gitea'")
    const previous = stored.rows[0] ? decrypt(stored.rows[0].encrypted_value) : current()
    // 不同 Gitea 实例的数字 ID 可能冲突，已有数据时禁止直接切换实例。
    if (baseUrl !== previous.baseUrl) {
      const used = await client.query('SELECT 1 FROM app_user UNION ALL SELECT 1 FROM repository LIMIT 1')
      if (used.rows.length) throw new Error('gitea_instance_in_use')
    }
    const value = { baseUrl, clientId, clientSecret: String(body.clientSecret ?? '').trim() || previous.clientSecret, webhookSecret: String(body.webhookSecret ?? '').trim() || previous.webhookSecret }
    await client.query(`INSERT INTO system_settings (key, encrypted_value) VALUES ('gitea', $1) ON CONFLICT (key) DO UPDATE SET encrypted_value = EXCLUDED.encrypted_value, updated_at = now()`, [encrypt(value)])
    await client.query(`INSERT INTO audit_log (actor_type, action, resource, payload) VALUES ('agent', 'update_gitea_configuration', 'system/gitea', $1)`, [JSON.stringify({ credential: 'administrator_password', baseUrl, clientId })])
  })
  // 从已提交的数据重新加载；敏感配置不进入日志或 API 响应。
  await initializeGiteaSettings()
  return publicGiteaSettings()
}
