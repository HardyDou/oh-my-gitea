import crypto from 'node:crypto'
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify'
import cookie from '@fastify/cookie'
import cors from '@fastify/cors'
import { config } from './config.js'
import { ensureStageConfiguration, getManagement, getStageConfiguration, query, upsertRepository, upsertUser, withTransaction } from './db.js'
import { createComment, exchangeCode, getIssue, getRepository, getUser, giteaRequest, listComments, listIssues, listProjects, listRepositories, renderMarkdown, type GiteaIssue, type GiteaProject, type GiteaRepository } from './gitea.js'

const app = Fastify({ logger: true })
const sessions = new Map<string, { token: string; user: Awaited<ReturnType<typeof upsertUser>> }>()
const oauthRequests = new Map<string, { verifier: string; expiresAt: number }>()

type AuthContext = { token: string; user: Awaited<ReturnType<typeof upsertUser>>; actorType: 'user' | 'agent' }

function sessionId(request: FastifyRequest) {
  const raw = request.cookies.pm_session
  if (!raw) return undefined
  const unsigned = request.unsignCookie(raw)
  return unsigned.valid ? unsigned.value : undefined
}

await app.register(cookie, { secret: config.sessionSecret })
await app.register(cors, { origin: config.corsOrigin, credentials: true })
await app.register((await import('@fastify/multipart')).default, { limits: { fileSize: 20 * 1024 * 1024 } })

async function authenticate(request: FastifyRequest, reply: FastifyReply): Promise<AuthContext | null> {
  const authorization = request.headers.authorization
  let token: string | undefined
  let actorType: 'user' | 'agent' = 'user'
  if (authorization?.startsWith('Bearer ')) {
    token = authorization.slice(7)
    actorType = 'agent'
  } else {
    const sid = sessionId(request)
    if (sid) token = sessions.get(sid)?.token
  }
  if (!token) { await reply.code(401).send({ error: 'unauthorized', message: '请先登录 Gitea' }); return null }
  try {
    const giteaUser = await getUser(token)
    const user = await upsertUser(giteaUser)
    return { token, user, actorType }
  } catch {
    await reply.code(401).send({ error: 'unauthorized', message: 'Gitea 会话已失效' }); return null
  }
}

async function repositoryContext(token: string, owner: string, repo: string, write = false) {
  const remote = await getRepository(token, owner, repo)
  if (write && !remote.permissions?.push && !remote.permissions?.admin) throw new Error('forbidden')
  const local = await upsertRepository({ id: remote.id, owner, name: remote.name, full_name: remote.full_name, html_url: remote.html_url })
  return { remote, local }
}

app.get('/health', async () => ({ ok: true, service: 'gitea-pm-backend' }))

app.get('/api/v1/config/stages', async (request, reply) => {
  const auth = await authenticate(request, reply); if (!auth) return
  return { items: await getStageConfiguration() }
})

