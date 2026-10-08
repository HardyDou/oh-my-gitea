<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import GiteaSettings from './GiteaSettings.vue'
import { ArrowLeft, Bell, Calendar, Connection, Grid, House, Setting, User, Plus, Refresh, Search } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox, type TagProps } from 'element-plus'
import { addIssueComment, batchUpdateManagement, getIssueDetail, getIssues, getMe, getRepositories, getStageConfig, renderMarkdown, saveStageConfig, updateAssignee, updateIssueDueDate, updateManagement, uploadIssueAttachment, type AppUser, type GiteaComment, type GiteaIssue, type GiteaRepository, type StageConfig } from './api'

type Stage = string
type Priority = 'P0' | 'P1' | 'P2' | 'P3'
type Issue = {
  number: number; title: string; type: '需求' | '缺陷'; stage: Stage; stageCode: string; subStage: string; subStageCode: string; priority: Priority; dueDate: string | null; assets: Array<{ id: number; name: string; size?: number; browser_download_url?: string; download_url?: string }>
  repo: string; project: string; projects: string[]; labels: Array<{ name: string; color?: string }>; milestone: string
  author: string; assignee: string; state: 'open' | 'closed'; updatedAt: string
  description: string; bodyHtml: string; updated: string; repository: GiteaRepository
}

const defaultStageConfig: StageConfig[] = [['requirement', '需求'], ['development', '研发'], ['testing', '测试'], ['archive', '归档']].map(([code, name]) => ({ code, name, substages: [{ code: 'not_started', name: '未开始' }, { code: 'in_progress', name: '进行中' }, { code: 'completed', name: '完成' }] }))
const savedFilters = (() => { try { return JSON.parse(typeof window !== 'undefined' ? window.localStorage.getItem('gitea-pm-filters') ?? '{}' : '{}') as Record<string, any> } catch { return {} } })()
const types = ['全部类型', '需求', '缺陷']
const sorts = ['更新时间（新到旧）', '更新时间（旧到新）', '编号（高到低）', '编号（低到高）']
const states = ['全部', '开放', '已关闭']
const selectedRepo = ref(savedFilters.repo ?? '')
const selectedProject = ref(savedFilters.project ?? '全部项目')
const selectedStage = ref(savedFilters.stage ?? '全部阶段')
const selectedSubStage = ref(savedFilters.subStage ?? '全部状态')
const selectedPriority = ref(savedFilters.priority ?? '全部优先级')
const selectedLabel = ref(savedFilters.label ?? '全部标签')
const selectedMilestone = ref(savedFilters.milestone ?? '全部里程碑')
const selectedAuthor = ref(savedFilters.author ?? '全部作者')
const selectedAssignee = ref(savedFilters.assignee ?? '全部指派人')
const selectedType = ref(savedFilters.type ?? '全部类型')
const updatedRange = ref<string[]>(Array.isArray(savedFilters.updatedRange) ? savedFilters.updatedRange : [])
const sortBy = ref(sorts.includes(savedFilters.sortBy) ? savedFilters.sortBy : sorts[0])
const searchTerm = ref(savedFilters.searchTerm ?? '')
const selectedState = ref(savedFilters.state ?? '全部')
const savedView = typeof window !== 'undefined' ? window.localStorage.getItem('gitea-pm-view') : null
const activeView = ref<'dashboard' | 'board' | 'issues' | 'settings'>(savedView === 'issues' ? 'issues' : savedView === 'dashboard' ? 'dashboard' : 'board')
const currentPage = ref(1)
const pageSize = ref(20)
const boardLimits = ref<Record<string, number>>({})
const selectedIssue = ref<Issue | null>(null)
const drawerVisible = ref(false)
const detailMode = ref(false)
const detailLoading = ref(false)
const detailComments = ref<GiteaComment[]>([])
const detailHistory = ref<Array<{ from_stage?: string; to_stage?: string; from_sub_stage?: string; to_sub_stage?: string; from_priority?: string; to_priority?: string; actor_name?: string; actor_login?: string; created_at: string }>>([])
const commentText = ref('')
const commentMode = ref<'write' | 'preview'>('write')
const commentHtml = ref('')
const commentPreviewError = ref('')
const commentPermissionError = ref(false)
const previewLoading = ref(false)
const attachmentInput = ref<HTMLInputElement | null>(null)
const commentTextarea = ref<HTMLTextAreaElement | null>(null)
const draggedIssue = ref<Issue | null>(null)
const boardFocusStage = ref<string | null>(null)
const collapsedColumns = ref<Record<string, boolean>>({})
const loading = ref(true)
const authRequired = ref(false)
const loadError = ref('')
const repositories = ref<GiteaRepository[]>([])
const currentUser = ref<AppUser | null>(null)
const stageConfig = ref<StageConfig[]>(defaultStageConfig)
const stageDraft = ref<StageConfig[]>([])
const stageSaving = ref(false)
const settingsSection = ref('gitea')
const codeEditKeys = ref<Record<string, boolean>>({})
const draggedStageIndex = ref<number | null>(null)
const draggedSubstage = ref<{ stageIndex: number; substageIndex: number } | null>(null)
const issues = ref<Issue[]>([])
const sourceIssueTotals = ref<Record<string, number>>({})
const selectedIssues = ref<Issue[]>([])
const batchDialogVisible = ref(false)
const batchSaving = ref(false)
const batchStageCode = ref('')
const batchSubStageCode = ref('')

const stages = computed(() => stageConfig.value.map((stage) => stage.name))
const boardColumns = computed(() => boardFocusStage.value ? stageConfig.value.find((stage) => stage.name === boardFocusStage.value)?.substages.map((substage) => substage.name) ?? [] : stages.value)
const pageTitle = computed(() => activeView.value === 'settings' ? '系统配置' : activeView.value === 'dashboard' ? '工作台' : '项目看板')
const selectedIssueSubstages = computed(() => stageConfig.value.find((stage) => stage.name === selectedIssue.value?.stage)?.substages ?? [])
const batchSubstages = computed(() => stageConfig.value.find((stage) => stage.code === batchStageCode.value)?.substages ?? [])
const checklistItems = computed(() => { const body = selectedIssue.value?.description ?? ''; return [...body.matchAll(/^- \[([ xX])\] (.+)$/gm)].map((match) => ({ done: match[1].toLowerCase() === 'x', text: match[2] })) })
const pagedIssues = computed(() => visibleIssues.value.slice((currentPage.value - 1) * pageSize.value, currentPage.value * pageSize.value))
const hasOnlyStateFilter = computed(() => !searchTerm.value && Boolean(selectedRepo.value) && selectedProject.value === '全部项目' && selectedStage.value === '全部阶段' && selectedSubStage.value === '全部状态' && selectedPriority.value === '全部优先级' && selectedLabel.value === '全部标签' && selectedMilestone.value === '全部里程碑' && selectedAuthor.value === '全部作者' && selectedAssignee.value === '全部指派人' && selectedType.value === '全部类型' && updatedRange.value.length !== 2)
const issueDisplayTotal = computed(() => hasOnlyStateFilter.value && selectedState.value === '全部' && sourceIssueTotals.value[selectedRepo.value] !== undefined ? sourceIssueTotals.value[selectedRepo.value] : visibleIssues.value.length)
function sameUser(left: string | undefined, right: string | undefined) { return Boolean(left && right && left.trim().toLowerCase() === right.trim().toLowerCase()) }
const repositoryIssues = computed(() => issues.value.filter((issue) => !selectedRepo.value || issue.repo === selectedRepo.value))
const myIssues = computed(() => repositoryIssues.value.filter((issue) => sameUser(issue.assignee, currentUser.value?.login)).sort((a, b) => (a.state === 'open' ? 0 : 1) - (b.state === 'open' ? 0 : 1) || (a.updatedAt < b.updatedAt ? 1 : -1)).slice(0, 8))
const upcomingIssues = computed(() => { const today = new Date().toISOString().slice(0, 10); return repositoryIssues.value.filter((issue) => issue.state === 'open' && issue.dueDate && issue.dueDate >= today).sort((a, b) => (a.dueDate ?? '').localeCompare(b.dueDate ?? '')).slice(0, 20) })
const recentIssues = computed(() => [...repositoryIssues.value].sort((a, b) => a.updatedAt < b.updatedAt ? 1 : -1).slice(0, 8))
const readNotificationKeys = ref<string[]>(JSON.parse(typeof window !== 'undefined' ? window.localStorage.getItem('gitea-pm-read-notifications') ?? '[]' : '[]'))
const notifications = computed(() => {
  const login = currentUser.value?.login
  return repositoryIssues.value.filter((issue) => issue.state === 'open' && ((sameUser(issue.assignee, login) || (login && `${issue.title} ${issue.description}`.toLowerCase().includes(`@${login.toLowerCase()}`))))).slice(0, 8).map((issue) => ({ key: `${issue.repo}#${issue.number}`, issue, text: sameUser(issue.assignee, login) ? '你被指派了该 Issue' : 'Issue 中提到了你' }))
})
const unreadNotifications = computed(() => notifications.value.filter((item) => !readNotificationKeys.value.includes(item.key)))
const repos = computed(() => repositories.value.map((item) => item.full_name))
const projects = computed(() => ['全部项目', ...Array.from(new Set(repositoryIssues.value.flatMap((item) => item.projects))).filter(Boolean)])
const labels = computed(() => ['全部标签', ...Array.from(new Set(repositoryIssues.value.flatMap((item) => item.labels.map((label) => label.name)))).filter(Boolean)])
const milestones = computed(() => ['全部里程碑', ...Array.from(new Set(repositoryIssues.value.map((item) => item.milestone))).filter((item) => item !== '无')])
const authors = computed(() => ['全部作者', ...Array.from(new Set(repositoryIssues.value.map((item) => item.author))).filter(Boolean)])
const assignees = computed(() => ['全部指派人', ...Array.from(new Set(repositoryIssues.value.map((item) => item.assignee))).filter(Boolean)])
const stageFilters = computed(() => ['全部阶段', ...stages.value])
const subStageFilters = computed(() => ['全部状态', ...Array.from(new Set((selectedStage.value === '全部阶段' ? stageConfig.value.flatMap((stage) => stage.substages) : stageConfig.value.find((stage) => stage.name === selectedStage.value)?.substages ?? []).map((substage) => substage.name)))])

