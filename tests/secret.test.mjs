import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { loadSessionSecret } from '../dist/secret.js'

test('自动生成的加密密钥持久化、权限受限，兼容旧环境变量', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'gitea-secret-test-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const file = join(dir, 'data', 'session-secret')
  const secret = loadSessionSecret('', file)
  assert.match(secret, /^[a-f0-9]{64}$/)
  assert.equal(loadSessionSecret(undefined, file), secret)
  assert.equal(loadSessionSecret('existing-environment-secret', file), 'existing-environment-secret')
  assert.equal(readFileSync(file, 'utf8'), secret)
  if (process.platform !== 'win32') assert.equal(statSync(file).mode & 0o777, 0o600)
  writeFileSync(file, 'invalid')
  assert.throws(() => loadSessionSecret('', file), /密钥文件无效/)
})