app.put<{ Body: { items?: { id?: number; code?: string; name?: string; substages?: { id?: number; code?: string; name?: string }[] }[] } }>('/api/v1/config/stages', async (request, reply) => {
  const auth = await authenticate(request, reply); if (!auth) return
  const items = (request.body?.items ?? []).map((item) => ({ id: item.id, code: item.code?.trim() ?? '', name: item.name?.trim() ?? '', substages: (item.substages ?? []).map((substage) => ({ id: substage.id, code: substage.code?.trim() ?? '', name: substage.name?.trim() ?? '' })).filter((substage) => substage.name) })).filter((item) => item.name)
  const validCode = (code: string) => /^[a-z][a-z0-9_-]*$/.test(code)
  if (!items.length || items.some((item) => !validCode(item.code) || !item.substages.length || item.substages.some((substage) => !validCode(substage.code))) || new Set(items.map((item) => item.code)).size !== items.length || new Set(items.map((item) => item.name)).size !== items.length || items.some((item) => new Set(item.substages.map((substage) => substage.code)).size !== item.substages.length || new Set(item.substages.map((substage) => substage.name)).size !== item.substages.length)) return reply.code(400).send({ error: 'invalid_stage_configuration', message: '阶段编码、名称和子阶段编码、名称不能重复且不能为空，编码只能使用小写字母、数字、下划线和短横线' })
  const existing = await getStageConfiguration()
  const itemIds = items.filter((item) => item.id).map((item) => item.id as number)
  const removed = existing.filter((stage) => !itemIds.includes(stage.id))
  if (removed.length) {
    const used = await query<{ stage_code: string; stage: string }>('SELECT DISTINCT stage_code, stage FROM issue_management WHERE stage_code = ANY($1::text[])', [removed.map((stage) => stage.code)])
    if (used.rows.length) return reply.code(409).send({ error: 'stage_in_use', message: `阶段「${used.rows.map((row) => row.stage).join('、')}」仍有 Issue，不能删除` })
  }
  for (const item of items) {
    const old = item.id ? existing.find((stage) => stage.id === item.id) : undefined
    if (!old) continue
    const removedSubstages = old.substages.filter((substage) => !item.substages.some((candidate) => candidate.id === substage.id))
    if (removedSubstages.length) {
      const used = await query<{ stage: string; sub_stage: string }>('SELECT DISTINCT stage, sub_stage FROM issue_management WHERE stage_code = $1 AND sub_stage_code = ANY($2::text[])', [old.code, removedSubstages.map((substage) => substage.code)])
      if (used.rows.length) return reply.code(409).send({ error: 'sub_stage_in_use', message: `子阶段「${used.rows.map((row) => row.sub_stage).join('、')}」仍有 Issue，不能删除` })
    }
  }
  await withTransaction(async (client) => {
    const savedIds: number[] = []
    for (const [index, item] of items.entries()) {
      const old = item.id ? existing.find((stage) => stage.id === item.id) : undefined
      let stageId: number
      if (old) {
        if (old.code !== item.code) await client.query('UPDATE issue_management SET stage_code = $1, stage = $2 WHERE stage_code = $3', [item.code, item.name, old.code])
        const stage = await client.query<{ id: number }>('UPDATE stage_config SET code = $1, name = $2, sort_order = $3, updated_at = now() WHERE id = $4 RETURNING id', [item.code, item.name, (index + 1) * 10, item.id])
        stageId = stage.rows[0].id
      } else {
        const stage = await client.query<{ id: number }>('INSERT INTO stage_config (code, name, sort_order) VALUES ($1, $2, $3) RETURNING id', [item.code, item.name, (index + 1) * 10])
        stageId = stage.rows[0].id
      }
      savedIds.push(stageId)
      const oldSubstages = old?.substages ?? []
      const savedSubstageIds: number[] = []
      for (const [subIndex, substage] of item.substages.entries()) {
        const oldSubstage = substage.id ? oldSubstages.find((candidate) => candidate.id === substage.id) : undefined
        let substageId: number
        if (oldSubstage) {
          if (oldSubstage.code !== substage.code) await client.query('UPDATE issue_management SET sub_stage_code = $1, sub_stage = $2 WHERE stage_code = $3 AND sub_stage_code = $4', [substage.code, substage.name, item.code, oldSubstage.code])
          const saved = await client.query<{ id: number }>('UPDATE stage_substage_config SET code = $1, name = $2, sort_order = $3 WHERE id = $4 RETURNING id', [substage.code, substage.name, (subIndex + 1) * 10, substage.id])
          substageId = saved.rows[0].id
        } else {
          const saved = await client.query<{ id: number }>('INSERT INTO stage_substage_config (stage_id, code, name, sort_order) VALUES ($1, $2, $3, $4) RETURNING id', [stageId, substage.code, substage.name, (subIndex + 1) * 10])
          substageId = saved.rows[0].id
        }
        savedSubstageIds.push(substageId)
      }
      await client.query('DELETE FROM stage_substage_config WHERE stage_id = $1 AND id <> ALL($2::bigint[])', [stageId, savedSubstageIds])
    }
    await client.query('DELETE FROM stage_config WHERE id <> ALL($1::bigint[])', [savedIds])
  })
  await query(`INSERT INTO audit_log (actor_gitea_user_id, actor_type, action, resource, payload) VALUES ($1, $2, $3, $4, $5)`, [auth.user.gitea_user_id, auth.actorType, 'update_stage_configuration', 'system/stages', JSON.stringify({ items })])
  return { items: await getStageConfiguration() }
})

