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
# 编辑 .env.docker，设置 POSTGRES_PASSWORD（数据库密码）
# 新部署无需填写管理密钥；底层加密密钥自动生成并持久化。

docker compose --env-file .env.docker -f docker-compose.deploy.yml up -d --build
```

打开 `http://localhost:8080`，在 **系统配置 → Gitea 集成** 首次自行设置管理员密码（至少 8 位，无公共默认密码），以后使用此密码修改配置。然后填写 Gitea 地址、OAuth Client ID / Client Secret；Webhook 密钥可选。密码只保存 scrypt 哈希，Gitea Secret 加密保存且不回显。

**先在本机或可信网络完成管理员设置，再开放公网访问。**

在 Gitea 中创建 OAuth2 应用，回调地址填写页面显示的 `http://localhost:8080/auth/gitea/callback`，保存配置后登录即可加载真实仓库和 Issue。

完整说明：[部署指南](docs/部署指南.md)，包括 HTTPS、环境变量、备份、升级和当前限制。

## 本地开发

需要 Node.js 22 和 PostgreSQL 16。

```bash
cp .env.example .env
# 新部署可直接使用示例，底层密钥自动生成到 .data/session-secret。
# 升级已有部署时不要覆盖 .env，尤其需保留原 SESSION_SECRET。
docker compose up -d
npm ci
npm run dev

# 另开终端启动前端
cd web
npm ci
npm run dev
```

开发用 Compose 仅启动 PostgreSQL；空数据卷会自动执行 `db/*.sql`。外部数据库需按顺序手动执行 SQL，例如 `psql <连接地址> -v ON_ERROR_STOP=1 -f db/001_init.sql`（然后执行 002、003、004）。

打开 `http://localhost:5173`，在系统配置页面设置 Gitea 集成。开发回调为 `http://localhost:3000/auth/gitea/callback`。

自动生成的密钥文件必须随数据库一起备份；旧部署的 `SESSION_SECRET` 也须保留。`SYSTEM_CONFIG_TOKEN` 已停用，管理员密码直接在页面设置，与 Gitea 登录独立。

## 验证

```bash
npm run build
npm --prefix web run build
# 使用专用测试库；测试创建并清理独立 schema，需要 CREATE SCHEMA 权限。
TEST_DATABASE_URL=postgres://pm:pm@localhost:5432/gitea_pm_test npm test
```

未设置 `TEST_DATABASE_URL` 时数据库集成测试会跳过。当前测试覆盖管理员初始化及并发保护、密码登录、会话注销、跨站保护、限流、配置加密和持久化、切换实例保护及自动密钥生成。

## API

当前原型 API：

- `GET /health`
- `GET /api/v1/setup/status`
- `GET /api/v1/admin/status`
- `POST /api/v1/admin/setup`（仅首次设置管理员密码）
- `POST /api/v1/admin/login`
- `POST /api/v1/admin/logout`
- `GET /api/v1/config/gitea`（需要管理员会话 Cookie）
- `PUT /api/v1/config/gitea`（需要管理员会话 Cookie）
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
