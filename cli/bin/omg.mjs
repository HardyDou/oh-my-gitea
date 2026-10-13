#!/usr/bin/env node

const usage = () => {
  console.error(`用法:
  omg stages
  omg products
  omg product PRODUCT_ID
  omg feature list PRODUCT_ID
  omg feature add PRODUCT_ID TITLE... [--priority P2] [--status planned] [--release ID] [--assignee LOGIN] [--issue OWNER/REPO#N]...
  omg feature update FEATURE_ID [--title TEXT] [--status ...] [--priority ...] [--assignee ...] [--release ID|clear]
  omg release list PRODUCT_ID
  omg management OWNER REPO NUMBER STAGE_CODE SUBSTAGE_CODE [PRIORITY]
  omg state OWNER REPO NUMBER open|closed
  omg comment OWNER REPO NUMBER COMMENT
  omg assignee OWNER REPO NUMBER LOGIN
  omg due-date OWNER REPO NUMBER YYYY-MM-DD|clear
  omg history OWNER REPO NUMBER

环境变量:
  GITEA_PM_URL    API 地址，默认 http://localhost:3000
  OH_MY_GITEA_TOKEN  oh-my-gitea API Token`)
  process.exit(2)
}

const [, , command, ...args] = process.argv
const baseUrl = (process.env.GITEA_PM_URL || 'http://localhost:3000').replace(/\/$/, '')
const token = process.env.OH_MY_GITEA_TOKEN
if (!token) {
  console.error('请先设置 OH_MY_GITEA_TOKEN（oh-my-gitea API Token）')
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

if (!command) usage()
if (command === 'stages') {
  if (args.length !== 0) usage()
  await request('GET', '/api/v1/config/stages')
  process.exit(0)
}
if (!['products', 'product', 'feature', 'release'].includes(command) && args.length < 3) usage()
const [owner, repo, number, ...rest] = args
const issuePath = `/api/v1/repositories/${pathPart(owner)}/${pathPart(repo)}/issues/${pathPart(number)}`

switch (command) {
  case 'products':
    if (args.length !== 0) usage()
    await request('GET', '/api/v1/products')
    process.exit(0)
    break
  case 'product':
    if (args.length !== 1) usage()
    await request('GET', `/api/v1/products/${args[0]}`)
    process.exit(0)
    break
  case 'release':
    if (args[0] !== 'list' || args.length !== 2) usage()
    await request('GET', `/api/v1/products/${args[1]}/releases`)
    process.exit(0)
    break
  case 'feature': {
    if (args.length < 2) usage()
    const sub = args[0]
    if (sub === 'list') {
      if (args.length !== 2) usage()
      await request('GET', `/api/v1/products/${args[1]}/features`)
      process.exit(0)
    }
    if (sub === 'add' || sub === 'update') {
      const positional = []
      const flags = {}
      let issues = []
      for (let i = 1; i < args.length; i += 1) {
        const arg = args[i]
        if (arg.startsWith('--')) {
          const key = arg.slice(2)
          const value = args[i + 1]
          if (key === 'issue') {
            const match = /^(.+)\/(.+)#(\d+)$/.exec(value)
            if (!match) { console.error('--issue 需要 OWNER/REPO#NUM 格式'); process.exit(2) }
            issues.push({ owner: match[1], repo: match[2], number: Number(match[3]) })
            i += 1
            continue
          }
          if (key === 'desc') { flags.description = value }
          else if (key === 'release') { flags.releaseId = value === 'clear' ? null : Number(value) }
          else flags[key] = value
          i += 1
        } else positional.push(arg)
      }
      if (sub === 'add') {
        if (positional.length < 2) usage()
        const productId = positional[0]
        const title = positional.slice(1).join(' ')
        const body = { title, ...flags }
        if (issues.length) body.issues = issues
        await request('POST', `/api/v1/products/${productId}/features`, body)
        break
      }
      if (positional.length !== 1) usage()
      const body = { ...flags }
      if (issues.length) body.issues = issues
      await request('PUT', `/api/v1/features/${positional[0]}`, body)
      break
    }
    usage()
    break
  }
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