app.get('/auth/gitea', async (_request, reply) => {
  const verifier = crypto.randomBytes(32).toString('base64url')
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url')
  const state = crypto.randomBytes(24).toString('base64url')
  oauthRequests.set(state, { verifier, expiresAt: Date.now() + 10 * 60 * 1000 })
  const url = new URL(`${config.giteaBaseUrl}/login/oauth/authorize`)
  url.searchParams.set('client_id', config.giteaClientId)
  url.searchParams.set('redirect_uri', config.giteaRedirectUri)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', 'read:user,read:repository,read:issue,write:repository,write:issue')
  url.searchParams.set('prompt', 'consent')
  url.searchParams.set('state', state)
  url.searchParams.set('code_challenge', challenge)
  url.searchParams.set('code_challenge_method', 'S256')
  return reply.redirect(url.toString())
})

app.get<{ Querystring: { code?: string; state?: string; error?: string } }>('/auth/gitea/callback', async (request, reply) => {
  if (!request.query.code || !request.query.state) return reply.code(400).send({ error: request.query.error ?? 'missing_code_or_state' })
  const oauth = oauthRequests.get(request.query.state)
  oauthRequests.delete(request.query.state)
  if (!oauth || oauth.expiresAt < Date.now()) return reply.code(400).send({ error: 'invalid_oauth_state' })
  const token = await exchangeCode(request.query.code, oauth.verifier)
  const user = await upsertUser(await getUser(token))
  const sid = crypto.randomBytes(24).toString('hex')
  sessions.set(sid, { token, user })
  return reply.setCookie('pm_session', sid, { signed: true, httpOnly: true, sameSite: 'lax', path: '/', secure: config.nodeEnv === 'production', maxAge: 60 * 60 * 8 }).redirect(config.corsOrigin)
})

app.get('/auth/me', async (request, reply) => {
  const auth = await authenticate(request, reply); if (!auth) return
  return { user: auth.user }
})

app.post('/auth/logout', async (request, reply) => {
  const sid = sessionId(request)
  if (sid) sessions.delete(sid)
  return reply.clearCookie('pm_session', { path: '/' }).send({ ok: true })
})

app.get('/api/v1/repositories', async (request, reply) => {
  const auth = await authenticate(request, reply); if (!auth) return
  const repositories = await listRepositories(auth.token)
  const items = await Promise.all(repositories.map((repo) => upsertRepository({ id: repo.id, owner: repo.owner.login, name: repo.name, full_name: repo.full_name, html_url: repo.html_url })))
  return { items }
})

app.get<{ Params: { owner: string; repo: string } }>('/api/v1/repositories/:owner/:repo/projects', async (request, reply) => {
  const auth = await authenticate(request, reply); if (!auth) return
  const context = await repositoryContext(auth.token, request.params.owner, request.params.repo)
  const projects = await listProjects(auth.token, request.params.owner, request.params.repo)
  await Promise.all(projects.map((project) => query(`INSERT INTO gitea_project (repository_id, gitea_project_id, title, status) VALUES ($1, $2, $3, $4) ON CONFLICT (repository_id, gitea_project_id) DO UPDATE SET title = EXCLUDED.title, status = EXCLUDED.status, updated_at = now()`, [context.local.id, project.id, project.title, project.state ?? null])))
  return { items: projects }
})

app.get<{ Params: { owner: string; repo: string }; Querystring: Record<string, string | undefined> }>('/api/v1/repositories/:owner/:repo/issues', async (request, reply) => {
  const auth = await authenticate(request, reply); if (!auth) return
  const context = await repositoryContext(auth.token, request.params.owner, request.params.repo)
  const queryParams = { ...request.query }
  delete queryParams.repository
  const issues = await listIssues(auth.token, request.params.owner, request.params.repo, queryParams)
  const management = await getManagement(context.local.id, issues.map((issue) => issue.number))
  return { items: issues.map((issue) => ({ ...issue, management: management.get(issue.number) ?? { stage: '需求', stage_code: 'requirement', sub_stage: '未开始', sub_stage_code: 'not_started', priority: 'P2' } })) }
})

