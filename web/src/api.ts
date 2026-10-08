export type AppUser = { gitea_user_id: number; login: string; display_name?: string | null; avatar_url?: string | null }
export type StageConfig = { id?: number; code: string; name: string; sort_order?: number; substages: Array<{ id?: number; code: string; name: string; sort_order?: number }> }

export type GiteaRepository = {
  id: number
  owner: string
  name: string
  full_name: string
  html_url?: string
}

export type GiteaComment = { id: number; body: string; body_html?: string; created_at?: string; user?: { login: string; avatar_url?: string } }
export type GiteaIssue = {
  number: number
  title: string
  body?: string
  state: string
  type?: string
  html_url?: string
  created_at?: string
  updated_at?: string
  due_date?: string | null
  user?: { login: string }
  assignee?: { login: string } | null
  assignees?: Array<{ login: string }>
  labels?: Array<{ name: string; color?: string }>
  milestone?: { title: string } | null
  projects?: Array<{ title: string }>
  assets?: Array<{ id: number; name: string; size?: number; browser_download_url?: string; download_url?: string }>
  body_html?: string
  management: { stage: string; stage_code?: string; sub_stage?: string; sub_stage_code?: string; priority: string }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers)
  if (!(options.body instanceof FormData)) headers.set('Content-Type', 'application/json')
  const response = await fetch(path, { ...options, credentials: 'include', headers })
  if (!response.ok) {
    const error = await response.json().catch(() => ({})) as { message?: string; error?: string }
    const result = new Error(error.message ?? error.error ?? `请求失败：${response.status}`)
    ;(result as Error & { status?: number }).status = response.status
    throw result
  }
  return response.json() as Promise<T>
}

export function getMe() {
  return request<{ user: AppUser }>('/auth/me')
}

export function getStageConfig() {
  return request<{ items: StageConfig[] }>('/api/v1/config/stages')
}

export function saveStageConfig(items: StageConfig[]) {
  return request<{ items: StageConfig[] }>('/api/v1/config/stages', { method: 'PUT', body: JSON.stringify({ items }) })
}

export function getRepositories() {
  return request<{ items: GiteaRepository[] }>('/api/v1/repositories')
}

export function getIssues(repository: GiteaRepository, page = 1) {
  return request<{ items: GiteaIssue[]; total?: number }>(`/api/v1/repositories/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.name)}/issues?page=${page}`)
}

export type ManagementResult = { stage: string; stage_code: string; sub_stage: string; sub_stage_code: string; priority: string }

export function updateManagement(repository: GiteaRepository, number: number, data: { stage?: string; stageCode?: string; subStage?: string; subStageCode?: string; priority?: string }) {
  return request<ManagementResult>(`/api/v1/repositories/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.name)}/issues/${number}/management`, { method: 'PATCH', body: JSON.stringify(data) })
}

export function batchUpdateManagement(items: Array<{ repository: GiteaRepository; number: number }>, data: { stageCode: string; subStageCode: string }) {
  return request<{ items: Array<ManagementResult & { owner: string; repo: string; number: number }> }>('/api/v1/management/batch', { method: 'POST', body: JSON.stringify({ items: items.map((item) => ({ owner: item.repository.owner, repo: item.repository.name, number: item.number })), ...data }) })
}

export function renderMarkdown(body: string) {
  return request<{ html: string }>('/api/v1/markdown', { method: 'POST', body: JSON.stringify({ body }) })
}

export function getIssueDetail(repository: GiteaRepository, number: number) {
  return request<{ issue: GiteaIssue; comments: GiteaComment[]; history: Array<{ from_stage?: string; to_stage?: string; from_sub_stage?: string; to_sub_stage?: string; from_priority?: string; to_priority?: string; actor_name?: string; actor_login?: string; created_at: string }> }>(`/api/v1/repositories/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.name)}/issues/${number}/detail`)
}

export function uploadIssueAttachment(repository: GiteaRepository, number: number, file: File) {
  const form = new FormData()
  form.append('attachment', file)
  return request<{ uuid?: string; name: string; browser_download_url?: string; download_url?: string }>(`/api/v1/repositories/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.name)}/issues/${number}/assets`, { method: 'POST', body: form })
}

export function addIssueComment(repository: GiteaRepository, number: number, body: string) {
  return request<GiteaComment>(`/api/v1/repositories/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.name)}/issues/${number}/comments`, { method: 'POST', body: JSON.stringify({ body }) })
}

export function updateIssueDueDate(repository: GiteaRepository, number: number, dueDate: string | null) {
  return request<{ dueDate: string | null }>(`/api/v1/repositories/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.name)}/issues/${number}/due-date`, { method: 'PATCH', body: JSON.stringify({ dueDate }) })
}

export function updateAssignee(repository: GiteaRepository, number: number, assignee: string | null) {
  return request<{ assignee: string }>(`/api/v1/repositories/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.name)}/issues/${number}/assignee`, { method: 'PATCH', body: JSON.stringify({ assignee }) })
}
