# oh-my-gitea-cli

命令名：`omg`。

CLI 使用当前用户自己的 oh-my-gitea API Token，由 oh-my-gitea 后端代为访问 Gitea。

```bash
npm install -g oh-my-gitea-cli
# 如果使用 Pi Agent，可额外安装配套 Skill：
# pi install npm:oh-my-gitea-cli
export GITEA_PM_URL=http://localhost:3000
export OH_MY_GITEA_TOKEN='你的 oh-my-gitea API Token'

omg get owner repo 1532
omg management owner repo 1532 testing in_progress P1
omg state owner repo 1532 closed
omg comment owner repo 1532 '处理完成，请验收。'
```

Token 只从环境变量读取，不会写入配置文件或数据库。