app.patch<{ Params: { owner: string; repo: string; number: string }; Body: { dueDate?: string | null } }>('/api/v1/repositories/:owner/:repo/issues/:number/due-date', async (request, reply) => {
  const auth = await authenticate(request, reply); if (!auth) return
  const context = await repositoryContext(auth.token, request.params.owner, request.params.repo, true)
  const dueDate = request.body?.dueDate ? `${request.body.dueDate}T00:00:00Z` : null
  const updated = await giteaRequest<GiteaIssue>(`/repos/${encodeURIComponent(request.params.owner)}/${encodeURIComponent(request.params.repo)}/issues/${Number(request.params.number)}`, auth.token, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ due_date: dueDate }) })
  await query(`INSERT INTO audit_log (actor_gitea_user_id, actor_type, action, resource, payload) VALUES ($1, $2, $3, $4, $5)`, [auth.user.gitea_user_id, auth.actorType, 'update_issue_due_date', `${context.remote.full_name}#${request.params.number}`, JSON.stringify({ dueDate })])
  return { dueDate: updated.due_date ? updated.due_date.slice(0, 10) : null }
})

app.patch<{ Params: { owner: string; repo: string; number: string }; Body: { assignee?: string | null } }>('/api/v1/repositories/:owner/:repo/issues/:number/assignee', async (request, reply) => {
  const auth = await authenticate(request, reply); if (!auth) return
  const context = await repositoryContext(auth.token, request.params.owner, request.params.repo, true)
  const issueNumber = Number(request.params.number)
  const assignee = request.body?.assignee || null
  const updated = await giteaRequest<GiteaIssue>(`/repos/${encodeURIComponent(request.params.owner)}/${encodeURIComponent(request.params.repo)}/issues/${issueNumber}`, auth.token, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ assignee }) })
  await query(`INSERT INTO audit_log (actor_gitea_user_id, actor_type, action, resource, payload) VALUES ($1, $2, $3, $4, $5)`, [auth.user.gitea_user_id, auth.actorType, 'update_issue_assignee', `${context.remote.full_name}#${issueNumber}`, JSON.stringify({ assignee })])
  return { assignee: updated.assignee?.login ?? '未分配' }
})

app.post<{ Body: { body?: string } }>('/api/v1/markdown', async (request, reply) => {
  const auth = await authenticate(request, reply); if (!auth) return
  return { html: await renderMarkdown(auth.token, request.body?.body ?? '') }
})

app.get<{ Params: { owner: string; repo: string; number: string } }>('/api/v1/repositories/:owner/:repo/issues/:number/detail', async (request, reply) => {
  const auth = await authenticate(request, reply); if (!auth) return
  const context = await repositoryContext(auth.token, request.params.owner, request.params.repo)
  const number = Number(request.params.number)
  const [issue, comments] = await Promise.all([getIssue(auth.token, request.params.owner, request.params.repo, number), listComments(auth.token, request.params.owner, request.params.repo, number)])
  const [bodyHtml, commentsWithHtml] = await Promise.all([
    renderMarkdown(auth.token, issue.body ?? ''),
    Promise.all(comments.map(async (comment) => ({ ...comment, body_html: await renderMarkdown(auth.token, comment.body ?? '') }))),
  ])
  const management = (await getManagement(context.local.id, [number])).get(number) ?? { stage: '需求', stage_code: 'requirement', sub_stage: '未开始', sub_stage_code: 'not_started', priority: 'P2' }
  const history = await query(`SELECT h.*, COALESCE(u.display_name, u.login) AS actor_name, u.login AS actor_login FROM issue_flow_history h JOIN issue_management m ON m.id = h.issue_management_id LEFT JOIN app_user u ON u.gitea_user_id = h.actor_gitea_user_id WHERE m.repository_id = $1 AND m.issue_number = $2 ORDER BY h.created_at ASC`, [context.local.id, number])
  return { issue: { ...issue, body_html: bodyHtml, management }, comments: commentsWithHtml, history: history.rows }
})

