# 06 导出按输出分辨率：结果

## 状态
已完成并提交 `9669d1e5358cb9b902b69cd4c0fb06269df25992`（`perf(video-edit): 按输出分辨率渲染导出画面`）。相对指定基线 `2f49fd3c8` 仅一个提交，工作区干净。仅在指定 worktree 的 task/06-导出按输出分辨率 分支修改，未推送。

## 改动
- 导出统一使用 setOutputScale；作者生成器、滤镜 renderScale、文字、网页、嵌套、代码输入及 Worker 回传画布跟随实际输出比例，支持连续缩小及放大。预览入口仍只接受 1/2/4/8。
- 同画幅直接使用渲染画布编码；异画幅沿用原 source/destination 几何并按舍入后的源画布换算，补黑边或中心裁切。
- 导出设置新增“按输出分辨率渲染”，缺省开启；关闭恢复完整序列合成后缩放。沿用已有控件，没有视觉改造；设置、导出能力与预设反射共用现有 schema，没有新增工具。
- 导出循环按经过 250ms 发布进度并让出线程，替代每五帧一次。
- 切换比例清除相关帧缓存并取消旧画面提交；既有和新建的嵌套、代码输入、相邻帧会话同步继承比例。
- 剪辑内容 43→44、录制会话 46→47、导出预设 2→3；新增逐版本纯迁移与三个黄金样本，最低可读版本保持 42/45/1。旧样本未改写。

## 验证
- 最终 `verify:changed -- --level L2` 显式 37 文件全部 12 项通过，退出码 0：15 个测试文件、626 项测试，改动文件 ESLint、渲染层及 Electron 类型检查、严格界面表面/颜色/图标/残留/间距动效、依赖图、主进程导入边界与 64 种持久格式兼容检查。日志：`D:/VibeCode/Henji-AI-t06/.tmp/verify-output-resolution.log`。
- 严格界面扫描有 356 条存量启发式告警，语法错误 0；颜色检查提示一条无关存量登记可以收紧，本次未改动。暂存区与提交均经 `git diff --check` 核对。
- 能力覆盖检查 `npm run check:assistant-capabilities`：31 个文件、237 项通过。日志：`.tmp/output-resolution-capabilities.log`。
- `npm run persistence:baseline` 与 `npm run persistence:release-snapshot` 已完成。
- 对比脚本 `node --check` 通过；没有实际运行单帧渲染。
- 首次 L2 已通过当时的测试和 ESLint，渲染层 tsc 因 Node 默认约 4GiB 堆不足退出；重跑仅为该命令的子进程设置 12GiB 堆，结束恢复原环境变量，未改项目配置。

完整复验命令（PowerShell，在本 worktree 执行；NODE_OPTIONS 建议在临时终端设置，用后恢复）：

```powershell
$env:NODE_OPTIONS = '--max-old-space-size=12288'
npm run verify:changed -- --level L2 `
  scripts/generate-persistence-fixtures.ts `
  src/core/application-control/domains/videoEdit/videoEditExportCapabilities.ts `
  src/core/documents/kinds/screenRecording.ts `
  src/core/documents/kinds/videoEdit.ts `
  src/core/persistence/formatMigrations.ts `
  src/core/persistence/persistence.test.ts `
  src/core/persistence/releasedCompatibility.json `
  src/core/persistence/schemaBaseline.json `
  src/core/persistence/schemaVersions.ts `
  src/core/persistence/versionedJson.ts `
  src/core/videoEdit/exportPresets.test.ts `
  src/core/videoEdit/exportPresets.ts `
  src/core/videoEdit/playbackResolution.test.ts `
  src/core/videoEdit/playbackResolution.ts `
  src/features/videoEdit/application/videoEditExport.ts `
  src/features/videoEdit/application/videoEditExportFrame.ts `
  src/features/videoEdit/application/videoEditExportFrame.test.ts `
  src/features/videoEdit/application/videoEditExportPresetReflection.ts `
  src/features/videoEdit/application/videoEditExportPreviews.test.ts `
  src/features/videoEdit/application/videoEditExportQueue.test.tsx `
  src/features/videoEdit/engine/videoEditAuthorGpuLifecycle.test.ts `
  src/features/videoEdit/engine/videoEditCodeGpu.ts `
  src/features/videoEdit/engine/videoEditCodeSources.test.ts `
  src/features/videoEdit/engine/videoEditCodeSources.ts `
  src/features/videoEdit/engine/videoEditGpuCompositor.test.ts `
  src/features/videoEdit/engine/videoEditGpuCompositor.ts `
  src/features/videoEdit/engine/videoEditRenderSession.test.ts `
  src/features/videoEdit/engine/videoEditRenderTransport.ts `
  src/features/videoEdit/engine/videoEditRenderer.test.ts `
  src/features/videoEdit/engine/videoEditRenderer.ts `
  src/features/videoEdit/engine/videoEditWorker.ts `
  src/features/videoEdit/panels/VideoEditExportFields.tsx `
  tests/fixtures/persistence/document.screen_recording/v47.json `
  tests/fixtures/persistence/document.video_edit/v44.json `
  tests/fixtures/persistence/export-presets/v3.json `
  src/features/videoEdit/engine/videoEditWebInputs.ts `
  src/features/videoEdit/engine/videoEditWebInputs.test.ts `
  --test src/features/videoEdit/application/videoEditExportQueue.test.tsx `
  --test src/core/persistence/persistence.test.ts
