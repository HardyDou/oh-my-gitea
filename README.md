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
- 本系统数据库保存用户/仓库映射、阶段、优先级、流转记录、同步事件及加密的 Gitea 集成配置。
- 第一版不增加独立角色权限，仓库访问权限沿用 Gitea。
- 后端 API 是一等入口，支持 Agent 直接查询和修改 Issue 管理字段。
- 人类用户使用 OAuth2；Agent 使用 Gitea Personal Access Token 或 OAuth Access Token，无需浏览器登录。

## Docker 部署

```bash
cp .env.docker.example .env.docker
# 编辑 .env.docker：分别用 openssl rand -hex 32 生成并填写
# POSTGRES_PASSWORD、SESSION_SECRET、SYSTEM_CONFIG_TOKEN

docker compose --env-file .env.docker -f docker-compose.deploy.yml up -d --build
```

打开 `http://localhost:8080`，在 **系统配置 → Gitea 集成** 输入 `SYSTEM_CONFIG_TOKEN` 解锁，然后配置 Gitea 地址、OAuth Client ID / Client Secret 和 Webhook 密钥。密钥加密保存且不回显。

在 Gitea 中创建 OAuth2 应用，回调地址填写页面显示的 `http://localhost:8080/auth/gitea/callback`，保存配置后登录即可加载真实仓库和 Issue。

完整说明：[部署指南](docs/部署指南.md)，包括 HTTPS、环境变量、备份、升级和当前限制。

## 本地开发

需要 Node.js 22 和 PostgreSQL 16。

```bash
cp .env.example .env
# 编辑 .env，设置两个不同的随机密钥 SESSION_SECRET、SYSTEM_CONFIG_TOKEN
# 保留已有 .env 的 SESSION_SECRET，避免已有加密配置无法解密。
docker compose up -d
npm ci
npm run dev

# 另开终端启动前端
cd web
npm ci
npm run dev
```

开发用 Compose 仅启动 PostgreSQL；空数据卷会自动执行 `db/*.sql`。外部数据库需按顺序手动执行 SQL，例如 `psql <连接地址> -v ON_ERROR_STOP=1 -f db/001_init.sql`（然后执行 002、003）。

打开 `http://localhost:5173`，在系统配置页面设置 Gitea 集成。开发回调为 `http://localhost:3000/auth/gitea/callback`。

`SESSION_SECRET` 同时用于配置加密，必须安全备份，不要直接更换。`SYSTEM_CONFIG_TOKEN` 是部署管理员凭据，不能提供给普通用户。

## 验证

```bash
npm run build
npm --prefix web run build
# 使用专用测试库；测试创建并清理独立 schema，需要 CREATE SCHEMA 权限。
TEST_DATABASE_URL=postgres://pm:pm@localhost:5432/gitea_pm_test npm test
```

未设置 `TEST_DATABASE_URL` 时数据库集成测试会跳过。当前测试覆盖 Gitea 配置鉴权、加密存储、不回显密钥、重启持久化和切换实例保护。

## API

当前原型 API：

- `GET /health`
- `GET /api/v1/setup/status`
- `GET /api/v1/config/gitea`（需要 `X-System-Config-Token`）
- `PUT /api/v1/config/gitea`（需要 `X-System-Config-Token`）
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
