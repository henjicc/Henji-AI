# ticket 23：网页重演测试不写真实日志；导入录制时的“录制积压”误报

工作目录：D:/VibeCode/Henji-AI-t23（分支 task/23-重演测试日志，基于 main）。只在这个目录改代码并提交到该分支；不 push、不合并、不切分支、不改依赖、不动 node_modules 联接点、不运行 electron:bundle / electron:build / Reality、不占用 9334 端口、不碰 D:/视频制作，也不要读写用户真实资料目录里的日志（只读核对可以）。注释与提交说明用中文，提交说明末尾加一行：Co-Authored-By: Codex <noreply@openai.com>。先读 AGENTS.md 工作原则、docs/rules/logging.md、docs/rules/testing.md。

## 任务 1：测试写进真实日志目录

曾经观察到：跑 `npx vitest run electron/main/services/web-replay` 当天，用户真实应用日志里出现了同一时刻的 `web_replay.replay.failed` / `capture_fallback`。怀疑测试写进了真实日志目录。

- 查清这些测试的日志落到哪里（vitest.config.ts 用 LOCALAPPDATA 指向 .tmp/test-local-app-data，看非 Windows 分支或某些模块是否绕开了它、是否用了 app.getPath 或别的路径）。
- 若确实会写真实目录：修根因（让日志路径在测试里一律落到仓库临时目录），并沿同一日志模块排查其他主进程测试是否同样会写真实目录。
- 若不会：说明证据（测试期间日志实际写到哪个文件），并推断当时那两条真实日志的可能来源。

## 任务 2：导入网页录制时的误报

导入网页录制时出现警告 `web_replay.edit_source.pressure`（文案“采集日志保存积压，请暂停录制”），当时并没有在录制，文案误导。查清这个警告在导入路径上为什么会触发：如果导入时根本不该判断积压，就不在导入时报；如果确有积压，就按实际场景改成用户能理解的说法（不说“暂停录制”）。补一个精确测试。

## 验证与回报

- 只跑相关精确测试；`npx eslint <改动文件>`；改了主进程代码就跑 `NODE_OPTIONS=--max-old-space-size=8192 npx tsc -p tsconfig.electron.json --noEmit`，改了渲染层就跑 `tsconfig.json`。
- 结果写到 D:/VibeCode/Henji-AI/tickets/23-重演测试日志/result.md：结论、根因、改了什么、测试输出摘要、提交哈希、拿不准的地方。