app.post<{ Params: { owner: string; repo: string; number: string } }>('/api/v1/repositories/:owner/:repo/issues/:number/assets', async (request, reply) => {
  const auth = await authenticate(request, reply); if (!auth) return
  const context = await repositoryContext(auth.token, request.params.owner, request.params.repo, true)
  const file = await request.file()
  if (!file) return reply.code(400).send({ error: 'attachment_required' })
  const form = new FormData()
  const buffer = await file.toBuffer()
  form.append('attachment', new Blob([new Uint8Array(buffer)], { type: file.mimetype }), file.filename)
  const target = `${config.giteaBaseUrl}/api/v1/repos/${encodeURIComponent(request.params.owner)}/${encodeURIComponent(request.params.repo)}/issues/${Number(request.params.number)}/assets?name=${encodeURIComponent(file.filename)}`
  const response = await fetch(target, { method: 'POST', headers: { Authorization: `token ${auth.token}` }, body: form })
  if (!response.ok) return reply.code(response.status).send({ error: 'gitea_attachment_failed', message: (await response.text()).slice(0, 300) })
  const attachment = await response.json()
  await query(`INSERT INTO audit_log (actor_gitea_user_id, actor_type, action, resource, payload) VALUES ($1, $2, $3, $4, $5)`, [auth.user.gitea_user_id, auth.actorType, 'upload_issue_attachment', `${context.remote.full_name}#${request.params.number}`, JSON.stringify({ filename: file.filename })])
  return attachment
})

app.post<{ Params: { owner: string; repo: string; number: string }; Body: { body?: string } }>('/api/v1/repositories/:owner/:repo/issues/:number/comments', async (request, reply) => {
  const auth = await authenticate(request, reply); if (!auth) return
  const context = await repositoryContext(auth.token, request.params.owner, request.params.repo, true)
  const body = request.body?.body?.trim()
  if (!body) return reply.code(400).send({ error: 'comment_body_required' })
  const comment = await createComment(auth.token, request.params.owner, request.params.repo, Number(request.params.number), body)
  await query(`INSERT INTO audit_log (actor_gitea_user_id, actor_type, action, resource, payload) VALUES ($1, $2, $3, $4, $5)`, [auth.user.gitea_user_id, auth.actorType, 'create_issue_comment', `${context.remote.full_name}#${request.params.number}`, JSON.stringify({ comment_id: comment.id })])
  return comment
})

app.get<{ Params: { owner: string; repo: string; number: string } }>('/api/v1/repositories/:owner/:repo/issues/:number/history', async (request, reply) => {
  const auth = await authenticate(request, reply); if (!auth) return
  const context = await repositoryContext(auth.token, request.params.owner, request.params.repo)
  const result = await query(`SELECT h.*, COALESCE(u.display_name, u.login) AS actor_name, u.login AS actor_login FROM issue_flow_history h JOIN issue_management m ON m.id = h.issue_management_id LEFT JOIN app_user u ON u.gitea_user_id = h.actor_gitea_user_id WHERE m.repository_id = $1 AND m.issue_number = $2 ORDER BY h.created_at DESC`, [context.local.id, Number(request.params.number)])
  return { items: result.rows }
})

