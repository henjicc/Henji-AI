# ticket 25：删除单个网页重演版本（take）的应用能力

工作目录：D:/VibeCode/Henji-AI-t25（分支 task/25-删除重演版本，基于 main）。只在这个目录改代码并提交到该分支；不 push、不合并、不切分支、不改依赖、不动 node_modules 联接点、不运行 electron:bundle / electron:build / Reality、不占用 9334 端口、不碰 D:/视频制作，不读写用户真实资料目录。注释与提交说明用中文，提交说明末尾加一行：Co-Authored-By: Codex <noreply@openai.com>。

先读：AGENTS.md（尤其“安全分级”：删除用户数据先进回收区；“禁止为增删一条记录手写专用 Agent 能力”）、docs/rules/assistant-capability.md、`.codex/skills/henji-application-capability/SKILL.md`、docs/rules/persistence.md、docs/rules/logging.md、docs/rules/testing.md。

## 现状

网页录制重演会在录制目录下生成 `takes/<名字>/` 版本。现在没有删除单个版本的入口，只能手动删文件夹。

## 要求

- 先按 henji-application-capability 做覆盖分级：如果重演版本已经是（或应该注册为）应用实体，删除应走通用实体的删除动词（`change_application_entities` 里的删除），而不是新增专用工具；只有通用动词确实表达不了时才考虑专用能力，并在结果里说明理由。
- 删除进回收区（沿用网页录制现有的回收区机制，同一套恢复与 30 天清理），不直接硬删。
- 正在被剪辑引用、或正在重演/导出中的版本怎么处理：照现有同类实体（例如删除整段录制）的规则来，查清后写进结果。
- 不做界面（界面另行安排）；不改持久格式，确需改动按 persistence.md 升版本、写迁移和黄金样本。
- 补精确测试：删除后版本进回收区、读不到；恢复后回来；删除不存在的版本报清楚的错。
- 改动涉及能力声明时，跑 `npm run check:assistant-capabilities`。

## 验证与回报

- 相关精确测试、`npx eslint <改动文件>`、按改动两套类型检查（`NODE_OPTIONS=--max-old-space-size=8192 npx tsc -p tsconfig.electron.json --noEmit` / `tsconfig.json`）。
- 结果写到 D:/VibeCode/Henji-AI/tickets/25-删除重演版本/result.md：覆盖分级结论、改了什么、测试输出摘要、提交哈希、拿不准的地方。
