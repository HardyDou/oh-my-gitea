#!/usr/bin/env node

const usage = () => {
  console.error(`用法:
  omg get OWNER REPO NUMBER
  omg management OWNER REPO NUMBER STAGE_CODE SUBSTAGE_CODE [PRIORITY]
  omg state OWNER REPO NUMBER open|closed
  omg comment OWNER REPO NUMBER COMMENT
  omg assignee OWNER REPO NUMBER LOGIN
  omg due-date OWNER REPO NUMBER YYYY-MM-DD|clear
  omg history OWNER REPO NUMBER

环境变量:
  GITEA_PM_URL    API 地址，默认 http://localhost:3000
  GITEA_TOKEN     当前用户的 Gitea Personal Access Token`)
  process.exit(2)
}

const [, , command, ...args] = process.argv
const baseUrl = (process.env.GITEA_PM_URL || 'http://localhost:3000').replace(/\/$/, '')
const token = process.env.GITEA_TOKEN
if (!token) {
  console.error('请先设置 GITEA_TOKEN（你的 Gitea Personal Access Token）')
  process.exit(1)
}

const pathPart = (value) => encodeURIComponent(value)
async function request(method, path, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await response.text()
  let result
  try { result = text ? JSON.parse(text) : null } catch { result = text }
  if (!response.ok) {
    console.error(typeof result === 'string' ? result : JSON.stringify(result, null, 2))
    process.exit(1)
  }
  console.log(typeof result === 'string' ? result : JSON.stringify(result, null, 2))
}

if (!command || args.length < 3) usage()
const [owner, repo, number, ...rest] = args
const issuePath = `/api/v1/repositories/${pathPart(owner)}/${pathPart(repo)}/issues/${pathPart(number)}`

switch (command) {
  case 'get':
    if (args.length !== 3) usage()
    await request('GET', `${issuePath}/detail`)
    break
  case 'management': {
    if (args.length < 5 || args.length > 6) usage()
    const [stageCode, subStageCode, priority] = rest
    await request('PATCH', `${issuePath}/management`, { stageCode, subStageCode, ...(priority ? { priority } : {}) })
    break
  }
  case 'state':
    if (args.length !== 4 || !['open', 'closed'].includes(rest[0])) usage()
    await request('PATCH', `${issuePath}/state`, { state: rest[0] })
    break
  case 'comment':
    if (args.length < 4) usage()
    await request('POST', `${issuePath}/comments`, { body: rest.join(' ') })
    break
  case 'assignee':
    if (args.length !== 4) usage()
    await request('PATCH', `${issuePath}/assignee`, { assignee: rest[0] })
    break
  case 'due-date':
    if (args.length !== 4) usage()
    await request('PATCH', `${issuePath}/due-date`, { dueDate: rest[0] === 'clear' ? null : rest[0] })
    break
  case 'history':
    if (args.length !== 3) usage()
    await request('GET', `${issuePath}/history`)
    break
  default:
    usage()
}