app.patch<{ Params: { owner: string; repo: string; number: string }; Body: { stage?: string; stageCode?: string; subStage?: string; subStageCode?: string; priority?: string } }>('/api/v1/repositories/:owner/:repo/issues/:number/management', async (request, reply) => {
  const auth = await authenticate(request, reply); if (!auth) return
  const body = request.body ?? {}
  const stageConfig = await getStageConfiguration()
  const priorities = ['P0', 'P1', 'P2', 'P3']
  const targetStageConfig = body.stageCode ? stageConfig.find((stage) => stage.code === body.stageCode) : stageConfig.find((stage) => stage.name === body.stage)
  if ((body.stage || body.stageCode) && !targetStageConfig || (body.priority && !priorities.includes(body.priority))) return reply.code(400).send({ error: 'invalid_management_value' })
  if ((body.subStage || body.subStageCode) && targetStageConfig && !targetStageConfig.substages.some((substage) => substage.name === body.subStage || substage.code === body.subStageCode)) return reply.code(400).send({ error: 'invalid_sub_stage' })
  const context = await repositoryContext(auth.token, request.params.owner, request.params.repo, true)
  const issueNumber = Number(request.params.number)
  const result = await withTransaction(async (client) => {
    const previous = await client.query<{ id: number; stage: string; stage_code: string; sub_stage: string; sub_stage_code: string; priority: string }>('SELECT id, stage, stage_code, sub_stage, sub_stage_code, priority FROM issue_management WHERE repository_id = $1 AND issue_number = $2 FOR UPDATE', [context.local.id, issueNumber])
    const defaultStage = stageConfig[0]
    const current = previous.rows[0] ?? { id: 0, stage: defaultStage?.name ?? '需求', stage_code: defaultStage?.code ?? 'requirement', sub_stage: defaultStage?.substages[0]?.name ?? '未开始', sub_stage_code: defaultStage?.substages[0]?.code ?? 'not_started', priority: 'P2' }
    const nextConfig = targetStageConfig ?? stageConfig.find((stage) => stage.code === current.stage_code) ?? defaultStage
    const requestedSubStage = body.subStageCode ? nextConfig?.substages.find((substage) => substage.code === body.subStageCode) : body.subStage ? nextConfig?.substages.find((substage) => substage.name === body.subStage) : undefined
    if ((body.subStage || body.subStageCode) && !requestedSubStage) throw new Error('invalid_sub_stage')
    const nextStage = nextConfig?.name ?? current.stage
    const nextCode = nextConfig?.code ?? current.stage_code
    const nextSubStage = requestedSubStage?.name ?? (nextCode !== current.stage_code ? nextConfig?.substages[0]?.name : current.sub_stage) ?? '未开始'
    const nextSubStageCode = requestedSubStage?.code ?? (nextCode !== current.stage_code ? nextConfig?.substages[0]?.code : current.sub_stage_code) ?? 'not_started'
    const nextPriority = body.priority ?? current.priority
    const saved = await client.query<{ id: number; stage: string; stage_code: string; sub_stage: string; sub_stage_code: string; priority: string }>(`INSERT INTO issue_management (repository_id, issue_number, stage, stage_code, sub_stage, sub_stage_code, priority) VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (repository_id, issue_number) DO UPDATE SET stage = EXCLUDED.stage, stage_code = EXCLUDED.stage_code, sub_stage = EXCLUDED.sub_stage, sub_stage_code = EXCLUDED.sub_stage_code, priority = EXCLUDED.priority, updated_at = now() RETURNING id, stage, stage_code, sub_stage, sub_stage_code, priority`, [context.local.id, issueNumber, nextStage, nextCode, nextSubStage, nextSubStageCode, nextPriority])
    if (nextCode !== current.stage_code || nextSubStageCode !== current.sub_stage_code || nextPriority !== current.priority) await client.query(`INSERT INTO issue_flow_history (issue_management_id, actor_gitea_user_id, from_stage, to_stage, from_sub_stage, to_sub_stage, from_priority, to_priority) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`, [saved.rows[0].id, auth.user.gitea_user_id, current.stage, nextStage, current.sub_stage, nextSubStage, current.priority, nextPriority])
    await client.query(`INSERT INTO audit_log (actor_gitea_user_id, actor_type, action, resource, payload) VALUES ($1, $2, $3, $4, $5)`, [auth.user.gitea_user_id, auth.actorType, 'update_issue_management', `${context.remote.full_name}#${issueNumber}`, JSON.stringify({ from: current, to: { stage: nextStage, stageCode: nextCode, subStage: nextSubStage, priority: nextPriority } })])
    return saved.rows[0]
  })
  return result
})

app.post<{ Body: Record<string, unknown> }>('/webhooks/gitea', async (request, reply) => {
  if (config.giteaWebhookSecret && request.headers['x-gitea-token'] !== config.giteaWebhookSecret) return reply.code(401).send({ error: 'invalid_webhook_secret' })
  const delivery = String(request.headers['x-gitea-delivery'] ?? crypto.randomUUID())
  const eventName = String(request.headers['x-gitea-event'] ?? 'unknown')
  await query(`INSERT INTO sync_event (delivery_id, event_name, payload) VALUES ($1, $2, $3) ON CONFLICT (delivery_id) DO NOTHING`, [delivery, eventName, JSON.stringify(request.body ?? {})])
  return { ok: true, delivery }
})

app.setErrorHandler((error, _request, reply) => {
  if (error.message === 'forbidden') return reply.code(403).send({ error: 'forbidden' })
  if (error.message === 'invalid_stage_transition') return reply.code(409).send({ error: 'invalid_stage_transition', message: '不允许跳过阶段或回退到需求' })
  if (error.message === 'invalid_sub_stage') return reply.code(400).send({ error: 'invalid_sub_stage', message: '子阶段不属于当前阶段' })
  app.log.error(error)
  return reply.code(500).send({ error: 'internal_error', message: config.nodeEnv === 'development' ? error.message : '服务器内部错误' })
})

ensureStageConfiguration().then(() => app.listen({ port: config.port, host: '0.0.0.0' })).catch((error) => { app.log.error(error); process.exit(1) })
