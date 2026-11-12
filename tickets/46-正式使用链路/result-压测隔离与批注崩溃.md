# 结果：压测隔离与批注批量写入崩溃

日期：2026-11-13。未提交，未碰 git；未启动或操作开发版；用户数据目录只读。

## 一、压测脚本没有隔离用户数据（已修）

### 核实

属实。共用启动器 `scripts/lib/electronLaunch.cjs` 的 `isolateUserData` 默认是 `false`：哪个脚本忘了传参数，就直接用真实资料目录（E:\文档\HenjiAI）。`electron:canvas-stress`、`electron:pan-bench` 都没传；`electron:updater-e2e` 同样没传；`check:canvas-visual` 只有设了 `VISUAL_ISOLATED=1` 才隔离。

### 改法：从结构上把默认值改成隔离

- 启动器的默认值改成隔离（新建临时目录，退出后回收），只有显式传 `realUserData: true` 才用真实资料。判断写成纯函数 `resolveUserDataMode`（`scripts/lib/electronLaunchTarget.cjs`），只认布尔 `true`，`'true'`、`1` 都不算。
- 旧参数 `isolateUserData` 删除；再有人传就直接报错，免得旧调用方以为自己还在用真实资料。
- `electron:pan-bench` 原来要在真实目录里按名字找 TEST 画布（真实目录里现在也已经没有 TEST 画布了）。改为默认在隔离目录里运行：源画布由 `BENCH_SOURCE_PACKAGE=<单文档包绝对路径>` 指定，先在应用里把要测的画布导出成包，脚本再用正式的 `documents.importPackage` 导入隔离目录。素材随包一起复制，测的仍是真实负载。没给包时直接报错并说明用法；只有 `BENCH_REAL_DATA=1` 才回到原来那种读写真实资料的方式。
- `check:canvas-visual` 默认隔离：源项目不存在时，原本就会自动造一份合成源画布。`VISUAL_REAL_DATA=1` 才读写真实工程，`VISUAL_ISOLATED` 已不再需要。
- `testing.md` 画布基准的命令行改成带上 `BENCH_SOURCE_PACKAGE`，并加一句通则：自动化启动默认隔离，读写真实资料只能显式要求。

### 逐个核对 package.json 里会启动应用的脚本

| 脚本 | 改前 | 改后 |
|---|---|---|
| `electron:canvas-stress` | 真实资料（没传参数） | 隔离（默认） |
| `electron:pan-bench` | 真实资料，读 TEST 画布 | 隔离，源画布用包导入；`BENCH_REAL_DATA=1` 才用真实资料 |
| `electron:updater-e2e` | 真实资料（没传参数） | 隔离（默认）；更新检查读应用目录里的 dev-app-update.yml，下载缓存在已重定向的 LOCALAPPDATA，不需要真实资料 |
| `check:canvas-visual` | 真实资料，`VISUAL_ISOLATED=1` 才隔离 | 隔离；`VISUAL_REAL_DATA=1` 才用真实资料 |
| `electron:smoke` | 隔离 | 隔离（默认，删掉了多余的参数） |
| `electron:dpi-check` | 隔离（巡检启动器 temporary） | 不变 |
| `ui:tour`、`check:ui-visual`、`test:ui-visual-rules` | 隔离，`--profile real` 才用真实资料 | 不变（改为传 `realUserData: profile === 'real'`） |
| `test:reality` | 隔离，`--profile real` 才用真实资料 | 不变 |
| `bench:video-edit` | 隔离 | 隔离（默认，删掉了多余的参数；脚本自己还会核对 HENJI_ISOLATED_APP_DATA） |
| `electron:media-import-bench` | 不启动应用，只用系统临时目录和 ffmpeg | 不涉及 |
| `test:assistant-persistence`、`test:assistant-production` | 用 ELECTRON_RUN_AS_NODE 跑 vitest，系统临时目录 | 不涉及 |
| `image-editor:v3:perf*`、`test:performance` | vite-node 或 vitest，不启动应用 | 不涉及 |
| `assistant:cli`、`llm:verify` | 真实配置 | 按设计不变：AGENTS.md 规定它们在真实配置、真实凭据上运行，用户执行这些命令本身就是点名要真实环境 |
| `electron:dev`、`electron:prod` | 真实资料 | 按设计不变（日常开发版和正式行为） |