```

## 审查与实际排查范围
- 干净的独立 Codex 上下文共审查三轮；第一轮发现极端横竖裁切的中间画幅超规格，已增加完整序列回退；第二轮发现实验性结构化图形缩放的超规格与缓存键问题，已完整撤回这部分非必要增量；第三轮检查规格回退、作者及嵌套尺寸/预算/继承、transport 一致性，未发现有证据的新增正确性问题。
- 已检查连续比例的根合成、作者生成器与滤镜、网页、嵌套与多机位、代码输入、相邻帧输入、Worker 回传和缓存切换；相应单测覆盖正常与边界行为。
- 已检查 ticket 01 的共享帧缓存相关调用和 ticket 02 的 usePreviews 准入，未修改缓存内容身份、失效规则及“预览规格不低于输出”的判定；增补两种合成路径的预览准入测试。
- 未验证真实 GPU 画面、真实网页渲染或实际速度，不能据此宣称人眼一致或已经加速。

## 偏离与取舍
- 极端宽高比裁切前的中间画幅可能超过既有最大边长/像素规格；这类合法输出自动采用完整序列合成路径。放大中遇到大尺寸作者/子序列，放大目标超规格时保留该输入原生采样，父合成仍按输出尺寸完成，避免分配失败。
- 结构化图形保持原生栅格实现；视频连续比例保留源采样后由现有 GPU 合成纹理缩放。整数预览继续用原 box 缩小，没有新增重采样算法或依赖。依据是复用已有成熟路径，避免改变预览行为和无关缓存语义。
- 计划指定的 Opus 审查模型当前不可调用，使用独立 Codex 上下文审查。
- 不执行真实画面对比和速度测试，按用户要求交给 Claude。默认开启尚需该项人工验收确认。

## 单帧对比交接
文件：同目录 `compare-frame.js`。Claude 在**加载本分支源码的独立 Electron 开发实例**中，打开目标剪辑和目标序列，再将脚本粘贴到渲染进程开发控制台。不要连接或更改端口 9334 的现有实例。

```javascript
// 从准确的已打开剪辑文档 ID 和当前序列实际 fps 计算帧号；下面以 60fps 的 17.5 秒为例。
const comparison = await compareExportFrame('准确的剪辑文档ID', Math.round(17.5 * 60), 1920, 1080)
comparison.results // 两条路径的内存 PNG、url、渲染尺寸、初始化/预热/渲染/拷贝/单帧合计耗时
// 分别打开 results[0].url、results[1].url 检查，完成后释放：
comparison.release()
```

两条路径使用同一个结构化克隆的序列快照和同一帧，先渲染前一帧预热，再计时目标帧，禁用预览文件；PNG 转换不计入单帧时间。区域/跟踪分析沿用正式流程并可能补齐缓存，不保存项目，不创建导出任务，不编码视频、不写成片。网页和解码的首次缓存会影响绝对耗时，建议同一帧重复执行并比较稳定后的中位数。frame=0 没有前一帧预热，结果包含首次取帧成本。

Claude 后续检查《元宝搜索》16–19 秒点阵、细线、文字、网页段各一帧，记录可见差别及两条路径耗时，再决定默认开启是否保留。

## 约束
本次未启动应用、未触碰端口 9334、未访问 D:\视频制作、未跑 Reality、未导出成片、未删除或重装 node_modules 联接点；不推送。对比脚本仅准备好，未执行。

## 提交 diff --stat
三个新增黄金样本共 2992 行；总计 37 文件，+3339/-100。设计、结果和单帧脚本位于仓库外的指定 ticket 目录，不计入这个代码提交。

```text
 scripts/generate-persistence-fixtures.ts           |    4 +-
 .../videoEdit/videoEditExportCapabilities.ts       |    2 +-
 src/core/documents/kinds/screenRecording.ts        |    4 +-
 src/core/documents/kinds/videoEdit.ts              |    2 +
 src/core/persistence/formatMigrations.ts           |    3 +-
 src/core/persistence/persistence.test.ts           |   22 +
 src/core/persistence/releasedCompatibility.json    |   27 +-
 src/core/persistence/schemaBaseline.json           |   12 +-
 src/core/persistence/schemaVersions.ts             |    2 +-
 src/core/persistence/versionedJson.ts              |    2 +-
 src/core/videoEdit/exportPresets.test.ts           |   33 +-
 src/core/videoEdit/exportPresets.ts                |   19 +-
 src/core/videoEdit/playbackResolution.test.ts      |   17 +-
 src/core/videoEdit/playbackResolution.ts           |   14 +-
 .../videoEdit/application/videoEditExport.ts       |   20 +-
 .../application/videoEditExportFrame.test.ts       |   30 +
 .../videoEdit/application/videoEditExportFrame.ts  |   29 +
 .../application/videoEditExportPresetReflection.ts |    2 +-
 .../application/videoEditExportPreviews.test.ts    |    8 +
 .../application/videoEditExportQueue.test.tsx      |   12 +-
 .../engine/videoEditAuthorGpuLifecycle.test.ts     |   12 +
 src/features/videoEdit/engine/videoEditCodeGpu.ts  |   16 +-
 .../videoEdit/engine/videoEditCodeSources.test.ts  |   14 +
 .../videoEdit/engine/videoEditCodeSources.ts       |    4 +-
 .../engine/videoEditGpuCompositor.test.ts          |    2 +-
 .../videoEdit/engine/videoEditGpuCompositor.ts     |   12 +-
 .../engine/videoEditRenderSession.test.ts          |   19 +-
 .../videoEdit/engine/videoEditRenderTransport.ts   |   14 +-
 .../videoEdit/engine/videoEditRenderer.test.ts     |   34 +-
 src/features/videoEdit/engine/videoEditRenderer.ts |   45 +-
 .../videoEdit/engine/videoEditWebInputs.test.ts    |    2 +-
 .../videoEdit/engine/videoEditWebInputs.ts         |    2 +-
 src/features/videoEdit/engine/videoEditWorker.ts   |    6 +-
 .../videoEdit/panels/VideoEditExportFields.tsx     |    1 +
 .../persistence/document.screen_recording/v47.json |  533 +++++
 .../persistence/document.video_edit/v44.json       | 2416 ++++++++++++++++++++
 tests/fixtures/persistence/export-presets/v3.json  |   43 +
 37 files changed, 3339 insertions(+), 100 deletions(-)
