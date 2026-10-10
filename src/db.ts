import pg from 'pg'
import { config } from './config.js'

const { Pool } = pg
export const pool = new Pool({ connectionString: config.databaseUrl })

export async function query<T extends pg.QueryResultRow = any>(text: string, values: unknown[] = []) {
  return pool.query<T>(text, values)
}

export async function withTransaction<T>(work: (client: pg.PoolClient) => Promise<T>) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const result = await work(client)
    await client.query('COMMIT')
    return result
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

export async function upsertUser(user: { id: number; login: string; full_name?: string; avatar_url?: string }) {
  const result = await query<{ id: number; gitea_user_id: number; login: string; display_name: string | null; avatar_url: string | null }>(
    `INSERT INTO app_user (gitea_user_id, login, display_name, avatar_url)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (gitea_user_id) DO UPDATE SET login = EXCLUDED.login, display_name = EXCLUDED.display_name, avatar_url = EXCLUDED.avatar_url, updated_at = now()
     RETURNING id, gitea_user_id, login, display_name, avatar_url`,
    [user.id, user.login, user.full_name || user.login, user.avatar_url ?? null],
  )
  return result.rows[0]
}

export async function upsertRepository(repo: { id: number; owner: string; name: string; full_name: string; html_url?: string }) {
  const result = await query<{ id: number; gitea_id: number; owner: string; name: string; full_name: string }>(
    `INSERT INTO repository (gitea_id, owner, name, full_name, html_url)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (gitea_id) DO UPDATE SET owner = EXCLUDED.owner, name = EXCLUDED.name, full_name = EXCLUDED.full_name, html_url = EXCLUDED.html_url, updated_at = now()
     RETURNING id, gitea_id, owner, name, full_name`,
    [repo.id, repo.owner, repo.name, repo.full_name, repo.html_url ?? null],
  )
  return result.rows[0]
}

export type StageConfig = { id: number; code: string; name: string; sort_order: number; substages: Array<{ id: number; code: string; name: string; sort_order: number }> }

export async function ensureStageConfiguration() {
  await query(`ALTER TABLE app_user ADD COLUMN IF NOT EXISTS gitea_access_token TEXT`)
  await query(`CREATE TABLE IF NOT EXISTS api_access_token (id BIGSERIAL PRIMARY KEY, app_user_id BIGINT NOT NULL REFERENCES app_user(id) ON DELETE CASCADE, name TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE, token_prefix TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), last_used_at TIMESTAMPTZ, revoked_at TIMESTAMPTZ)`)
  await query(`CREATE TABLE IF NOT EXISTS stage_config (id BIGSERIAL PRIMARY KEY, code TEXT NOT NULL UNIQUE, name TEXT NOT NULL UNIQUE, sort_order INTEGER NOT NULL DEFAULT 0, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now())`)
  await query(`CREATE TABLE IF NOT EXISTS stage_substage_config (id BIGSERIAL PRIMARY KEY, stage_id BIGINT NOT NULL REFERENCES stage_config(id) ON DELETE CASCADE, code TEXT NOT NULL, name TEXT NOT NULL, sort_order INTEGER NOT NULL DEFAULT 0, UNIQUE (stage_id, code))`)
  await query(`ALTER TABLE issue_management DROP CONSTRAINT IF EXISTS issue_management_stage_check`)
  await query(`ALTER TABLE issue_management ADD COLUMN IF NOT EXISTS sub_stage TEXT NOT NULL DEFAULT '未开始'`)
  await query(`ALTER TABLE issue_management ADD COLUMN IF NOT EXISTS stage_code TEXT`)
  await query(`ALTER TABLE issue_management ADD COLUMN IF NOT EXISTS sub_stage_code TEXT`)
  await query(`ALTER TABLE stage_substage_config ADD COLUMN IF NOT EXISTS code TEXT`)
  await query(`ALTER TABLE issue_flow_history ADD COLUMN IF NOT EXISTS from_sub_stage TEXT`)
  await query(`ALTER TABLE issue_flow_history ADD COLUMN IF NOT EXISTS to_sub_stage TEXT`)
  await query(`UPDATE issue_management SET stage = '归档' WHERE stage = '完成'`)
  await query(`ALTER TABLE stage_config ADD COLUMN IF NOT EXISTS code TEXT`)
  await query(`UPDATE stage_config SET code = CASE name WHEN '需求' THEN 'requirement' WHEN '研发' THEN 'development' WHEN '测试' THEN 'testing' WHEN '完成' THEN 'archive' WHEN '归档' THEN 'archive' ELSE 'stage_' || id::text END WHERE code IS NULL`)
  await query(`CREATE UNIQUE INDEX IF NOT EXISTS stage_config_code_unique ON stage_config(code)`)
  await query(`UPDATE issue_management SET stage_code = CASE stage WHEN '需求' THEN 'requirement' WHEN '研发' THEN 'development' WHEN '测试' THEN 'testing' WHEN '完成' THEN 'archive' WHEN '归档' THEN 'archive' ELSE stage END WHERE stage_code IS NULL`)
  await query(`INSERT INTO stage_config (code, name, sort_order) VALUES ('requirement', '需求', 10), ('development', '研发', 20), ('testing', '测试', 30), ('archive', '归档', 40) ON CONFLICT (code) DO NOTHING`)
  await query(`UPDATE stage_substage_config SET code = CASE name WHEN '未开始' THEN 'not_started' WHEN '进行中' THEN 'in_progress' WHEN '完成' THEN 'completed' ELSE 'substage_' || id::text END WHERE code IS NULL`)
  await query(`CREATE UNIQUE INDEX IF NOT EXISTS stage_substage_config_code_unique ON stage_substage_config(stage_id, code)`)
  await query(`INSERT INTO stage_substage_config (stage_id, code, name, sort_order) SELECT s.id, sub.code, sub.name, sub.sort_order FROM stage_config s CROSS JOIN (VALUES ('not_started', '未开始', 10), ('in_progress', '进行中', 20), ('completed', '完成', 30)) AS sub(code, name, sort_order) WHERE s.name IN ('需求', '研发', '测试', '归档') ON CONFLICT (stage_id, code) DO NOTHING`)
  await query(`UPDATE issue_management m SET sub_stage_code = s.code FROM stage_substage_config s WHERE m.stage_code = (SELECT sc.code FROM stage_config sc WHERE sc.id = s.stage_id) AND m.sub_stage = s.name AND m.sub_stage_code IS NULL`)
}

