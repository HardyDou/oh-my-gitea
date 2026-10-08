# Gitea PM

Gitea 项目管理增强系统原型。

## 开源许可

本项目采用 [MIT License](LICENSE)，允许商业使用、修改和分发，须保留版权及许可声明。

## 技术栈

- 前端：Vue 3 + TypeScript + Element Plus + Vite
- 后端：Node.js + Fastify + TypeScript
- 数据库：PostgreSQL
- 部署：Docker Compose

## 已确定的边界

- Gitea 是仓库和 Issue 原始数据的来源，不直接访问 Gitea 数据库。
- 一个 Gitea 仓库下可以有多个 Gitea 原生 Project；本系统只为 Issue 增加阶段和优先级。
- 使用 Gitea OAuth2 登录；Gitea 已接入 SSO 时可无感登录。
- 本系统数据库只保存阶段、优先级、流转记录和同步事件。
- 第一版不增加独立角色权限，仓库访问权限沿用 Gitea。
- 后端 API 是一等入口，支持 Agent 直接查询和修改 Issue 管理字段。
- 人类用户使用 OAuth2；Agent 使用 Gitea Personal Access Token 或 OAuth Access Token，无需浏览器登录。

## 启动

```bash
cp .env.example .env
docker compose up -d
npm install
psql "$DATABASE_URL" -f db/001_init.sql
npm run dev

# 另开终端启动前端
cd web
npm install
npm run dev
```

需要在 Gitea 中创建 OAuth2 应用，并将回调地址配置为 `GITEA_REDIRECT_URI`。首次打开前端后点击“登录 Gitea”，OAuth 成功后会加载真实仓库和 Issue。

当前原型 API：

- `GET /health`
- `GET /auth/gitea`
- `GET /auth/gitea/callback`
- `GET /auth/me`
- `POST /auth/logout`
- `GET /api/v1/repositories`
- `GET /api/v1/repositories/:owner/:repo/projects`
- `GET /api/v1/repositories/:owner/:repo/issues`
- `PATCH /api/v1/repositories/:owner/:repo/issues/:number/management`
- `POST /webhooks/gitea`

## Agent 调用约定

Agent 使用 Gitea Token：

```http
Authorization: Bearer <gitea-personal-access-token>
```

后端使用该 Token 调用 Gitea API，识别当前用户并校验仓库权限；不保存 Token。建议为 Agent 创建独立的 Gitea 机器人账号，并只授予必要仓库权限。

所有阶段和优先级变更都记录 `audit_log`，并支持 `Idempotency-Key` 防止 Agent 重试造成重复操作。