```


## 2026-10-31 交叉审查修复与本地合并

本节替代上文“支持连续放大”“切换比例均取消旧画面”及相关放大回退说明。已在 `9669d1e53` 上追加修复提交 `42bcb29f8`（`fix(video-edit): 限制导出渲染比例并保留预览在途画面`），12 文件，+72/-29；随后将主仓库 main 从 `2f49fd3c8` 快进合并至 `42bcb29f8`，没有推送。ticket worktree 干净；主仓库已有文档改动和未跟踪文件保持原样。未删除分支、worktree 或 node_modules 联接点。

### 修复
- 导出渲染比例封顶为 1。1080p 导 4K、横版填充竖版与 8K 横竖填充均按序列尺寸渲染，再沿既有几何裁切、放大，不扩大中间合成画布。
- Renderer 网页取帧、空白回退元数据与 WebInputs 的输出倍率均夹到 ≤1；代码输入取样键采用实际网页倍率，避免等效设置使缓存失效。
- `setRenderDivisor` 保留预览只影响后续帧的语义，不取消在途代码或画面提交；仅实际合成或网页比例变化时清帧缓存。相同有效比例的设置切换不递增 presentationEpoch，也不清根与代码输入历史。导出实际比例变化仍取消旧提交；嵌套、代码输入、滤镜输入同步采用调用入口的语义。
- 四处作者说明统一为预览降分辨率与导出按输出分辨率渲染均提供 renderScale（≤1，省略即 1），像素长度据此缩放；两处过时注释同步修正。
- 本次修复没有修改持久格式、迁移或黄金样本；预览 1/2、1/4、1/8 及 usePreviews 准入判定未变。

### 本轮验证
- 按 testing.md 的 L2：涉及导出公共行为、共享渲染器及异步取消。`npm run verify:changed -- --level L2 <ticket 全部 41 文件...>` 通过，退出码 0，10 项检查全部通过：17 份测试、640 项，改动文件 ESLint、两套 TypeScript 类型检查、表面/颜色/图标/残留/间距动效门禁、64 种持久格式兼容。表面门禁仍为 356 条存量启发式告警、语法错误 0。本轮原命令、显式文件与完整输出：`D:/VibeCode/Henji-AI-t06/.tmp/t06-review-verify.log`；计划：同目录 `t06-review-verify-plan.log`。
- 41 文件为原提交的 37 文件，加 `resources/assistant-skills/video-edit-code-creation/references/author-api.md`、`author-shaders.md`、`resources/video-edit-author/author-api.d.ts`、`src/features/videoEdit/engine/videoEditAuthorModule.ts`。在上文完整复验命令中追加这四个路径，并追加 `--test src/features/videoEdit/engine/videoEditAuthorApiContract.test.ts --test src/features/videoEdit/engine/videoEditAuthorModules.test.ts` 即为本轮范围。只为验证子进程临时设置 12GiB Node 堆，结束恢复环境变量；未改项目配置。
- 定向测试先行：导出预设、Renderer、WebInputs 三文件 160 项通过；日志 `t06-review-targeted.log`。
- 断牙验证：临时恢复本轮三个运行时源文件到缺陷基线，定向 5 项中 4 项失败、1 项通过；随后按字节恢复修复文件并校验 SHA-256 一致，5 项全部通过。其他 155 项仅因名称过滤未运行，不计为此次通过；它们已包含在前述 640 项通过中。日志 `t06-review-red.log`、`t06-review-green.log`。
- 独立全新上下文只读审查 1 轮，未发现有证据的重要或小问题；审查完成后的源码没有新增改动。`git diff --check` 与暂存区文件核对通过。

### 实际排查与边界
已核对根合成、网页取帧及空白回退、作者说明、嵌套序列、代码视频/下层输入、滤镜输入与预览/导出两入口的比例传播和取消行为；同源倍率问题已修复，相关定向检查未发现额外缺陷。没有做全项目审计，也未验证真实 GPU 画面或实际提速，不作相应结论。

本轮未运行或重启应用、未操作端口 9334 开发版、未访问 `D:\视频制作`、未跑 Reality、未导出；node_modules 联接点未删除或重装。仅本地提交与快进合并，未 push。

## Claude 真机验收（10-31 13:45，开发版，合并后 5ec02bca5）
- 合并：Codex 曾把分支快进合并进 main（两个提交），Claude 压成一个提交 5ec02bca5（树与 42bcb29f8 一致）。
- 画面（1080p 输出，《元宝搜索》4 帧，compare-frame.js）：按输出 vs 完整合成再缩小 PSNR 1050 帧 44.8dB、1800 帧 48.7dB、6200 帧（网页）53.9dB、20550 帧（额度卡）41.3dB；差别只在文字与点阵边缘抗锯齿，放大 2 倍并排人眼看不出差别 → 默认开启。
- 速度（连续 30 帧平均，每帧 ms，按输出 / 完整合成）：正文字 1050 起 14.1 / 27.9；额度卡 20550 起 14.7 / 21.8；花字 1800 起 19.9 / 21.4；网页 6150 起 18.5 / 20.2（网页倍率两条路都已随输出，见 ticket 03；原整片导出网页段约 50ms）。
- 未做：整片导出耗时实测（不导出成片，留给用户下次导出时看 `video_edit.export.performance`）。