不在 package.json 里、但也用这个启动器的脚本：`mcp-external-client-check`、`mcp-restart-check` 已经隔离（后者自带隔离目录，跨两次启动沿用）。`mcp-paid-generation-check`、`mcp-media-chain-paid-check` 是付费验收，必须用真实凭据，改成在代码里显式写 `realUserData: true`。

### 验证

- 新增单测：`scripts/lib/electronLaunchTarget.test.cjs` 加了默认隔离的用例（含旧参数名和非布尔真值）；新文件 `scripts/lib/canvasPanBench.test.cjs` 验证没给包时拒绝启动、只有 `BENCH_REAL_DATA=1` 才用真实资料。`node --test` 5/5 通过；新文件已登记到 `scripts/node-test-suites.json`，`run-node-tests --check` 通过（78 个文件）。
- 干跑：用临时记录器替换 playwright 的 `_electron.launch`，跑到真实脚本“启动应用”那一步就记下参数并退出，应用没有真正启动。canvas-stress、updater-e2e、canvas-visual、smoke 都传了 `--user-data-dir=%TEMP%\henji-electron-test-*`，HENJI_ISOLATED_APP_DATA、APPDATA、LOCALAPPDATA 都指向这个临时目录。pan-bench 给了包时同样隔离；没给包时报出预期的提示；只有 `BENCH_REAL_DATA=1` 时才不带隔离参数。干跑脚本在 scratchpad，没有进仓库。
- 没跑这两个脚本本身（按要求）。pan-bench 的包导入还没在真实 Electron 里走过一遍。

## 二、助手批量改批注时渲染进程崩溃

### 能找到的证据

- 日志：E:\文档\HenjiAI\.system\logs 只剩 11-11、11-12 两天，10-28 当天的日志在数据目录迁移后已经不在了；备份目录里也没有日志。11-12 有 3 条 `window.render_process.gone`，都是 `reason: clean-exit, exitCode: 0`（正常退出，不是崩溃）。找不到同类访问冲突的第二个样本。
- 崩溃转储：%APPDATA%\henji-ai\Crashpad\reports 有 6 份转储（10-28 16:32/16:33、10-29 12:11、10-29 23:50）。我写了一个只读的 minidump 解析脚本，结果 6 份全部是渲染进程（ptype renderer，Electron 44.9.3），异常码全是 `0x80000003`（断点/CHECK 失败），没有一份是 `0xC0000005`。第 10 条的崩溃在 10-28 08:16（本地时间；问题记录的提交时间是 08:32 +0800）。crashReporter 是当天 14:05 的提交 `1b42eda5d` 才启用的，所以那次崩溃本来就没有转储。这 6 份转储属于另一类崩溃，与第 10 条无关，可以单独再查。

### 代码路径

1. 通用写入（`VideoEditMutationExecutor.apply`，`videoEditExecutors.ts`）每条批注各做一次：读数据、`settleVideoEditAnnotationChange`、`editVideoProject`，提交时整份文档冻结并推进版本。
2. **崩溃当时**：每一步各发一次通知，20 条批注就是 20 次界面与预览通知。**当天 15:15 的提交 `7378a7d68`** 已经把同一事务里对同一份剪辑的多步写入合成一次提交（`VideoEditCommitBatch`）：每步照常校验、推进版本，界面、预览通知、操作事实和撤销步骤都在事务结束时只发一次。也就是说，“合并成一次提交、一次渲染更新”这一条早就做了，不用重做。
3. **这次找到并修掉的缺口**：节目预览（`VideoEditPreview.tsx`）不靠通知，而是每次推进时轮询当前合成（`videoMotionComposition`）。合成包含序列的 `annotations` 和 `markers`，所以批注一改，`videoEditParameterUpdate` 就判成结构变化，走完整更新：主线程停音频，重新核对内容、字体和代码源；Worker 里 `VideoEditRenderer.updateDocument` 会**无条件释放全部嵌套序列渲染器、嵌套声音、代码视频输入和滤镜输入的渲染器**（这些渲染器各自持有解码会话，以及从原生解码器借来的共享纹理帧），下一帧再全部重建。可是批注根本不进画面：预渲染缓存的画面标识（`core/videoEdit/renderCache.ts`）本来就不算 annotations 和 markers。合并提交之后，同一份文档至少还要整套重建一次；事务各步之间要等待时，预览还能看到中间版本，每轮推进各重建一次。

