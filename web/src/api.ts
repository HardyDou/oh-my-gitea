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

export type ApiAccessToken = { id: number; name: string; token_prefix: string; created_at: string; last_used_at?: string | null; token?: string; message?: string }

export function getMe() {
  return request<{ user: AppUser }>('/auth/me')
}

export function getApiAccessTokens() {
  return request<{ items: ApiAccessToken[] }>('/api/v1/auth/api-tokens')
}

export function createApiAccessToken(name: string) {
  return request<ApiAccessToken>('/api/v1/auth/api-tokens', { method: 'POST', body: JSON.stringify({ name }) })
}

export function revokeApiAccessToken(id: number) {
  return request<{ ok: boolean }>(`/api/v1/auth/api-tokens/${id}`, { method: 'DELETE' })
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

export type Product = { id: number; name: string; description: string | null; created_at: string; updated_at: string }
export type ProductDocSummary = { id: number; title: string; created_at: string; updated_at: string }
export type ProductDoc = ProductDocSummary & { product_id: number; content: string }
export type PrototypeBuild = { id: number; tag: string; status: 'pending' | 'building' | 'success' | 'failed'; log: string | null; created_at: string; finished_at: string | null }
export type Prototype = { id: number; product_id: number; repository_full_name: string; created_at: string; builds: PrototypeBuild[] }

export function getProducts() {
  return request<{ items: Product[] }>('/api/v1/products')
}
export function createProduct(name: string, description: string) {
  return request<Product>('/api/v1/products', { method: 'POST', body: JSON.stringify({ name, description }) })
}
export function updateProduct(id: number, name: string, description: string) {
  return request<Product>(`/api/v1/products/${id}`, { method: 'PUT', body: JSON.stringify({ name, description }) })
}
export function deleteProduct(id: number) {
  return request<{ ok: boolean }>(`/api/v1/products/${id}`, { method: 'DELETE' })
}
export function getDocs(productId: number) {
  return request<{ items: ProductDocSummary[] }>(`/api/v1/products/${productId}/docs`)
}
export function getDocDetail(id: number) {
  return request<ProductDoc>(`/api/v1/docs/${id}`)
}
export function createDoc(productId: number, title: string, content: string) {
  return request<ProductDoc>('/api/v1/docs', { method: 'POST', body: JSON.stringify({ productId, title, content }) })
}
export function updateDoc(id: number, title: string, content: string) {
  return request<ProductDoc>(`/api/v1/docs/${id}`, { method: 'PUT', body: JSON.stringify({ title, content }) })
}
export function deleteDoc(id: number) {
  return request<{ ok: boolean }>(`/api/v1/docs/${id}`, { method: 'DELETE' })
}
export function getPrototypes(productId: number) {
  return request<{ items: Prototype[] }>(`/api/v1/products/${productId}/prototypes`)
}
export function createPrototype(productId: number, repository: string) {
  return request<Prototype>('/api/v1/prototypes', { method: 'POST', body: JSON.stringify({ productId, repository }) })
}
export function deletePrototype(id: number) {
  return request<{ ok: boolean }>(`/api/v1/prototypes/${id}`, { method: 'DELETE' })
}
export function createBuild(prototypeId: number, tag: string) {
  return request<PrototypeBuild>(`/api/v1/prototypes/${prototypeId}/builds`, { method: 'POST', body: JSON.stringify({ tag }) })
}
export function getBuild(id: number) {
  return request<PrototypeBuild>(`/api/v1/builds/${id}`)
}

export type FeatureStatus = 'planned' | 'designing' | 'developing' | 'released' | 'deferred'
export type ReleaseStatus = 'pending' | 'ongoing' | 'released' | 'archived'
export type LinkedFeatureIssue = { owner: string; name: string; number: number; title: string; state: string }
export type ProductFeature = { id: number; product_id: number; release_id: number | null; title: string; description: string; status: FeatureStatus; priority: string; assignee: string | null; created_at: string; updated_at: string; issues: LinkedFeatureIssue[] }
export type ProductRelease = { id: number; product_id: number; name: string; description: string | null; status: ReleaseStatus; target_date: string | null; released_at: string | null; created_at: string; updated_at: string }
export type FeaturePayload = { title?: string; description?: string; status?: FeatureStatus; priority?: string; assignee?: string | null; releaseId?: number | null; issues?: Array<{ owner: string; repo: string; number: number }> }
export type ProductOverview = {
  features: Record<FeatureStatus, number> & { total?: number }
  issues: { total: number; byStage: Record<string, number> }
  nextRelease: ProductRelease | null
  activity: Array<{ action: string; resource: string; payload: any; created_at: string }>
}

export function getProduct(productId: number) {
  return request<{ features: ProductFeature[]; releases: ProductRelease[] }>(`/api/v1/products/${productId}`)
}
export function getFeatures(productId: number) {
  return request<{ items: ProductFeature[] }>(`/api/v1/products/${productId}/features`)
}
export function createFeature(productId: number, data: FeaturePayload) {
  return request<ProductFeature>(`/api/v1/products/${productId}/features`, { method: 'POST', body: JSON.stringify(data) })
}
export function updateFeature(id: number, data: FeaturePayload) {
  return request<ProductFeature>(`/api/v1/features/${id}`, { method: 'PUT', body: JSON.stringify(data) })
}
export function deleteFeature(id: number) {
  return request<{ ok: boolean }>(`/api/v1/features/${id}`, { method: 'DELETE' })
}
export function getReleases(productId: number) {
  return request<{ items: ProductRelease[] }>(`/api/v1/products/${productId}/releases`)
}
export function createRelease(productId: number, data: { name: string; description?: string; targetDate?: string | null }) {
  return request<ProductRelease>(`/api/v1/products/${productId}/releases`, { method: 'POST', body: JSON.stringify(data) })
}
export function updateRelease(id: number, data: { name?: string; description?: string; targetDate?: string | null }) {
  return request<ProductRelease>(`/api/v1/releases/${id}`, { method: 'PUT', body: JSON.stringify(data) })
}
export function setReleaseStatus(id: number, status: ReleaseStatus) {
  return request<ProductRelease>(`/api/v1/releases/${id}/status`, { method: 'POST', body: JSON.stringify({ status }) })
}
export function deleteRelease(id: number) {
  return request<{ ok: boolean }>(`/api/v1/releases/${id}`, { method: 'DELETE' })
}
export function getProductOverview(productId: number) {
  return request<ProductOverview>(`/api/v1/products/${productId}/overview`)
}
export function searchIssues(q: string) {
  return request<{ items: Array<{ owner: string; repo: string; number: number; title: string; state: string }> }>(`/api/v1/issue-search?q=${encodeURIComponent(q)}`)
}
