# ticket 24：打不开的文档每次扫描都报 documents.read.failed，日志刷屏

工作目录：D:/VibeCode/Henji-AI-t24（分支 task/24-读取失败刷屏，基于 main）。只在这个目录改代码并提交到该分支；不 push、不合并、不切分支、不改依赖、不动 node_modules 联接点、不运行 electron:bundle / electron:build / Reality、不占用 9334 端口、不碰 D:/视频制作，不读写用户真实资料目录（只读核对日志可以）。注释与提交说明用中文，提交说明末尾加一行：Co-Authored-By: Codex <noreply@openai.com>。先读 AGENTS.md 工作原则、docs/rules/logging.md、docs/rules/persistence.md、docs/rules/testing.md。

## 现象

用户有一份打不开的旧版剪辑（v10，“未命名项目 1”，用户说不用管它），还有一份旧格式文档。文档列表每次扫描都会对它们各报一次 `documents.read.failed`，日志刷屏，真正的新问题被淹没。

## 要求

- 找到扫描文档列表时读取文档、报 `documents.read.failed` 的位置（主进程 documents 服务一带），查清为什么每次扫描都重读、重报。
- 同一文件、内容没变（按大小+修改时间或现有的指纹）时，读失败只报一次；文件变了再读再报。不要吞错：第一次照常报 warn/error 并带原因；列表里该文档仍按现有方式标成打不开或缺失，不要改它在界面上的表现。
- 不改持久格式；不为这件事加设置项。
- 补精确测试：同一坏文件连续扫描只报一次；文件改动后会再报。

## 验证与回报

- 只跑相关精确测试；`npx eslint <改动文件>`；`NODE_OPTIONS=--max-old-space-size=8192 npx tsc -p tsconfig.electron.json --noEmit`。
- 结果写到 D:/VibeCode/Henji-AI/tickets/24-读取失败刷屏/result.md：根因、改了什么、测试输出摘要、提交哈希、拿不准的地方。