### 判断

- **最可能的原因（中低置信度，没有转储，也没有复现）**：20 条批注在约 3 秒内连续写入，每次都让 Worker 拆掉、重建嵌套和代码视频输入的渲染器，正片上又有多段 4K 录屏在用原生解码器的共享纹理帧。`videoEditNativeFrames.ts` 的注释写明，共享纹理帧在 Worker 线程上释放（或丢掉不还、被回收）会让整个渲染进程崩溃。连续释放、重建会话时，只要有一帧在途的帧没按规定交回主线程关闭，或者导入的外部纹理在提交的 GPU 工作完成前就被释放，就会是访问冲突这类原生崩溃。退出码 -1073741819 与此吻合，批注写入本身（纯 JS、zod 校验）不会造成访问冲突。
- 不支持其他解释的证据：批注写入路径里没有原生调用；每步一次的整份校验只花 CPU，不会访问冲突。
- 没法证明的部分：到底是哪个释放点出错，要等有 `0xC0000005` 转储后，用带符号的 Electron 栈来定位。现在 crashReporter 已经开着，下次再崩会留下转储，日志里也会记下转储的文件名。

### 已做的防御（不靠复现也成立）

`src/features/videoEdit/engine/videoEditParameterUpdate.ts`：比较时把 `annotations`、`markers` 当作只属于审片的字段。只改它们时返回一个空补丁的参数更新：Worker 只推进版本号，不释放、不重建任何解码器和渲染器，也不停音频、不重画当前帧；如果同时改了画面，仍走完整更新。这个改动没碰 `videoEditService.ts` 和 `applicationDomain.ts`。

验证：`videoEditParameterUpdate.test.ts` 新增一条用例（只改批注、标记时补丁为空且不影响声音和字体；同时改了片段时仍是完整更新），110/110 通过；直接使用它的 `VideoEditPreview.test.tsx` 60/60 通过；两个文件 ESLint 通过；渲染层 `tsc -p tsconfig.json --noEmit` 只报 `src/core/audioEdit/subtitles.ts(35)` 的 `findLastIndex` 两条错误。那是别人正在改的文件，不是本次改动带进来的；本次改动的文件没有类型错误。

## 改动文件

- `scripts/lib/electronLaunch.cjs`、`scripts/lib/electronLaunchTarget.cjs`、`scripts/lib/electronLaunchTarget.test.cjs`
- `scripts/lib/canvasPanBench.cjs`、`scripts/lib/canvasPanBench.test.cjs`（新）、`scripts/node-test-suites.json`
- `scripts/electron-canvas-pan-bench.cjs`、`scripts/electron-canvas-visual-check.cjs`
- `scripts/electron-phase4-smoke.cjs`、`scripts/bench-video-edit.cjs`、`scripts/lib/benchVideoEditCodeOutput.cjs`、`scripts/mcp-external-client-check.cjs`、`scripts/lib/uiInspection.cjs`
- `scripts/mcp-paid-generation-check.cjs`、`scripts/mcp-media-chain-paid-check.cjs`
- `docs/rules/testing.md`
- `src/features/videoEdit/engine/videoEditParameterUpdate.ts`、`src/features/videoEdit/engine/videoEditParameterUpdate.test.ts`

## 没做的事与原因

- 没真跑 pan-bench、canvas-stress（按要求；会写数据）。pan-bench 的包导入流程只验证到“解析参数、隔离启动”这一步。
- 没有复现批注崩溃，也没有定位到具体的原生释放点：没有对应的转储，日志也已经不在了，而且不能操作开发版。
- 那 6 份 0x80000003 渲染进程转储是另一类崩溃，本次没查（不在本任务范围内；需要 Electron 44.9.3 的符号）。
- 没处理“完整更新会无条件释放嵌套和代码输入渲染器”本身（比如只释放媒体真正变了的那些）。它属于渲染器生命周期的改动，范围大，最好有转储佐证后再动。
- 每步一次整份校验的写入提速，原提交里已说明“另行处理”，本次没动。
