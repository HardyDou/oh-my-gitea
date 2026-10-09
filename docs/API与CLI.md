# API 与 CLI

API 使用调用者自己的 Gitea Token，不新增独立的应用授权体系，也不需要 Token 管理菜单。

## 认证

```bash
export GITEA_PM_URL=http://localhost:3000
export GITEA_TOKEN='你的 Gitea Personal Access Token'
```

请求统一使用：

```http
Authorization: Bearer <GITEA_TOKEN>
Content-Type: application/json
```

Token 至少需要 `read:user`、`read:repository`、`read:issue`；修改 Issue 状态或评论还需要 `write:issue`。每个用户使用自己的 Gitea Token，权限由 Gitea 控制。

## Issue API

路径中的 `owner`、`repo` 和 `number` 分别是仓库所有者、仓库名和 Issue 编号。

### 查询

```bash
curl "$GITEA_PM_URL/api/v1/repositories/owner/repo/issues/1532/detail" \\
  -H "Authorization: Bearer $GITEA_TOKEN"
```

### 修改阶段、子阶段、优先级

阶段和子阶段使用系统配置中的稳定编码：

```bash
curl -X PATCH "$GITEA_PM_URL/api/v1/repositories/owner/repo/issues/1532/management" \\
  -H "Authorization: Bearer $GITEA_TOKEN" \\
  -H 'Content-Type: application/json' \\
  -d '{"stageCode":"testing","subStageCode":"in_progress","priority":"P1"}'
```

此操作写入项目管理系统数据库，不修改 Gitea 原始 Issue 字段。

### 打开或关闭 Issue

```bash
curl -X PATCH "$GITEA_PM_URL/api/v1/repositories/owner/repo/issues/1532/state" \\
  -H "Authorization: Bearer $GITEA_TOKEN" \\
  -H 'Content-Type: application/json' \\
  -d '{"state":"closed"}'
```

`state` 可选 `open` 或 `closed`，会同步写回 Gitea。

### 添加评论

```bash
curl -X POST "$GITEA_PM_URL/api/v1/repositories/owner/repo/issues/1532/comments" \\
  -H "Authorization: Bearer $GITEA_TOKEN" \\
  -H 'Content-Type: application/json' \\
  -d '{"body":"处理完成，请验收。"}'
```

### 其他已支持操作

- `PATCH /api/v1/repositories/:owner/:repo/issues/:number/assignee`
- `PATCH /api/v1/repositories/:owner/:repo/issues/:number/due-date`
- `POST /api/v1/repositories/:owner/:repo/issues/:number/assets`
- `GET /api/v1/repositories/:owner/:repo/issues/:number/history`
- `POST /api/v1/management/batch`

## CLI

推荐使用 npm CLI，命令名为 `omg`：

```bash
npm install -g oh-my-gitea-cli
omg management owner repo 1532 testing in_progress P1
omg state owner repo 1532 closed
omg comment owner repo 1532 '处理完成，请验收。'
```

不想安装 npm 包时，也可以直接使用仓库内脚本：

```bash
chmod +x scripts/issue-cli.sh
scripts/issue-cli.sh get owner repo 1532
```

CLI 只转发当前用户的 Gitea Token，不会在项目或数据库中保存 Token。
