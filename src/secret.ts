import crypto from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

// 已部署实例继续使用原环境变量；新部署自动生成并持久化，绝不在每次启动时轮换。
export function loadSessionSecret(explicit: string | undefined, file: string) {
  if (explicit) return explicit
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 })
  try {
    writeFileSync(file, crypto.randomBytes(32).toString('hex'), { flag: 'wx', mode: 0o600 })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
  }
  const secret = readFileSync(file, 'utf8').trim()
  if (secret.length < 32) throw new Error('自动生成的加密密钥文件无效，请恢复备份；不要删除已有密钥文件')
  return secret
}

export function encryptSecret(value: string, secret: string) {
  const key = crypto.createHash('sha256').update(secret).digest()
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
  return `${iv.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}.${encrypted.toString('base64url')}`
}

export function decryptSecret(value: string, secret: string) {
  const [ivText, tagText, encryptedText] = value.split('.')
  if (!ivText || !tagText || !encryptedText) throw new Error('invalid_encrypted_secret')
  const key = crypto.createHash('sha256').update(secret).digest()
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivText, 'base64url'))
  decipher.setAuthTag(Buffer.from(tagText, 'base64url'))
  return Buffer.concat([decipher.update(Buffer.from(encryptedText, 'base64url')), decipher.final()]).toString('utf8')
}

export function hashSecret(value: string) { return crypto.createHash('sha256').update(value).digest('hex') }