export async function saveGiteaAccessToken(appUserId: number, encryptedToken: string) {
  await query('UPDATE app_user SET gitea_access_token = $1, updated_at = now() WHERE id = $2', [encryptedToken, appUserId])
}

export async function getGiteaAccessToken(appUserId: number) {
  const result = await query<{ gitea_access_token: string | null }>('SELECT gitea_access_token FROM app_user WHERE id = $1', [appUserId])
  return result.rows[0]?.gitea_access_token ?? null
}

export async function findApiAccessToken(tokenHash: string) {
  const result = await query<{ id: number; app_user_id: number; gitea_access_token: string | null; gitea_user_id: number }>('SELECT t.id, t.app_user_id, u.gitea_access_token, u.gitea_user_id FROM api_access_token t JOIN app_user u ON u.id = t.app_user_id WHERE t.token_hash = $1 AND t.revoked_at IS NULL', [tokenHash])
  return result.rows[0]
}

export async function touchApiAccessToken(id: number) { await query('UPDATE api_access_token SET last_used_at = now() WHERE id = $1', [id]) }

export async function listApiAccessTokens(appUserId: number) {
  const result = await query<{ id: number; name: string; token_prefix: string; created_at: string; last_used_at: string | null; revoked_at: string | null }>('SELECT id, name, token_prefix, created_at, last_used_at, revoked_at FROM api_access_token WHERE app_user_id = $1 AND revoked_at IS NULL ORDER BY created_at DESC', [appUserId])
  return result.rows
}

export async function createApiAccessToken(appUserId: number, name: string, tokenHash: string, tokenPrefix: string) {
  const result = await query<{ id: number; name: string; token_prefix: string; created_at: string }>('INSERT INTO api_access_token (app_user_id, name, token_hash, token_prefix) VALUES ($1, $2, $3, $4) RETURNING id, name, token_prefix, created_at', [appUserId, name, tokenHash, tokenPrefix])
  return result.rows[0]
}

export async function revokeApiAccessToken(appUserId: number, id: number) { await query('UPDATE api_access_token SET revoked_at = now() WHERE id = $1 AND app_user_id = $2', [id, appUserId]) }

export async function getStageConfiguration() {
  const stages = await query<{ id: number; code: string; name: string; sort_order: number }>('SELECT id, code, name, sort_order FROM stage_config ORDER BY sort_order, id')
  const substages = await query<{ id: number; stage_id: number; code: string; name: string; sort_order: number }>('SELECT id, stage_id, code, name, sort_order FROM stage_substage_config ORDER BY sort_order, id')
  return stages.rows.map((stage) => ({ ...stage, substages: substages.rows.filter((substage) => substage.stage_id === stage.id) }))
}

export async function getManagement(repositoryId: number, issueNumbers: number[]) {
  if (!issueNumbers.length) return new Map<number, { stage: string; sub_stage: string; priority: string }>()
  const result = await query<{ issue_number: number; stage: string; stage_code: string; sub_stage: string; sub_stage_code: string; priority: string }>(
    `SELECT m.issue_number, COALESCE(s.name, m.stage) AS stage, COALESCE(m.stage_code, s.code, m.stage) AS stage_code, COALESCE(ss.name, m.sub_stage) AS sub_stage, COALESCE(m.sub_stage_code, ss.code, m.sub_stage) AS sub_stage_code, m.priority FROM issue_management m LEFT JOIN stage_config s ON s.code = m.stage_code LEFT JOIN stage_substage_config ss ON ss.stage_id = s.id AND ss.code = m.sub_stage_code WHERE m.repository_id = $1 AND m.issue_number = ANY($2::int[])`,
    [repositoryId, issueNumbers],
  )
  return new Map(result.rows.map((row) => [row.issue_number, { stage: row.stage, stage_code: row.stage_code, sub_stage: row.sub_stage, sub_stage_code: row.sub_stage_code, priority: row.priority }]))
}