function formatDate(value?: string | null) { if (!value) return '未设置'; const date = new Date(value); if (Number.isNaN(date.getTime())) return value; return new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(date).replace(/\//g, '-') }
function formatDateOnly(value?: string | null) { if (!value) return '未设置'; return value.slice(0, 10) }
function mapIssue(issue: GiteaIssue, repository: GiteaRepository): Issue {
  const projectNames = issue.projects?.map((item) => item.title).filter(Boolean) ?? []
  const updatedAt = issue.updated_at ?? ''
  return {
    number: issue.number,
    title: issue.title,
    type: issue.type === 'bug' ? '缺陷' : '需求',
    stage: issue.management?.stage ?? stageConfig.value[0]?.name ?? '需求',
    stageCode: issue.management?.stage_code ?? stageConfig.value[0]?.code ?? 'requirement',
    subStage: issue.management?.sub_stage ?? stageConfig.value[0]?.substages[0]?.name ?? '未开始',
    subStageCode: issue.management?.sub_stage_code ?? stageConfig.value[0]?.substages[0]?.code ?? 'not_started',
    priority: (issue.management?.priority as Priority) ?? 'P2',
    dueDate: issue.due_date ? formatDateOnly(issue.due_date) : null,
    assets: issue.assets ?? [],
    repo: repository.full_name,
    project: projectNames[0] ?? '未归属项目',
    projects: projectNames,
    labels: issue.labels?.map((item) => ({ name: item.name, color: item.color })) ?? [],
    milestone: issue.milestone?.title ?? '无',
    author: issue.user?.login ?? '未知作者',
    assignee: issue.assignee?.login ?? issue.assignees?.[0]?.login ?? '未分配',
    state: issue.state === 'closed' ? 'closed' : 'open',
    updatedAt,
    description: issue.body ?? '暂无描述',
    bodyHtml: issue.body_html ?? '',
    updated: updatedAt ? formatDate(updatedAt) : '未知',
    repository,
  }
}

async function getAllRepositoryIssues(repository: GiteaRepository) {
  const all: GiteaIssue[] = []
  const seen = new Set<number>()
  let total: number | undefined
  // 不再限制 10 页，避免仓库超过 1000 条 Issue 时总数被截断；最多 1000 页仅作为异常响应保护。
  for (let page = 1; page <= 1000; page += 1) {
    const result = await getIssues(repository, page)
    total ??= result.total
    for (const issue of result.items) if (!seen.has(issue.number)) { seen.add(issue.number); all.push(issue) }
    // 实际分页大小由 Gitea 实例控制，可能只有 50 条；总数达到响应头即停止。
    if (!result.items.length || (total !== undefined && all.length >= total)) break
  }
  return { items: all, total: total ?? all.length }
}

async function loadSelectedRepository() {
  const repository = repositories.value.find((item) => item.full_name === selectedRepo.value)
  if (!repository) { issues.value = []; return }
  loading.value = true
  loadError.value = ''
  try {
    const response = await getAllRepositoryIssues(repository)
    sourceIssueTotals.value = { ...sourceIssueTotals.value, [repository.full_name]: response.total }
    issues.value = response.items.map((issue) => mapIssue(issue, repository))
    selectedIssues.value = []
  } catch (error) {
    const typed = error as Error & { status?: number }
    authRequired.value = typed.status === 401
    loadError.value = typed.message
  } finally { loading.value = false }
}

async function loadData() {
  loading.value = true
  loadError.value = ''
  authRequired.value = false
  try {
    const me = await getMe()
    currentUser.value = me.user
    const stageResult = await getStageConfig()
    stageConfig.value = stageResult.items.length ? stageResult.items : defaultStageConfig
    const result = await getRepositories()
    repositories.value = result.items
    const match = window.location.pathname.match(/^\/([^/]+)\/([^/]+)\/issues\/(\d+)$/)
    const routeRepository = match ? `${match[1]}/${match[2]}` : ''
    if (routeRepository && result.items.some((repository) => repository.full_name === routeRepository)) selectedRepo.value = routeRepository
    else if (!selectedRepo.value || !result.items.some((repository) => repository.full_name === selectedRepo.value)) selectedRepo.value = result.items[0]?.full_name ?? ''
    await loadSelectedRepository()
    if (match) {
      const target = issues.value.find((issue) => issue.repository.owner === match[1] && issue.repository.name === match[2] && issue.number === Number(match[3]))
      if (target) await openIssue(target)
    }
  } catch (error) {
    const typed = error as Error & { status?: number }
    authRequired.value = typed.status === 401
    loadError.value = typed.message
  } finally {
    loading.value = false
  }
}

const filteredIssues = computed(() => issues.value.filter((issue) => {
  const textMatch = !searchTerm.value || `${issue.number} ${issue.title} ${issue.labels.map((label) => label.name).join(' ')}`.toLowerCase().includes(searchTerm.value.toLowerCase())
  const dateMatch = updatedRange.value.length !== 2 || (issue.updatedAt >= updatedRange.value[0] && issue.updatedAt <= updatedRange.value[1])
  return textMatch && dateMatch
    && issue.repo === selectedRepo.value
    && (selectedProject.value === '全部项目' || issue.projects.includes(selectedProject.value))
    && (selectedStage.value === '全部阶段' || issue.stage === selectedStage.value)
    && (selectedSubStage.value === '全部状态' || issue.subStage === selectedSubStage.value)
    && (selectedPriority.value === '全部优先级' || issue.priority === selectedPriority.value)
    && (selectedLabel.value === '全部标签' || issue.labels.some((label) => label.name === selectedLabel.value))
    && (selectedMilestone.value === '全部里程碑' || issue.milestone === selectedMilestone.value)
    && (selectedAuthor.value === '全部作者' || issue.author === selectedAuthor.value)
    && (selectedAssignee.value === '全部指派人' || issue.assignee === selectedAssignee.value)
    && (selectedType.value === '全部类型' || issue.type === selectedType.value)
}))
const stateCounts = computed(() => ({
  全部: filteredIssues.value.length,
  开放: filteredIssues.value.filter((issue) => issue.state === 'open').length,
  已关闭: filteredIssues.value.filter((issue) => issue.state === 'closed').length,
}))
function stateCount(state: string) { return stateCounts.value[state as keyof typeof stateCounts.value] }
const visibleIssues = computed(() => {
  const filtered = filteredIssues.value.filter((issue) => selectedState.value === '全部' || (selectedState.value === '开放' && issue.state === 'open') || (selectedState.value === '已关闭' && issue.state === 'closed'))
  return [...filtered].sort((a, b) => sortBy.value === sorts[0] ? b.updatedAt.localeCompare(a.updatedAt) : sortBy.value === sorts[1] ? a.updatedAt.localeCompare(b.updatedAt) : sortBy.value === sorts[2] ? b.number - a.number : a.number - b.number)
})

function openDashboard() { activeView.value = 'dashboard' }
function openNotification(item: { key: string; issue: Issue }) { if (!readNotificationKeys.value.includes(item.key)) { readNotificationKeys.value.push(item.key); window.localStorage.setItem('gitea-pm-read-notifications', JSON.stringify(readNotificationKeys.value)) }; openIssue(item.issue) }
function boardTotal(column: string) { return visibleIssues.value.filter((issue) => boardFocusStage.value ? issue.stage === boardFocusStage.value && issue.subStage === column : issue.stage === column).length }
function boardItems(column: string) { return visibleIssues.value.filter((issue) => boardFocusStage.value ? issue.stage === boardFocusStage.value && issue.subStage === column : issue.stage === column).slice(0, boardLimits.value[column] ?? 20) }
function enterBoardStage(stage: string) { if (!boardFocusStage.value) boardFocusStage.value = stage }
function toggleColumn(stage: string) { collapsedColumns.value[stage] = !collapsedColumns.value[stage] }
function leaveBoardStage() { boardFocusStage.value = null }
function loadMore(stage: string) { boardLimits.value[stage] = (boardLimits.value[stage] ?? 20) + 20 }
function onColumnScroll(column: string, event: Event) {
  const element = event.currentTarget as HTMLElement
  const total = boardTotal(column)
  if (element.scrollTop + element.clientHeight >= element.scrollHeight - 80 && (boardLimits.value[column] ?? 20) < total) loadMore(column)
}
async function openIssue(issue: Issue) {
  // 详情页不改变当前展示模式；从列表进入后返回仍保持列表模式。
  selectedIssue.value = issue
  detailMode.value = true
  detailLoading.value = true
  await nextTick()
  try {
    const detail = await getIssueDetail(issue.repository, issue.number)
    issue.description = detail.issue.body ?? '暂无描述'
    issue.bodyHtml = detail.issue.body_html ?? ''
    issue.stage = detail.issue.management.stage as Stage
    issue.stageCode = detail.issue.management.stage_code ?? issue.stageCode
    issue.subStage = detail.issue.management.sub_stage ?? issue.subStage
    issue.subStageCode = detail.issue.management.sub_stage_code ?? issue.subStageCode
    issue.priority = detail.issue.management.priority as Priority
    issue.dueDate = detail.issue.due_date?.slice(0, 10) ?? null
    issue.assets = detail.issue.assets ?? []
    detailComments.value = detail.comments
    detailHistory.value = detail.history
    selectedIssue.value.subStage = detail.issue.management.sub_stage ?? selectedIssue.value.subStage
  } catch (error) {
    ElMessage.error((error as Error).message || 'Issue 详情加载失败')
  } finally { detailLoading.value = false }
}
function closeDetail() { detailMode.value = false; selectedIssue.value = null; detailComments.value = []; detailHistory.value = []; commentText.value = ''; commentHtml.value = ''; commentPreviewError.value = ''; commentMode.value = 'write' }
async function previewComment() {
  await nextTick()
  commentMode.value = 'preview'
  commentPreviewError.value = ''
  previewLoading.value = true
  try { commentHtml.value = (await renderMarkdown(commentText.value)).html } catch (error) { commentPreviewError.value = (error as Error).message || '预览失败' } finally { previewLoading.value = false }
}
async function editComment() { commentMode.value = 'write'; await nextTick(); commentTextarea.value?.focus() }
async function insertMarkdown(before: string, after = '', placeholder = '文本') {
  const textarea = document.querySelector('.comment-editor textarea') as HTMLTextAreaElement | null
  const start = textarea?.selectionStart ?? commentText.value.length
  const end = textarea?.selectionEnd ?? start
  const selected = commentText.value.slice(start, end) || placeholder
  commentText.value = commentText.value.slice(0, start) + before + selected + after + commentText.value.slice(end)
  await nextTick()
  textarea?.focus()
  textarea?.setSelectionRange(start + before.length, start + before.length + selected.length)
}
function chooseAttachment() { attachmentInput.value?.click() }
async function uploadAttachment(event: Event) {
  const target = event.target as HTMLInputElement
  const file = target.files?.[0] ?? (event as DragEvent).dataTransfer?.files?.[0]
  if (!file || !selectedIssue.value) return
  try {
    const asset = await uploadIssueAttachment(selectedIssue.value.repository, selectedIssue.value.number, file)
    const url = asset.browser_download_url ?? asset.download_url
    if (url) commentText.value += `\n${file.type.startsWith('image/') ? `![${file.name}](${url})` : `[${file.name}](${url})`}\n`
    ElMessage.success('附件已上传')
  } catch (error) { ElMessage.error((error as Error).message || '附件上传失败') }
  if (target.files) target.value = ''
}
async function submitComment() {
  if (!selectedIssue.value || !commentText.value.trim()) return
  commentPermissionError.value = false
  try {
    const comment = await addIssueComment(selectedIssue.value.repository, selectedIssue.value.number, commentText.value.trim())
    detailComments.value.push(comment)
    commentText.value = ''
    commentHtml.value = ''
    commentPreviewError.value = ''
    commentMode.value = 'write'
    ElMessage.success('评论已发布')
  } catch (error) {
    const message = (error as Error).message || '评论发布失败'
    commentPermissionError.value = message.includes('write:issue')
    ElMessage.error(commentPermissionError.value ? '当前 Gitea 授权缺少“写入 Issue”权限，请重新登录授权后再发表评论' : message)
  }
}
function priorityType(priority: Priority): TagProps['type'] { return priority === 'P0' ? 'danger' : priority === 'P1' ? 'warning' : priority === 'P2' ? 'primary' : 'info' }
function labelStyle(label: { color?: string }) { const value = (label.color ?? 'eef4ff').replace(/^#/, '').padEnd(6, '0'); const r = parseInt(value.slice(0, 2), 16) || 57; const g = parseInt(value.slice(2, 4), 16) || 113; const b = parseInt(value.slice(4, 6), 16) || 211; return { backgroundColor: `#${value}`, borderColor: `#${value}`, color: (r * 299 + g * 587 + b * 114) / 1000 > 150 ? '#25344d' : '#fff' } }
function nextStages(stage: Stage): Stage[] { return stages.value.filter((candidate) => candidate !== stage) }
function changeSelectedStage(stage: string) { if (selectedIssue.value) { const config = stageConfig.value.find((item) => item.name === stage); selectedIssue.value.stageCode = config?.code ?? ''; selectedIssue.value.subStage = config?.substages[0]?.name ?? ''; selectedIssue.value.subStageCode = config?.substages[0]?.code ?? '' } }
function changeSelectedSubstage(name: string) { if (selectedIssue.value) selectedIssue.value.subStageCode = selectedIssueSubstages.value.find((substage) => substage.name === name)?.code ?? '' }
async function quickAssign(issue: Issue, assignee: string) {
  try {
    const result = await updateAssignee(issue.repository, issue.number, assignee === '未分配' ? null : assignee)
    issue.assignee = result.assignee
    ElMessage.success(`Issue #${issue.number} 已指派给 ${result.assignee}`)
  } catch (error) {
    ElMessage.error((error as Error).message || '指派失败')
  }
}
async function quickUpdate(issue: Issue, data: { stage?: Stage; stageCode?: string; subStage?: string; subStageCode?: string; priority?: Priority }) {
  try {
    const result = await updateManagement(issue.repository, issue.number, data)
    issue.stage = result.stage
    issue.stageCode = result.stage_code
    issue.subStage = result.sub_stage
    issue.subStageCode = result.sub_stage_code
    issue.priority = result.priority as Priority
    ElMessage.success(`Issue #${issue.number} 已更新`)
  } catch (error) {
    ElMessage.error((error as Error).message || '更新失败')
  }
}
function startDrag(issue: Issue) { draggedIssue.value = issue }
async function dropIssue(column: string) {
  const issue = draggedIssue.value
  draggedIssue.value = null
  if (!issue) return
  if (boardFocusStage.value) {
    if (issue.stage !== boardFocusStage.value || issue.subStage === column) return
    await quickUpdate(issue, { subStageCode: stageConfig.value.find((stage) => stage.name === issue.stage)?.substages.find((substage) => substage.name === column)?.code, subStage: column })
  } else {
    if (issue.stage === column) return
    await quickUpdate(issue, { stage: column, stageCode: stageConfig.value.find((item) => item.name === column)?.code })
  }
}
function setStageFilter(stage: string) { selectedStage.value = stage; selectedSubStage.value = '全部状态' }
function resetFilters() { searchTerm.value = ''; selectedState.value = '全部'; selectedRepo.value = repos.value[0] ?? ''; selectedProject.value = '全部项目'; selectedStage.value = '全部阶段'; selectedSubStage.value = '全部状态'; selectedPriority.value = '全部优先级'; selectedLabel.value = '全部标签'; selectedMilestone.value = '全部里程碑'; selectedAuthor.value = '全部作者'; selectedAssignee.value = '全部指派人'; selectedType.value = '全部类型'; updatedRange.value = []; sortBy.value = sorts[0]; currentPage.value = 1 }
function setBatchStage(code: string) { batchStageCode.value = code; batchSubStageCode.value = stageConfig.value.find((stage) => stage.code === code)?.substages[0]?.code ?? '' }
function openBatchDialog() {
  if (!selectedIssues.value.length) return
  const commonStage = selectedIssues.value.every((issue) => issue.stageCode === selectedIssues.value[0].stageCode) ? selectedIssues.value[0].stageCode : stageConfig.value[0]?.code ?? ''
  setBatchStage(commonStage)
  batchDialogVisible.value = true
}
function onSelectionChange(rows: Issue[]) { selectedIssues.value = rows }
function updateLocalIssue(issue: Issue, result: { stage: string; stage_code: string; sub_stage: string; sub_stage_code: string; priority: string }) {
  issue.stage = result.stage; issue.stageCode = result.stage_code; issue.subStage = result.sub_stage; issue.subStageCode = result.sub_stage_code; issue.priority = result.priority as Priority
}
async function saveBatchManagement() {
  const stage = stageConfig.value.find((item) => item.code === batchStageCode.value)
  const substage = stage?.substages.find((item) => item.code === batchSubStageCode.value)
  if (!stage || !substage || !selectedIssues.value.length) return
  try {
    await ElMessageBox.confirm(`确定将选中的 ${selectedIssues.value.length} 个 Issue 设置为「${stage.name} / ${substage.name}」吗？`, '批量修改阶段/状态', { type: 'warning', confirmButtonText: '确认修改', cancelButtonText: '取消' })
  } catch { return }
  batchSaving.value = true
  try {
    // 一次请求提交全部选中 Issue，由后端统一校验、复用仓库上下文并在一个事务中更新。
    const result = await batchUpdateManagement(selectedIssues.value, { stageCode: stage.code, subStageCode: substage.code })
    for (const updated of result.items) {
      const issue = selectedIssues.value.find((item) => item.repository.owner === updated.owner && item.repository.name === updated.repo && item.number === updated.number)
      if (issue) updateLocalIssue(issue, updated)
    }
    const success = result.items.length
    selectedIssues.value = []
    batchDialogVisible.value = false
    ElMessage.success(`已批量修改 ${success} 个 Issue 的阶段/状态`)
  } catch (error) {
    ElMessage.error((error as Error).message || '批量修改失败，未提交任何 Issue')
  } finally { batchSaving.value = false }
}
async function login() { try { await fetch('/auth/logout', { method: 'POST', credentials: 'include' }) } finally { window.location.href = '/auth/gitea' } }
function cloneStageConfig(items: StageConfig[]) { return items.map((stage) => ({ id: stage.id, code: stage.code, name: stage.name, substages: stage.substages.map((substage) => ({ id: substage.id, code: substage.code, name: substage.name })) })) }
function openStageSettings() { stageDraft.value = cloneStageConfig(stageConfig.value); detailMode.value = false; activeView.value = 'settings' }
async function giteaSettingsSaved() {
  currentUser.value = null; issues.value = []; repositories.value = []; sourceIssueTotals.value = {}; selectedRepo.value = ''; selectedIssue.value = null; drawerVisible.value = false
  authRequired.value = true; loadError.value = ''; readNotificationKeys.value = []
  await loadData()
}
async function initializePage() {
  try {
    const response = await fetch('/api/v1/setup/status', { cache: 'no-store' })
    if (response.ok && !(await response.json()).configured) {
      openStageSettings(); authRequired.value = true; loading.value = false; return
    }
  } catch { /* 由 loadData 展示连接失败信息 */ }
  await loadData()
}
function addStage() { stageDraft.value.push({ code: `stage_${stageDraft.value.length + 1}`, name: `阶段${stageDraft.value.length + 1}`, substages: [{ code: 'not_started', name: '未开始' }, { code: 'in_progress', name: '进行中' }, { code: 'completed', name: '完成' }] }) }
function codeKey(id: number | undefined, index: number) { return String(id ?? `new-${index}`) }
function toggleCodeEdit(key: string) { codeEditKeys.value[key] = !codeEditKeys.value[key] }
async function removeStage(index: number) { if (stageDraft.value.length <= 1) return; try { await ElMessageBox.confirm('删除阶段前会检查是否仍有 Issue 使用它，是否继续？', '确认删除阶段', { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' }); stageDraft.value.splice(index, 1) } catch {} }
function addSubstage(stage: StageConfig) { stage.substages.push({ code: `substage_${stage.substages.length + 1}`, name: `子阶段${stage.substages.length + 1}` }) }
async function removeSubstage(stage: StageConfig, index: number) { if (stage.substages.length <= 1) return; try { await ElMessageBox.confirm('删除子阶段前会检查是否仍有 Issue 使用它，是否继续？', '确认删除子阶段', { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' }); stage.substages.splice(index, 1) } catch {} }
function moveStage(from: number, to: number) { if (from === to) return; const [item] = stageDraft.value.splice(from, 1); stageDraft.value.splice(to, 0, item) }
function moveSubstage(stageIndex: number, from: number, to: number) { if (from === to) return; const list = stageDraft.value[stageIndex].substages; const [item] = list.splice(from, 1); list.splice(to, 0, item) }
function startStageDrag(index: number, event?: DragEvent) { draggedStageIndex.value = index; if (event?.dataTransfer) { event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', String(index)) } }
function dropStage(index: number) { if (draggedStageIndex.value !== null) moveStage(draggedStageIndex.value, index); draggedStageIndex.value = null }
function startSubstageDrag(stageIndex: number, substageIndex: number, event?: DragEvent) { draggedSubstage.value = { stageIndex, substageIndex }; if (event?.dataTransfer) { event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', `${stageIndex}:${substageIndex}`) } }
function dropSubstage(stageIndex: number, substageIndex: number) { if (draggedSubstage.value?.stageIndex === stageIndex) moveSubstage(stageIndex, draggedSubstage.value.substageIndex, substageIndex); draggedSubstage.value = null }
async function saveStageSettings() {
  stageSaving.value = true
  try {
    const result = await saveStageConfig(stageDraft.value)
    stageConfig.value = result.items
    for (const issue of issues.value) { const stage = result.items.find((item) => item.code === issue.stageCode); const substage = stage?.substages.find((item) => item.code === issue.subStageCode); if (stage) issue.stage = stage.name; if (substage) issue.subStage = substage.name }
    if (selectedIssue.value) { const stage = result.items.find((item) => item.code === selectedIssue.value?.stageCode); const substage = stage?.substages.find((item) => item.code === selectedIssue.value?.subStageCode); if (stage) selectedIssue.value.stage = stage.name; if (substage) selectedIssue.value.subStage = substage.name }
    await loadData()
    ElMessage.success('阶段配置已保存'); activeView.value = 'board'
  } catch (error) { ElMessage.error((error as Error).message || '阶段配置保存失败') } finally { stageSaving.value = false }
}

async function saveManagement() {
  if (!selectedIssue.value) return
  try {
    const result = await updateManagement(selectedIssue.value.repository, selectedIssue.value.number, { stageCode: selectedIssue.value.stageCode, stage: selectedIssue.value.stage, subStageCode: selectedIssue.value.subStageCode, subStage: selectedIssue.value.subStage, priority: selectedIssue.value.priority })
    const dueDateResult = await updateIssueDueDate(selectedIssue.value.repository, selectedIssue.value.number, selectedIssue.value.dueDate)
    selectedIssue.value.stage = result.stage
    selectedIssue.value.stageCode = result.stage_code
    selectedIssue.value.subStage = result.sub_stage
    selectedIssue.value.subStageCode = result.sub_stage_code
    selectedIssue.value.priority = result.priority as Priority
    selectedIssue.value.dueDate = dueDateResult.dueDate
    const local = issues.value.find((item) => item.repository.id === selectedIssue.value?.repository.id && item.number === selectedIssue.value?.number)
    if (local) { local.stage = selectedIssue.value.stage; local.stageCode = selectedIssue.value.stageCode; local.subStage = selectedIssue.value.subStage; local.subStageCode = selectedIssue.value.subStageCode; local.priority = selectedIssue.value.priority; local.dueDate = selectedIssue.value.dueDate }
    ElMessage.success('管理属性已保存')
  } catch (error) {
    const message = (error as Error).message || '保存失败'
    ElMessage.error(message.includes('write:issue') ? '当前 Gitea 授权缺少写入 Issue 权限，请重新授权' : message)
  }
}

watch(selectedRepo, (value, oldValue) => { selectedIssues.value = []; currentPage.value = 1; if (value && value !== oldValue && repositories.value.length && !loading.value) void loadSelectedRepository() })
watch([selectedRepo, selectedProject, selectedStage, selectedSubStage, selectedPriority, selectedLabel, selectedMilestone, selectedAuthor, selectedAssignee, selectedType, updatedRange, sortBy, searchTerm, selectedState], () => {
  window.localStorage.setItem('gitea-pm-filters', JSON.stringify({ repo: selectedRepo.value, project: selectedProject.value, stage: selectedStage.value, subStage: selectedSubStage.value, priority: selectedPriority.value, label: selectedLabel.value, milestone: selectedMilestone.value, author: selectedAuthor.value, assignee: selectedAssignee.value, type: selectedType.value, updatedRange: updatedRange.value, sortBy: sortBy.value, searchTerm: searchTerm.value, state: selectedState.value }))
}, { deep: true })
watch(visibleIssues, () => { currentPage.value = 1; boardLimits.value = Object.fromEntries([...stages.value, ...stageConfig.value.flatMap((stage) => stage.substages.map((substage) => substage.name))].map((column) => [column, 20])) })
watch(activeView, (view) => { window.localStorage.setItem('gitea-pm-view', view) })
onMounted(initializePage)
</script>

<template>
  <el-container class="app-shell">
    <aside class="sidebar"><div class="brand"><span class="brand-mark">G</span><span>Gitea PM</span></div><nav class="nav"><div class="nav-title">工作台</div><div class="nav-item" :class="{ active: activeView === 'dashboard' }" @click="openDashboard"><el-icon><House /></el-icon><span>工作台首页</span></div><div class="nav-item" :class="{ active: activeView === 'board' || activeView === 'issues' }" @click="activeView = 'board'"><el-icon><Grid /></el-icon><span>项目看板</span></div><div class="nav-title settings-nav-title">系统</div><div class="nav-item" :class="{ active: activeView === 'settings' }" @click="openStageSettings"><el-icon><Setting /></el-icon><span>系统配置</span></div></nav><div class="sidebar-foot">Gitea PM<br />v0.1.0</div></aside>
    <el-container class="main">
      <header class="topbar"><div class="topbar-left"><span class="page-title">{{ pageTitle }}</span><el-select v-if="repos.length" v-model="selectedRepo" class="repo-select" filterable placeholder="选择仓库" aria-label="选择仓库"><template #prefix>仓库</template><el-option v-for="repo in repos" :key="repo" :label="repo" :value="repo" /></el-select><el-tag type="info" effect="plain">Gitea 数据源</el-tag></div><div class="topbar-right"><el-popover placement="bottom-end" :width="340" trigger="click"><template #reference><button class="notification-button" title="通知"><el-icon><Bell /></el-icon><el-badge v-if="unreadNotifications.length" :value="unreadNotifications.length" :max="9" /></button></template><div class="notification-panel"><div class="notification-title">通知</div><div v-if="notifications.length === 0" class="muted">暂无新通知</div><button v-for="item in notifications" :key="item.key" class="notification-item" :class="{ unread: !readNotificationKeys.includes(item.key) }" @click="openNotification(item)"><strong>#{{ item.issue.number }} {{ item.issue.title }}</strong><span>{{ item.text }}</span></button></div></el-popover><div class="user"><el-avatar :size="30" :src="currentUser?.avatar_url ?? undefined" :icon="User" /><span>{{ currentUser?.display_name || currentUser?.login || '用户' }}</span></div></div></header>
      <main class="content">
        <div v-if="authRequired && activeView !== 'settings'" class="auth-state"><h2>请先登录 Gitea</h2><p>使用 Gitea OAuth 登录后才能加载仓库和 Issue。</p><el-button type="primary" @click="login">登录 Gitea</el-button></div>
        <div v-else-if="loadError && activeView !== 'settings'" class="auth-state"><h2>数据加载失败</h2><p>{{ loadError }}</p><el-button @click="loadData">重试</el-button></div>
        <template v-else>
          <template v-if="activeView === 'dashboard'"><section class="dashboard-page"><div class="dashboard-heading"><div><h1>工作台</h1><p>集中查看与你相关的任务、截止日期和最近动态。</p></div><el-button @click="loadData"><el-icon><Refresh /></el-icon>刷新</el-button></div><div class="dashboard-stats"><div class="dashboard-stat"><span>我的待办</span><strong>{{ myIssues.length }}</strong></div><div class="dashboard-stat"><span>即将到期</span><strong>{{ upcomingIssues.length }}</strong></div><div class="dashboard-stat"><span>最近更新</span><strong>{{ recentIssues.length }}</strong></div><div class="dashboard-stat"><span>未读通知</span><strong>{{ unreadNotifications.length }}</strong></div></div><div class="dashboard-grid"><section class="dashboard-card"><h2>我的待办</h2><p class="dashboard-card-desc">当前账户（{{ currentUser?.login || '未登录' }}）被指派的 Issue</p><button v-for="issue in myIssues" :key="issue.repo + issue.number" class="dashboard-issue" @click="openIssue(issue)"><span>#{{ issue.number }} {{ issue.title }}</span><el-tag size="small" :type="issue.state === 'open' ? 'primary' : 'info'">{{ issue.state === 'open' ? '开放' : '已关闭' }}</el-tag></button><div v-if="myIssues.length === 0" class="dashboard-empty"><strong>0</strong><span>暂无指派给你的开放 Issue</span></div></section><section class="dashboard-card"><h2>即将到期</h2><p class="dashboard-card-desc">已设置截止日期且尚未到期的开放 Issue</p><button v-for="issue in upcomingIssues" :key="issue.repo + issue.number" class="dashboard-issue" @click="openIssue(issue)"><span class="dashboard-issue-main"><strong>#{{ issue.number }}</strong><span>{{ issue.title }}</span><small>{{ issue.repo }}</small></span><span class="dashboard-issue-meta"><el-tag size="small">{{ issue.stage }}</el-tag><b>{{ issue.dueDate }}</b></span></button><div v-if="upcomingIssues.length === 0" class="dashboard-empty"><strong>0</strong><span>暂无即将到期的 Issue</span></div></section><section class="dashboard-card dashboard-wide"><h2>最近更新</h2><p class="dashboard-card-desc">最近发生变更的 Issue，点击可查看详情</p><button v-for="issue in recentIssues" :key="issue.repo + issue.number" class="dashboard-issue" @click="openIssue(issue)"><span>#{{ issue.number }} {{ issue.title }}</span><small>{{ issue.updated }}</small></button></section></div></section></template>
          <template v-else-if="detailMode && selectedIssue">
            <div v-loading="detailLoading" class="issue-detail-page">
              <div class="detail-top"><div class="detail-back" @click="closeDetail"><el-button circle><el-icon><ArrowLeft /></el-icon></el-button><strong>返回 Issue 列表</strong></div><el-button plain @click="selectedIssue && openIssue(selectedIssue)"><el-icon><Refresh /></el-icon>刷新</el-button></div>
              <div class="detail-layout">
                <section class="detail-main">
                  <div class="detail-title-row"><h1 class="detail-page-title">{{ selectedIssue.title }}</h1><span class="detail-number">#{{ selectedIssue.number }}</span><el-tag :type="selectedIssue.state === 'open' ? 'success' : 'info'">{{ selectedIssue.state === 'open' ? '开放' : '已关闭' }}</el-tag></div>
                  <div class="detail-meta">{{ selectedIssue.repo }} · {{ selectedIssue.author }} 创建 · 更新于 {{ selectedIssue.updated }}</div>
                  <div class="detail-labels"><el-tag v-for="label in selectedIssue.labels" :key="label.name" size="small" :style="labelStyle(label)">{{ label.name }}</el-tag></div>
                  <article class="gitea-content"><h3>描述</h3><div v-if="selectedIssue.bodyHtml" class="markdown-body rendered-markdown" v-html="selectedIssue.bodyHtml"></div><div v-else class="markdown-body">{{ selectedIssue.description }}</div></article><section v-if="checklistItems.length" class="issue-checklist"><h3>任务清单</h3><label v-for="item in checklistItems" :key="item.text" :class="{ done: item.done }"><input type="checkbox" :checked="item.done" disabled />{{ item.text }}</label></section>
                  <div class="conversation-title">评论与动态</div>
                  <article v-for="comment in detailComments" :key="comment.id" class="comment-item"><el-avatar :size="34">{{ comment.user?.login?.slice(0, 1) }}</el-avatar><div class="comment-box"><div class="comment-head"><strong>{{ comment.user?.login ?? '未知用户' }}</strong><span>{{ formatDate(comment.created_at) }}</span></div><div v-if="comment.body_html" class="markdown-body rendered-markdown" v-html="comment.body_html"></div><div v-else class="markdown-body">{{ comment.body }}</div></div></article>
                  <el-empty v-if="detailComments.length === 0" description="暂无评论" :image-size="60" />
                  <div class="comment-editor gitea-markdown-editor"><div class="editor-tabs"><button :class="{ active: commentMode === 'write' }" @click="editComment">编辑</button><button :class="{ active: commentMode === 'preview' }" @click="previewComment">预览</button></div><div v-if="commentMode === 'write'" class="writer-panel"><div class="markdown-toolbar"><button title="标题" @click="insertMarkdown('## ', '', '标题')">H</button><button title="粗体" @click="insertMarkdown('**', '**', '粗体')"><b>B</b></button><button title="斜体" @click="insertMarkdown('*', '*', '斜体')"><i>I</i></button><button title="删除线" @click="insertMarkdown('~~', '~~', '删除线')">S</button><span class="toolbar-divider"></span><button title="代码" @click="insertMarkdown('`', '`', '代码')">&lt;/&gt;</button><button title="引用" @click="insertMarkdown('> ', '', '引用')">❝</button><span class="toolbar-divider"></span><button title="无序列表" @click="insertMarkdown('- ', '', '列表项')">☷</button><button title="有序列表" @click="insertMarkdown('1. ', '', '列表项')">≡</button><button title="链接" @click="insertMarkdown('[', '](https://)', '链接文字')">↗</button><button title="图片" @click="chooseAttachment">▧</button></div><textarea ref="commentTextarea" v-model="commentText" class="markdown-text-editor" placeholder="留下评论"></textarea><div class="attachment-dropzone" @dragover.prevent @drop.prevent="uploadAttachment"><span>拖拽图片或附件到这里，或</span><el-button link type="primary" @click="chooseAttachment">选择文件</el-button></div></div><div v-else v-loading="previewLoading" class="markdown-preview rendered-markdown"><div v-if="commentPreviewError" class="preview-error">{{ commentPreviewError }}</div><div v-else-if="commentHtml" v-html="commentHtml"></div><span v-else class="muted">暂无预览内容</span></div><input ref="attachmentInput" type="file" hidden @change="uploadAttachment" /><div class="comment-actions"><span>支持 Markdown、图片和附件</span><el-button v-if="commentPermissionError" link type="primary" @click="login">重新授权</el-button><el-button type="primary" :disabled="!commentText.trim()" @click="submitComment">发表评论</el-button></div></div>
                </section>
                <aside class="detail-sidebar"><div class="sidebar-section"><h3>管理属性</h3><label>阶段</label><el-select v-model="selectedIssue.stage" style="width: 100%" @change="changeSelectedStage"><el-option v-for="stage in stages" :key="stage" :label="stage" :value="stage" /></el-select><label>子阶段</label><el-select v-model="selectedIssue.subStage" style="width: 100%" @change="changeSelectedSubstage"><el-option v-for="substage in selectedIssueSubstages" :key="substage.name" :label="substage.name" :value="substage.name" /></el-select><label>优先级</label><el-select v-model="selectedIssue.priority" style="width: 100%"><el-option v-for="priority in ['P0', 'P1', 'P2', 'P3']" :key="priority" :label="priority" :value="priority" /></el-select><label>截止日期</label><el-date-picker v-model="selectedIssue.dueDate" type="date" value-format="YYYY-MM-DD" placeholder="未设置" style="width: 100%" /><el-button type="primary" plain style="width: 100%; margin-top: 12px" @click="saveManagement">保存管理属性</el-button></div><div class="sidebar-section"><h3>Gitea 信息</h3><div class="sidebar-row"><span>项目</span><b>{{ selectedIssue.project }}</b></div><div class="sidebar-row"><span>里程碑</span><b>{{ selectedIssue.milestone }}</b></div><div class="sidebar-row"><span>作者</span><b>{{ selectedIssue.author }}</b></div><div class="sidebar-row"><span>指派人</span><b>{{ selectedIssue.assignee }}</b></div><div class="sidebar-row"><span>类型</span><b>{{ selectedIssue.type }}</b></div></div><div v-if="selectedIssue.assets.length" class="sidebar-section"><h3>附件（{{ selectedIssue.assets.length }}）</h3><a v-for="asset in selectedIssue.assets" :key="asset.id" class="attachment-link" :href="asset.browser_download_url || asset.download_url" target="_blank" rel="noreferrer">{{ asset.name }}</a></div><div class="sidebar-section"><h3>流转历史</h3><div v-for="item in detailHistory" :key="item.created_at + item.to_stage + item.to_sub_stage" class="history-row"><span class="history-time">{{ formatDate(item.created_at) }} · {{ item.actor_name || item.actor_login || '系统' }}</span><span class="history-event"><b v-if="item.to_stage && item.from_stage !== item.to_stage">阶段：{{ item.from_stage || '无' }} → {{ item.to_stage }}</b><b v-if="item.to_sub_stage && item.from_sub_stage !== item.to_sub_stage">状态：{{ item.from_sub_stage || '无' }} → {{ item.to_sub_stage }}</b><b v-if="item.to_priority && item.from_priority !== item.to_priority">优先级：{{ item.from_priority || '无' }} → {{ item.to_priority }}</b></span></div><span v-if="detailHistory.length === 0" class="muted">暂无流转记录</span></div></aside>
              </div>
            </div>
          </template>
          <template v-else-if="activeView === 'settings'">
            <el-radio-group v-model="settingsSection" style="margin-bottom: 20px"><el-radio-button value="gitea">Gitea 集成</el-radio-button><el-radio-button value="stages">阶段管理</el-radio-button></el-radio-group>
            <GiteaSettings v-if="settingsSection === 'gitea'" @saved="giteaSettingsSaved" />
            <div v-else-if="authRequired" class="auth-state"><p>阶段管理需要先登录 Gitea。</p><el-button type="primary" @click="login">登录 Gitea</el-button></div>
            <section v-else class="settings-page"><div class="settings-heading"><div><h1>阶段管理</h1><p>自定义项目阶段及每个阶段的子阶段，修改后会应用到看板和 Issue 详情。</p></div><div><el-button @click="activeView = 'board'">取消</el-button><el-button type="primary" :loading="stageSaving" @click="saveStageSettings">保存配置</el-button></div></div><div class="stage-config-list"><article v-for="(stage, stageIndex) in stageDraft" :key="stageIndex" class="stage-config-card" draggable="true" @dragstart="startStageDrag(stageIndex, $event)" @dragover.prevent @drop="dropStage(stageIndex)"><div class="stage-config-head"><el-input v-model="stage.code" :disabled="!!stage.id && !codeEditKeys[codeKey(stage.id, stageIndex)]" placeholder="阶段编码（唯一）" /><el-button v-if="stage.id" text type="primary" @click="toggleCodeEdit(codeKey(stage.id, stageIndex))">{{ codeEditKeys[codeKey(stage.id, stageIndex)] ? '锁定编码' : '修改编码' }}</el-button><el-input v-model="stage.name" placeholder="阶段名称" /><el-button text type="danger" :disabled="stageDraft.length <= 1" @click="removeStage(stageIndex)">删除阶段</el-button></div><div class="substage-title">子阶段</div><div class="substage-list"><div v-for="(substage, substageIndex) in stage.substages" :key="substageIndex" class="substage-row" draggable="true" @dragstart.stop="startSubstageDrag(stageIndex, substageIndex, $event)" @dragover.prevent @drop.stop="dropSubstage(stageIndex, substageIndex)"><el-input v-model="substage.code" :disabled="!!substage.id && !codeEditKeys[codeKey(substage.id, substageIndex)]" placeholder="子阶段编码（唯一）" /><el-button v-if="substage.id" text type="primary" @click="toggleCodeEdit(codeKey(substage.id, substageIndex))">{{ codeEditKeys[codeKey(substage.id, substageIndex)] ? '锁定编码' : '修改编码' }}</el-button><el-input v-model="substage.name" placeholder="子阶段名称" /><el-button text type="danger" :disabled="stage.substages.length <= 1" @click="removeSubstage(stage, substageIndex)">删除</el-button></div></div><el-button text type="primary" @click="addSubstage(stage)">＋添加子阶段</el-button></article></div><el-button class="add-stage-button" plain @click="addStage">＋添加阶段</el-button></section>
          </template>
          <template v-else>
          <section class="issue-toolbar">
            <div class="search-row"><el-input v-model="searchTerm" class="issue-search" placeholder="搜索 Issue 标题、编号或标签" clearable><template #suffix><el-icon><Search /></el-icon></template></el-input><el-button v-if="activeView === 'issues' && selectedIssues.length" type="primary" plain @click="openBatchDialog">批量修改（{{ selectedIssues.length }}）</el-button><el-button type="primary"><el-icon><Plus /></el-icon>创建 Issue</el-button></div>
            <div class="filter-row"><div class="state-tabs"><button v-for="state in states" :key="state" class="state-tab" :class="{ active: selectedState === state }" @click="selectedState = state">{{ state }} <span>{{ stateCount(state) }}</span></button></div><div class="quick-filters">
              <el-popover placement="bottom-start" :width="300" trigger="click"><template #reference><button class="filter-button">标签筛选 <span>⌄</span></button></template><div class="filter-popup"><el-input placeholder="搜索标签" size="small" /><button v-for="item in labels" :key="item" class="popup-option" :class="{ selected: selectedLabel === item }" @click="selectedLabel = item">{{ item }}</button></div></el-popover>
              <el-popover placement="bottom-start" :width="260" trigger="click"><template #reference><button class="filter-button">里程碑筛选 <span>⌄</span></button></template><div class="filter-popup"><button v-for="item in milestones" :key="item" class="popup-option" :class="{ selected: selectedMilestone === item }" @click="selectedMilestone = item">{{ item }}</button></div></el-popover>
              <el-popover placement="bottom-start" :width="250" trigger="click"><template #reference><button class="filter-button">项目 <span>⌄</span></button></template><div class="filter-popup"><button v-for="item in projects" :key="item" class="popup-option" :class="{ selected: selectedProject === item }" @click="selectedProject = item">{{ item }}</button></div></el-popover>
              <el-popover placement="bottom-start" :width="180" trigger="click"><template #reference><button class="filter-button">阶段筛选 <span>⌄</span></button></template><div class="filter-popup"><button v-for="item in stageFilters" :key="item" class="popup-option" :class="{ selected: selectedStage === item }" @click="setStageFilter(item)">{{ item }}</button></div></el-popover>
              <el-popover placement="bottom-start" :width="180" trigger="click"><template #reference><button class="filter-button">状态筛选 <span>⌄</span></button></template><div class="filter-popup"><button v-for="item in subStageFilters" :key="item" class="popup-option" :class="{ selected: selectedSubStage === item }" @click="selectedSubStage = item">{{ item }}</button></div></el-popover>
              <el-popover placement="bottom-start" :width="220" trigger="click"><template #reference><button class="filter-button">作者 <span>⌄</span></button></template><div class="filter-popup"><button v-for="item in authors" :key="item" class="popup-option" :class="{ selected: selectedAuthor === item }" @click="selectedAuthor = item">{{ item }}</button></div></el-popover>
              <el-popover placement="bottom-start" :width="220" trigger="click"><template #reference><button class="filter-button">指派人筛选 <span>⌄</span></button></template><div class="filter-popup"><button v-for="item in assignees" :key="item" class="popup-option" :class="{ selected: selectedAssignee === item }" @click="selectedAssignee = item">{{ item }}</button></div></el-popover>
              <el-popover placement="bottom-start" :width="180" trigger="click"><template #reference><button class="filter-button">类型筛选 <span>⌄</span></button></template><div class="filter-popup"><button v-for="item in types" :key="item" class="popup-option" :class="{ selected: selectedType === item }" @click="selectedType = item">{{ item }}</button></div></el-popover>
              <el-popover placement="bottom-start" :width="220" trigger="click"><template #reference><button class="filter-button">排序 <span>⌄</span></button></template><div class="filter-popup"><button v-for="item in sorts" :key="item" class="popup-option" :class="{ selected: sortBy === item }" @click="sortBy = item">{{ item }}</button></div></el-popover>
              <el-popover placement="bottom-end" :width="360" trigger="click"><template #reference><button class="filter-button">更多筛选 <span>⌄</span></button></template><div class="filter-popup extra-filter"><div class="extra-title">更多筛选</div><el-date-picker v-model="updatedRange" type="daterange" value-format="YYYY-MM-DD" range-separator="至" start-placeholder="更新时间起" end-placeholder="更新时间止" /><el-select v-model="selectedPriority" placeholder="优先级"><el-option label="全部优先级" value="全部优先级" /><el-option v-for="item in ['P0', 'P1', 'P2', 'P3']" :key="item" :label="item" :value="item" /></el-select><el-button link type="primary" @click="resetFilters"><el-icon><Refresh /></el-icon>重置筛选</el-button></div></el-popover><div class="mode-switch filter-mode-switch" role="group" aria-label="切换展示模式"><button class="mode-button" :class="{ active: activeView === 'board' }" title="看板模式" @click="activeView = 'board'"><el-icon><Grid /></el-icon></button><button class="mode-button" :class="{ active: activeView === 'issues' }" title="列表模式" @click="activeView = 'issues'"><el-icon><Connection /></el-icon></button></div>
            </div></div>
          </section>
          <div v-loading="loading" class="issue-content" :class="{ 'list-content': activeView === 'issues' }">
            <template v-if="activeView === 'board'"><div v-if="boardFocusStage" class="board-breadcrumb"><el-button text type="primary" @click="leaveBoardStage">← 返回阶段看板</el-button><span>/</span><strong>{{ boardFocusStage }} · 子阶段</strong></div><div class="board"><section v-for="stage in boardColumns" :key="stage" class="column" :class="{ collapsed: collapsedColumns[stage] }" @scroll="onColumnScroll(stage, $event)" @dragover.prevent @drop="dropIssue(stage)"><div class="column-head" :class="{ clickable: !boardFocusStage }" @click="enterBoardStage(stage)"><span>{{ stage }}</span><span class="column-head-actions"><span class="column-count">{{ boardTotal(stage) }}</span><button class="column-collapse" title="折叠列" @click.stop="toggleColumn(stage)">{{ collapsedColumns[stage] ? '展开' : '折叠' }}</button></span></div><article v-for="issue in boardItems(stage)" :key="`${issue.repo}-${issue.number}`" class="issue-card" draggable="true" @dragstart="startDrag(issue)" @dragend="draggedIssue = null" @click="openIssue(issue)"><div class="issue-top"><span class="issue-number">#{{ issue.number }}</span><div class="quick-management"><el-popover placement="bottom-end" :width="150" trigger="click"><template #reference><button class="quick-stage" @click.stop>{{ issue.stage }}</button></template><div class="filter-popup"><div class="popup-caption">推进阶段</div><button v-for="next in nextStages(issue.stage)" :key="next" class="popup-option" @click.stop="quickUpdate(issue, { stage: next })">{{ next }}</button><span v-if="nextStages(issue.stage).length === 0" class="popup-empty">已完成</span></div></el-popover><el-popover placement="bottom-end" :width="130" trigger="click"><template #reference><button class="quick-priority" :class="`priority-${issue.priority.toLowerCase()}`" @click.stop>{{ issue.priority }}</button></template><div class="filter-popup"><div class="popup-caption">调整优先级</div><button v-for="priority in ['P0', 'P1', 'P2', 'P3']" :key="priority" class="popup-option" :class="{ selected: issue.priority === priority }" @click.stop="quickUpdate(issue, { priority: priority as Priority })">{{ priority }}</button></div></el-popover></div></div><div class="issue-title">{{ issue.title }}</div><div class="issue-labels"><el-popover placement="bottom-start" :width="150" trigger="click"><template #reference><el-tag class="issue-substage" size="small" effect="plain" @click.stop>{{ issue.subStage }}</el-tag></template><div class="filter-popup"><div class="popup-caption">调整状态</div><button v-for="substage in stageConfig.find(item => item.name === issue.stage)?.substages ?? []" :key="substage.name" class="popup-option" @click.stop="quickUpdate(issue, { subStageCode: substage.code, subStage: substage.name })">{{ substage.name }}</button></div></el-popover><el-tag v-for="label in issue.labels" :key="label.name" size="small" :style="labelStyle(label)">{{ label.name }}</el-tag></div><div class="issue-foot"><span class="issue-type">{{ issue.repo }} · {{ issue.project }}</span><el-popover placement="bottom-end" :width="180" trigger="click"><template #reference><button class="assignee" @click.stop>{{ issue.assignee === '未分配' ? '?' : issue.assignee.slice(0, 1) }}</button></template><div class="filter-popup"><div class="popup-caption">指派给</div><button v-for="person in assignees.filter(item => item !== '全部指派人')" :key="person" class="popup-option" :class="{ selected: issue.assignee === person }" @click.stop="quickAssign(issue, person)">{{ person }}</button></div></el-popover></div></article><div v-if="boardItems(stage).length > 0 && boardItems(stage).length < boardTotal(stage)" class="load-more"><el-button size="small" text type="primary" @click.stop="loadMore(stage)">加载更多</el-button></div><div v-else-if="boardItems(stage).length > 0" class="load-end">到底了</div><el-empty v-if="boardTotal(stage) === 0" description="暂无 Issue" :image-size="45" /></section></div></template>
            <template v-else><el-table :data="pagedIssues" stripe @selection-change="onSelectionChange"><el-table-column type="selection" width="48" /><el-table-column prop="number" label="编号" width="75"><template #default="scope">#{{ scope.row.number }}</template></el-table-column><el-table-column prop="title" label="标题" min-width="300"><template #default="scope"><button class="issue-title-link" type="button" @click.stop="openIssue(scope.row)">{{ scope.row.title }}</button></template></el-table-column><el-table-column label="标签" min-width="170"><template #default="scope"><div class="table-labels"><el-tag v-for="label in scope.row.labels" :key="label.name" size="small" :style="labelStyle(label)">{{ label.name }}</el-tag></div></template></el-table-column><el-table-column prop="project" label="项目" width="130" /><el-table-column prop="stage" label="阶段" width="85" /><el-table-column prop="subStage" label="子阶段" width="95" /><el-table-column prop="priority" label="优先级" width="90"><template #default="scope"><el-tag :type="priorityType(scope.row.priority)" size="small">{{ scope.row.priority }}</el-tag></template></el-table-column><el-table-column prop="milestone" label="里程碑" width="120" /><el-table-column prop="author" label="作者" width="95" /><el-table-column prop="assignee" label="指派人" width="95" /><el-table-column prop="type" label="类型" width="80" /><el-table-column prop="updated" label="更新时间" width="125" /></el-table><div class="pagination-bar"><span>共 {{ issueDisplayTotal }} 条 Issue<span v-if="selectedIssues.length">，已选择 {{ selectedIssues.length }} 条</span></span><el-pagination v-model:current-page="currentPage" v-model:page-size="pageSize" :page-sizes="[20, 50, 100]" :total="visibleIssues.length" layout="total, sizes, prev, pager, next" background /></div></template>
          <el-dialog v-model="batchDialogVisible" title="批量修改阶段/状态" width="440px" destroy-on-close>
            <p class="batch-dialog-hint">将修改选中的 {{ selectedIssues.length }} 个 Issue。其他管理属性保持不变。</p>
            <el-form label-position="top">
              <el-form-item label="阶段"><el-select :model-value="batchStageCode" style="width: 100%" @update:model-value="setBatchStage"><el-option v-for="stage in stageConfig" :key="stage.code" :label="stage.name" :value="stage.code" /></el-select></el-form-item>
              <el-form-item label="状态"><el-select v-model="batchSubStageCode" style="width: 100%"><el-option v-for="substage in batchSubstages" :key="substage.code" :label="substage.name" :value="substage.code" /></el-select></el-form-item>
            </el-form>
            <template #footer><el-button @click="batchDialogVisible = false">取消</el-button><el-button type="primary" :loading="batchSaving" @click="saveBatchManagement">确认修改</el-button></template>
          </el-dialog>
          </div>
          </template>
        </template>
      </main>
    </el-container>
  </el-container>
</template>
