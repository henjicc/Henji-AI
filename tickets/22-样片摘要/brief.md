# ticket 22：风格样片摘要只算实际导入的作者库，并核对三个旧失败测试

工作目录：D:/VibeCode/Henji-AI-t22（分支 task/22-样片摘要，基于 main）。只在这个目录改代码并提交到该分支；不 push、不合并、不切分支、不改依赖、不动 node_modules 联接点、不运行 electron:bundle / electron:build / Reality、不占用 9334 端口、不碰 D:/视频制作。注释与提交说明用中文，提交说明末尾加一行：Co-Authored-By: Codex <noreply@openai.com>。先读 AGENTS.md 的工作原则、docs/rules/persistence.md 与 docs/rules/testing.md。

## 任务 1（主要）

`src/core/videoEdit/codeMaterial/authorVersion.ts` 的 `previewAuthorIdentity` 把代码没有导入的内置库也按“该作者接口的最新版”计入风格样片摘要。以后发行兼容的新库版本时，已保存的样片会被误判需要重渲。

- 改成摘要只纳入代码实际导入的库。导入判断用项目里已有的导入解析（codeMaterial 下统计导入库的现有函数），不要另写一套。
- 沿调用方检查：凡是用这个摘要判断“样片要不要重渲”“预览是否过期”的地方，确认改后行为一致。已保存样片的旧摘要如果因此变化、会触发一次多余重渲，写明影响和你的处理；不改持久格式就不升版本。
- 补一个精确测试：未导入的库发新版本时摘要不变；导入的库版本变化时摘要变化。

## 任务 2（顺带核对）

以前在 main 上失败过这三个测试：`documentValidation.test.ts`、`scene/sceneDeclaration.test.ts`、`audio/effects/mergedEffectsMigration.test.ts`（按文件名搜索定位）。逐个运行：已通过就记“已通过”；仍失败就查根因修掉（修代码还是修测试按 AGENTS.md“修根因”判断），不能跳过或删测试。

## 验证与回报

- 只跑与改动相关的精确测试和这三个测试；`npx eslint <改动文件>`；渲染层类型检查 `NODE_OPTIONS=--max-old-space-size=8192 npx tsc -p tsconfig.json --noEmit`。
- 结果写到 D:/VibeCode/Henji-AI/tickets/22-样片摘要/result.md：改了什么、根因、测试输出摘要、提交哈希、没做或拿不准的地方。
