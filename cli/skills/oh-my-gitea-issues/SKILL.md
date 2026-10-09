---
name: oh-my-gitea-issues
description: 使用 oh-my-gitea API 和 omg CLI 查询、更新 Gitea Issue 的阶段、子阶段、优先级、状态、指派人、截止日期和评论。用户要求操作 Issue 或项目管理字段时使用。
compatibility: 需要 Node.js 18+、已安装 omg CLI（或仓库内 cli/bin/omg.mjs），以及 GITEA_PM_URL、GITEA_TOKEN 环境变量。
---

# Oh My Gitea Issue 操作

使用调用者自己的 Gitea Personal Access Token，不创建或索要独立的 oh-my-gitea Token。不要把 Token 写入命令参数、文件、聊天消息或提交记录。

## 环境检查

```bash
: "${GITEA_PM_URL:=http://localhost:3000}"
test -n "$GITEA_TOKEN"
omg get OWNER REPO NUMBER
```

如果没有安装全局命令，在本仓库内使用：

```bash
node cli/bin/omg.mjs get OWNER REPO NUMBER
```

## 常用操作

```bash
# 查询 Issue
omg get OWNER REPO NUMBER

# 查看系统阶段和子阶段编码（修改前先确认编码）
curl -sS "$GITEA_PM_URL/api/v1/config/stages" \
  -H "Authorization: Bearer $GITEA_TOKEN"

# 修改阶段、子阶段和优先级
omg management OWNER REPO NUMBER STAGE_CODE SUBSTAGE_CODE P1

# 打开或关闭 Issue
omg state OWNER REPO NUMBER open
omg state OWNER REPO NUMBER closed

# 添加评论
omg comment OWNER REPO NUMBER "评论内容"

# 修改指派人和截止日期
omg assignee OWNER REPO NUMBER LOGIN
omg due-date OWNER REPO NUMBER 2026-12-31
omg due-date OWNER REPO NUMBER clear
```

## 操作规则

- 修改前先确认仓库、Issue 编号和目标值；阶段操作使用编码，不要猜测编码。
- 关闭 Issue、修改指派人或发表评论属于写操作。用户没有明确要求时，先说明将要执行的操作并请求确认。
- 阶段、子阶段、优先级写入 oh-my-gitea 管理数据；打开/关闭和评论会写回 Gitea。
- 遇到 `401`，提示用户设置自己的 `GITEA_TOKEN`；遇到 `403`，提示检查 Gitea Token 的 `write:issue` 权限。
- 不要尝试创建应用 Token，也不要建议增加独立 Token 管理菜单。
