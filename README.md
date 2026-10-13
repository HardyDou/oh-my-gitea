<div align="center">

# Oh My Gitea

**让 Gitea 变成项目管理系统，也让 Agent 上看板干活。**

基于 Gitea 的轻量项目管理系统：看板、阶段流转、Agent/CLI 操作、产品文档与原型托管。自托管，
数据主权在你手里，不绑定任何厂商。

**[English](#english) | 简体中文**

</div>

---

## Oh My Gitea 是什么

你们的 Issue 都在 Gitea 里，但 Gitea 不管阶段、不管优先级、不管"这件事走到哪一步了"。于是真
实的进度活在 Excel、日报和某个人脑子里。

Oh My Gitea 把管理字段补在 Gitea 上面：Issue 绑定**阶段 → 子阶段 → 优先级**，看板上拖拽流转，
全部变更记录在案。而人类之外的另一类"员工"——AI Agent——和真人一样，凭一张 API Token 就能
查 Issue、推阶段、写评论、开关工单。产品文档和原型版本也归它管：文档存库即编辑即预览，原型
仓库打个 tag 就自动构建成静态页面，团队打开链接就能看。

---

## 把项目管起来

*不想迁数据、不想换工具？那就把管理系统装在 Issue 已经住着的地方。*

- **看板** → 按仓库的四阶段看板（自定义任意阶段与子阶段），拖拽即流转，历史可回溯。
- **列表模式** → 表格视图批量修改阶段/状态，筛选条件与展示模式自动记住。
- **工作台** → 我的待办、即将到期、最近更新、通知，一个页面看全。
- **Issue 详情** → Markdown 正文、评论、附件、任务清单、流转历史、截止日期、管理属性。
- **主题** → 浅色 / 深色 / 自动跟随系统，配色对齐 Gitea 官方主题。

## 让 Agent 干活

*Agent 不是外挂，是持证上岗的正式员工。*

- **每人一把自己的钥匙** → 用户在右上角「API 凭证」创建 oh-my-gitea Token（只显示一次，后端
  只存哈希），后端用该用户的 Gitea OAuth 授权代为访问 Gitea。
- **CLI：`omg`** → npm 全局安装，阶段、子阶段、优先级、开关 Issue、评论、指派、截止日期、
  流转历史，一条命令一个动作。
- **Agent Skill** → 随 npm 包分发，Pi / Codex / Claude Code 等装上就知道何时、如何操作
  Issue；不给 Token、不问密码，权限永远跟着人走。
- **审计在案** → 每次阶段变更写入 `audit_log` 与流转历史，Agent 的操作也逃不掉。

## 产品与原型都归位

*文档东一个飞书、原型东一个 zip 的情况到此为止。*

- **产品档案** → 登记产品名称、描述，产品下挂文档和原型。
- **产品文档** → Markdown 存数据库，在线编辑、实时预览，不用再找一个"最新版.docx"。
- **原型版本** → 原型是 Gitea 仓库，落在某个 tag 上点「构建」，`npm install && npm run build`
  自动跑完，产物托管成静态页面。
- **版本永久保留** → `/prototypes/{产品}/{tag}/index.html`，任何历史版本一个链接直达，
  所有人点开就能看，无需登录。

## 整套都归你

- **自托管** → Docker Compose 一条命令拉起，PostgreSQL 数据全部在自己手里。
- **Gitea 原始数据不动** → 阶段与优先级存本系统数据库，Gitea 侧只有状态、评论等原生写入。
- **管理员密码页面自设** → 首次部署时在界面设置，无默认密码；Gitea Secret 加密存储。
- **安全默认** → Session 密钥自动生成并持久化，OAuth PKCE，Cookie 签名，登录限流。

---

## 五分钟跑通

**1. 起服务。**

```bash
cp .env.docker.example .env.docker   # 设置 POSTGRES_PASSWORD
docker compose --env-file .env.docker -f docker-compose.deploy.yml up -d --build
```

**2. 配 Gitea。** 打开 `http://localhost:8080`，首次进入设置管理员密码，然后在 Gitea 创建
OAuth2 应用（回调地址页面会显示），填入地址、Client ID、Secret。

**3. 发一个 Issue。** 登录后选仓库、拖看板——已经能管项目了。

**4. 给 Agent 发工牌。** 右上角「API 凭证」创建 Token；然后：

```bash
npm install -g oh-my-gitea-cli
export GITEA_PM_URL=https://你的-oh-my-gitea-地址
export OH_MY_GITEA_TOKEN='omg_...'

omg management owner repo 1532 testing in_progress P1
omg state owner repo 1532 closed
omg comment owner repo 1532 '处理完成，请验收。'
```

Agent（如 Pi）：把本仓库地址给它，或 `pi install npm:oh-my-gitea-cli` 安装 Skill。

## CLI 一览

| 命令 | 作用 |
| --- | --- |
| `omg stages` | 查看阶段/子阶段编码 |
| `omg get OWNER REPO N` | 查询 Issue 详情、评论、流转历史 |
| `omg management OWNER REPO N STAGE SUBSTAGE [P0-P3]` | 修改阶段/子阶段/优先级 |
| `omg state OWNER REPO N open\|closed` | 打开 / 关闭 Issue |
| `omg comment OWNER REPO N BODY` | 添加评论 |
| `omg assignee` / `omg due-date` / `omg history` | 指派人 / 截止日期 / 流转历史 |

## 文档

| 我想…… | 从这里看 |
| --- | --- |
| 部署到服务器 | [部署指南](docs/部署指南.md) |
| 让 Agent 操作 Issue | [API 与 CLI](docs/API与CLI.md) · Agent 使用说明（本文件上方） |
| 了解阶段与子阶段设计 | [功能清单](docs/功能清单-v0.1.md) |

## 架构

```
┌─────────────────────────── 浏览器 ───────────────────────────┐
│      Vue 3 SPA（看板 · 列表 · 工作台 · 产品管理 · 主题）      │
└──────────────────────────────┬──────────────────────────────┘
                               ▼
┌─────────────────────────── 后端 ──────────────────────────────┐
│              Fastify API（OAuth · 会话 · Token）              │──>│ Gitea 实例 │
│   看板/列表 · 阶段流转 · 产品文档 · 原型构建 · 静态托管          │   └────────────┘
└──────────────┬───────────────────────────┬──────────────────┘
               ▼                           ▼
        ┌────────────┐        ┌──────────────────────────┐
        │ PostgreSQL │        │ omg CLI / Agent Skill    │
        └────────────┘        └──────────────────────────┘
```

| 层级 | 技术栈 |
| --- | --- |
| 前端 | Vue 3 + TypeScript + Element Plus + Vite |
| 后端 | Node.js + Fastify + TypeScript |
| 数据库 | PostgreSQL |
| Agent 接入 | npm CLI（`oh-my-gitea-cli`）+ Agent Skill |
| 托管构建 | git clone tag → npm build → 静态托管 |
| 部署 | Docker Compose + Nginx |

## 为什么叫 "Oh My Gitea"

取名自那句每天都会冒出来的感叹——"哦我的 Gitea，怎么连个阶段都记不了"。装上它，这句话就换
成另一种语气：哦，我的 Gitea，现在什么都能查了。

## 开源许可

[MIT License](LICENSE) —— 商业使用、修改、分发均允许，保留版权声明即可。
