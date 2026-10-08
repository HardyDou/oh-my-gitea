import { config } from './config.js'

export type GiteaUser = { id: number; login: string; full_name?: string; avatar_url?: string }
export type GiteaRepository = { id: number; owner: { login: string }; name: string; full_name: string; html_url?: string; permissions?: { pull?: boolean; push?: boolean; admin?: boolean } }
export type GiteaIssue = {
  number: number; title: string; body?: string; state: string; type?: string; created_at?: string; updated_at?: string; due_date?: string | null
  user?: { id: number; login: string }; assignee?: { id: number; login: string } | null; assignees?: Array<{ id: number; login: string }>
  labels?: Array<{ id: number; name: string; color?: string }>; milestone?: { id: number; title: string } | null
  projects?: Array<{ id: number; title: string }>
  assets?: Array<{ id: number; name: string; size?: number; browser_download_url?: string; download_url?: string }>
  html_url?: string
}
export type GiteaProject = { id: number; title: string; description?: string; state?: string }
export type GiteaComment = { id: number; body: string; created_at?: string; updated_at?: string; user?: { login: string; avatar_url?: string } }

export async function giteaRequest<T>(path: string, token: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${config.giteaBaseUrl}/api/v1${path}`, {
    ...init,
    headers: { Accept: 'application/json', Authorization: `token ${token}`, ...(init.headers ?? {}) },
  })
  if (!response.ok) {
    const detail = await response.text()
    throw new Error(`Gitea API ${response.status}: ${detail.slice(0, 300)}`)
  }
  return response.json() as Promise<T>
}

export async function getUser(token: string) { return giteaRequest<GiteaUser>('/user', token) }
export async function getRepository(token: string, owner: string, repo: string) { return giteaRequest<GiteaRepository>(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`, token) }
export async function listRepositories(token: string) {
  const all: GiteaRepository[] = []
  for (let page = 1; page <= 1000; page += 1) {
    const items = await giteaRequest<GiteaRepository[]>(`/user/repos?limit=100&sort=updated&page=${page}`, token)
    all.push(...items)
    if (items.length < 100) break
  }
  return all
}
export async function listProjects(token: string, owner: string, repo: string) { return giteaRequest<GiteaProject[]>(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/projects?state=all&limit=100`, token) }

export async function renderMarkdown(token: string, markdown: string) {
  const response = await fetch(`${config.giteaBaseUrl}/api/v1/markdown/raw`, { method: 'POST', headers: { Accept: 'text/html', Authorization: `token ${token}`, 'Content-Type': 'text/plain; charset=utf-8' }, body: markdown })
  if (!response.ok) throw new Error(`Gitea Markdown API ${response.status}: ${(await response.text()).slice(0, 300)}`)
  const html = await response.text()
  // Gitea Markdown may return attachment URLs starting with `/`; the PM UI runs on another origin.
  return html.replace(/(src|href)=("|')\/(?!\/)/g, `$1=$2${config.giteaBaseUrl}/`)
}

export async function getIssue(token: string, owner: string, repo: string, number: number) { return giteaRequest<GiteaIssue>(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues/${number}`, token) }
export async function listComments(token: string, owner: string, repo: string, number: number) { return giteaRequest<GiteaComment[]>(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues/${number}/comments?limit=100`, token) }
export async function createComment(token: string, owner: string, repo: string, number: number, body: string) { return giteaRequest<GiteaComment>(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues/${number}/comments`, token, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body }) }) }

export async function listIssues(token: string, owner: string, repo: string, params: Record<string, string | undefined>) {
  // 与 Gitea 的 Issues 页面保持一致：只统计 Issue，不把 Pull Request 混入总数。
  const search = new URLSearchParams({ state: 'all', type: 'issues', limit: '100' })
  for (const [key, value] of Object.entries(params)) if (value) search.set(key, value)
  return giteaRequest<GiteaIssue[]>(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues?${search}`, token)
}

export async function exchangeCode(code: string, codeVerifier?: string) {
  const body = new URLSearchParams({ grant_type: 'authorization_code', client_id: config.giteaClientId, code, redirect_uri: config.giteaRedirectUri })
  if (config.giteaClientSecret) body.set('client_secret', config.giteaClientSecret)
  if (codeVerifier) body.set('code_verifier', codeVerifier)
  const response = await fetch(`${config.giteaBaseUrl}/login/oauth/access_token`, { method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' }, body })
  if (!response.ok) {
    const detail = await response.text()
    throw new Error(`OAuth token exchange failed: ${response.status} ${detail.slice(0, 300)}`)
  }
  const data = await response.json() as { access_token?: string }
  if (!data.access_token) throw new Error('Gitea did not return an access token')
  return data.access_token
}
