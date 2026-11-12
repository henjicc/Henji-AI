摘要：自动预渲染改为只在用户真闲着、显卡真有余量时才做。三轮审查意见都已处理。
- 多机位节目不再自动预渲染：之前每次打开约 20 秒、4 个窗口、200Mbps，现在空闲 45 秒都不开始。
- 第一轮实测（模拟焦点）：2 倍速 4K 片段编辑后 10 秒开始预渲染，半速运行时显卡解码 22–30%、编码 6–11%；一次按键后 5 毫秒内停止，约 0.8 秒后解码、编码归零。
- 第二轮实测：窗口没有焦点时同一段 2 倍速片段不开始（编码器全程 0%）。
- “全系统空闲”这条路径需要主进程与预加载换成新代码，开发版需要重启。按约束没有重启，这条路径只有精确测试，真实窗口未验证，需要你决定何时重启开发版。
- 改动文件 tsc（渲染层与 electron 两个工程）、ESLint、IPC 契约检查全部通过。

# 一、现状与根因
- 调度入口是 `videoEditRenderCache.ts` 的 `ensureAutoRender`，每秒轮询一次。原来的启动条件：首帧已上屏、编辑停下 3 秒、节目操作后 10 秒、本实例不在播放/拖动/导出。任务内只在播放、拖动、跳转、导出时让出；每帧歇同样长（占空比 1:1），一次只在途一帧。
- 根因一：`core/videoEdit/renderCache.ts` 的 `heavyClips` 把所有嵌套序列（含多机位片段）都算成吃力，打开多机位文档 3 秒后就自动渲染。节目里的多机位片段只解所选那一路，本来就轻；预渲染出的 200Mbps 全关键帧文件比原片还难解，W5-A 里节目侧的“第 5 路”就是它。
- 根因二：多机位格子同时解四路期间，节目丢帧也计入实测。这会把原本轻的段标成“掉帧”，从而触发预渲染。
- 根因三：启动只等 3 秒，不看用户输入、焦点与前台任务；几个剪辑可以各跑一个预渲染；渲染很快时 1:1 占空比照样能超实时（实测 4K 约 65 帧/秒）。

# 二、改法
1. **值不值得**（`core/videoEdit/renderCache.ts`）
   - 多机位片段按所选那一路判断，普通嵌套序列仍算吃力。
   - 变速只有快放与倒放算吃力：`videoEditClipSpeedRange` 的最大值大于 1，或倒放。时间重映射没有负速度，按同一速度范围判断。定格（包括时间重映射加定格）先排除。慢放是顺序解码，比原速还轻，不算。
   - 实测掉帧的段照常触发，包括带较重内置效果的段与图片段。
   - 从源头去掉污染：多机位监视器每请求一帧网格画面就调用一次 `noteVideoEditProgramSideLoad`。最近 1 秒内登记过时，节目回执不进实测。监视器隐藏、格子尺寸为零时不出帧，也就不登记；格子停下 1 秒后恢复计入。用时间戳而不是成对的登记/释放，漏释放不会让统计永久失效。
   - 多机位源序列作为当前序列时不自动预渲染：渲染它要同时解全部机位，而节目里的多机位片段并不读源序列的预览文件。
2. **启动条件**（`ensureAutoRender`，全部满足才开始）
   - 打开或新建后已过 30 秒，编辑停下 10 秒，节目操作后 10 秒，首帧已上屏。
   - **用户闲着**（`videoEditUserIdleBasis`）：窗口可见（副屏可见即可），并满足下面两条之一：
     - 全系统空闲 ≥ 30 秒：主进程 `powerMonitor.getSystemIdleTime()`，不看焦点，覆盖“挂着软件去做别的事、窗口在副屏”。
     - 窗口有焦点且应用内 10 秒没有输入。
     - 用户在别的程序里操作时，全系统空闲达不到、窗口也没有焦点，自然不会开始。
   - 任一剪辑都不在播放、拖动、导出，也没有占显卡的前台任务（见第 3 条）。
   - 全机同时只有一个预渲染。
   - 日志 `auto_start` 带 idleBasis（system 或 app）。
3. **占显卡的前台任务**（`videoEditRenderCacheForeground.ts`）
   - 录屏：录屏状态只读订阅。
   - 建代理：`videoEditProxyGenerating`。
   - 跟踪（含稳定）：新增 `videoEditTrackingActive`，取跟踪状态表里正在跟踪的条目。
   - 智能区域：新增 `videoEditSmartRegionsActive`，取正在分析的条目。
   - 场景检测：新增 `videoEditSceneDetectionActive`，计数进行中的检测。
   - 剪辑上登记的长任务，名单为：export、屏幕录制、导演录制、录制成片、重录替换、自动重构画幅、敏感文字识别、注意力推近。
   - 其他登记（云端生成、字幕、节拍、音频处理、多机位声音同步、动作示范等）只为保活或只用声音，不让预渲染停下。
   - 原生解码服务和分析服务都没有“在途会话数”一类的全局信号（`videoDecoder.status()` 只有 available 与 forcedBackend），接入需要改原生服务，所以以名单和各自的状态表为准。“字幕提取”经核实是按文字剪辑，不解码画面，不在名单里。
4. **让出**
   - **自动任务**：遇到下面任一情况直接结束，已完成的窗口保留，空闲后由调度重新发起：
     - 应用内输入或失焦；
     - 全系统出现输入（空闲时长归零），最多 2 秒内发现；
     - 窗口被隐藏；
     - 有占显卡的前台任务；
     - 别的剪辑有用户或助手发起的渲染。
   - 自动任务遇到播放、拖动、跳转，沿用原来的“暂停、释放会话、空闲后从被打断的窗口重来”。
   - **用户或助手发起的任务**：只为录屏暂停，此时 `rendering.paused` 为“正在录屏，录完后继续渲染”，命令标题显示“取消渲染（正在录屏，录完后继续渲染，N%）”。暂停原因在恢复时清除，与有没有释放过会话无关；会话打开前就遇到录屏也会清除。
   - `videoEditRenderCacheBusy` 只在正在算窗口或有窗口在渲染时为真。
   - 让出时，两个窗口之间仍开着的会话也一并释放。
5. **全系统空闲查询**（新增最小 IPC）
   - 主进程 `system:idleSeconds`：参数用 `parseVoid` 校验，只返回秒数。
   - 预加载侧是 `diagnostics.idleSeconds`；平台层是 `system.idleSeconds()`。
   - 渲染层由调用方驱动采样，距上次采样超过 2 秒才在后台再取一次，不另开定时器；取不到时按“用户在操作”处理，只剩应用内空闲那一条。
6. **窗口隐藏时**：正式版主窗口开着后台节流（`electron/main/window-presentation.ts`）。窗口最小化或被完全遮挡时，渲染层定时器被节流到至少 1 秒，隐藏 5 分钟后链式定时器还会被压到约每分钟一次。自动预渲染的逐帧节拍（半速限速、占空比的 `rest`）和调度节拍都在主线程上，隐藏时推进不了。让它推进需要把节拍搬进 Worker，改动大，所以限定为：只在窗口可见时进行，副屏可见即可；隐藏时不开始，在跑的立即停止。开发版用 `--background` 启动时关闭了后台节流，最小化时 `visibilityState` 仍是 visible，与正式版不同。
7. **强度**：自动任务最快按实时速度的一半出帧，再与 1:1 占空比取两者中更慢的。
8. **日志**
   - `auto_start`：启动原因（idleBasis、openedMs、editIdleMs、inputIdleMs、interactionIdleMs）与候选窗口数。
   - `preempted`：带 reason 与任务名；被系统输入或隐藏停下时 task 为 away。
   - `resumed`：带本次暂停时长。
   - `completed` / `cancelled`：带取消原因、elapsedMs、累计 pausedMs、yields。

没有新增设置项，“自动预渲染”开关保留。预渲染本身（窗口切分、编码、缓存）没有改。

# 三、改动文件
- 渲染层
  - `src/features/videoEdit/application/videoEditRenderCache.ts`：调度、让出、限速、占用判断、节目旁负载、日志。
  - `src/features/videoEdit/application/videoEditRenderCacheForeground.ts`（新）：输入与失焦、用户是否闲着、录屏、占显卡的前台任务。
  - `src/core/videoEdit/renderCache.ts`：多机位与变速的“吃力”判断。
  - `src/features/videoEdit/panels/videoEditMulticamMonitor.ts`：出帧时登记节目旁负载。
  - `src/features/videoEdit/application/videoEditCommands.ts`：渲染命令标题显示暂停原因。
  - 只读导出，各几行：
    - `src/features/videoEdit/application/videoEditProxy.ts`：`videoEditProxyGenerating`
    - `src/features/videoEdit/application/videoEditService.ts`：`listVideoEditActivities`
    - `src/features/videoEdit/application/videoEditTracking.ts`：`videoEditTrackingActive`
    - `src/features/videoEdit/application/videoEditSmartRegions.ts`：`videoEditSmartRegionsActive`
    - `src/features/videoEdit/application/videoEditSceneDetection.ts`：`videoEditSceneDetectionActive`，外加进行中计数
  - 平台层：`src/platform/contracts/system.ts`、`src/platform/adapters/electron/system.ts`，新增 `idleSeconds`。
- 主进程与预加载：`electron/main/ipc/system.ts`、`electron/preload/index.ts`、`electron/preload/api-projects.d.ts`，新增 `system:idleSeconds`。
- 测试
  - `src/features/videoEdit/application/videoEditRenderCache.test.ts`
  - `src/core/videoEdit/renderCache.test.ts`
  - `src/features/videoEdit/panels/videoEditMulticamMonitor.test.ts`（新）
  - `src/features/videoEdit/application/videoEditRenderCacheCapability.test.ts`：补齐原有替身。
  - `electron/main/ipc/system.test.ts`
- 证据：`tickets/45-全局性能/验收证据/第五轮/`
  - 采样：`open-after-gpu.csv`、`multicam-focus-gpu.csv`、`speed2x-yield-gpu.csv`、`unfocused-speed2x-gpu.csv`
  - 脚本：`autoyield.cjs`

# 四、测试（全部通过）
- `src/features/videoEdit/application/videoEditRenderCache.test.ts`，45 个，本轮新增或改写：
  - 启动等待：打开 30 秒内、停播 10 秒内不开始；半速时相邻两帧开始间隔不少于 1000/(fps×0.5)。
  - 不开始的条件：编辑停下不到 10 秒、10 秒内有输入、有建代理、失焦。
  - 应用不在前台：全系统空闲时开始，全系统一有输入就停止，半成品不提交。
  - 自动任务遇到输入：任务结束、释放会话、`rendering` 为 null、`busy` 为 false；空闲后重新发起，已完成窗口的帧不重渲。
  - 用户发起的任务：建代理与点按不暂停；录屏暂停并显示原因，暂停期间 `busy` 为 false；录完续上。
  - 会话打开前就遇到录屏：暂停原因出现，录完续上时清除（第二轮审查第 3 条）。
  - 节目旁负载：格子在解码时节目掉帧不计入，格子停下 1 秒后恢复计入；普通段正常掉帧照常触发自动预渲染。
  - 首帧门槛。
- `src/core/videoEdit/renderCache.test.ts`，17 个：
  - 多机位按所选那一路判断；所选机位变速算吃力；普通嵌套仍吃力。
  - 2 倍速、倒放、超过原速的时间重映射算吃力；0.5 倍慢放、0.5 倍重映射、重映射加定格不算。
- `src/features/videoEdit/panels/videoEditMulticamMonitor.test.ts`（新）：格子没有尺寸时不出帧也不登记；请求一帧网格画面时登记（第二轮审查第 5 条）。
- `electron/main/ipc/system.test.ts`：`system:idleSeconds` 不接受参数，返回秒数。
- 直接消费者：`videoEditRenderCacheCapability.test.ts`（6 个，替身补齐后通过）、`videoEditCommands.test.ts`、`VideoEditPreview.test.tsx`、`videoEditSceneDetection.test.tsx`、`videoEditTracking.test.tsx`、`videoEditSmartRegions.test.tsx`。
- 静态检查：`npm run check:ipc-contract` 通过（448 请求）；ESLint 通过（渲染层 14 个、electron 4 个改动文件）。
- tsc：见八。

# 五、引擎版本散列范围（审查第一轮第 8 条，只评估）
- **现状**：`scripts/vite/renderEngineVersion.mjs` 把 `videoEditRenderCache.ts` 整个文件散列进 `RENDER_ENGINE_FILES`，只改调度也会让所有已有预览文件失效。
- **为什么这次不改**：本次的“吃力”判断改在 `core/videoEdit/renderCache.ts`，它在散列闭包里。只缩小调度文件的散列，这次提交照样会让缓存失效。
- **方案**（建议单独提交，在没有其他画面改动时发布）：
  1. 把 `renderWindow`（编码流参数、每帧关键帧、时间戳、精度与来源）和 `videoEditRenderProfile` 拆到新文件 `videoEditRenderCacheEncode.ts`，散列名单改列它。
  2. 把 `heavyClips` 移到闭包外的 `core/videoEdit/renderLoad.ts`，由应用层给窗口补标 `heavy`。
  3. 加一条测试：只改调度或吃力判断时，引擎版本不变。

# 六、真实窗口验证（开发版，调试端口 9334）
- **改之前**：18:16:37→18:16:57Z、18:17:56→18:18:17Z 两次打开“性能验收-多机位”，都自动渲染 4 个窗口（avc 200Mbps），各约 20 秒。
- **第一轮**（渲染层新代码，CDP 模拟焦点）
  - 打开文档后 80 秒没有 `render_cache` 事件；4 个窗口全是 realtime，needsRenderFrames 为 0。
  - 模拟焦点、空闲 45 秒：多机位不开始。
  - 2 倍速：19:45:28 `auto_start`（editIdleMs 10002）；运行中 GPU 15–21%、解码 22–30%、编码 6–11%。19:45:34.468 模拟按键，19:45:34.473 `preempted`（input），19:45:34.488 `cancelled`，19:45:35.27 解码、编码归零。重负载共 5.8 秒。
- **第二轮**（20:04 页面已加载本轮渲染层代码）
  - 窗口最小化在后台、没有焦点，2 倍速片段编辑后观察 40 秒：编码器全程 0%，没有 `render_cache` 事件（`unfocused-speed2x-gpu.csv`）。
  - 这次不开始，是因为开发版主进程与预加载还是 02:15 的旧产物，`idleSeconds` 不存在，“全系统空闲”这条拿不到，只剩“有焦点且应用内空闲”，而窗口没有焦点。
- **未验证**：“应用不在前台、全系统空闲 30 秒后开始，有系统输入即停”。开发版没有自动重建主进程和预加载，需要重启后才能实测。按约束没有重启，这条只有精确测试。重启后用 `第五轮/autoyield.cjs` 的思路即可：不模拟焦点，等全系统空闲 30 秒，看编码器起来，再动一下鼠标看它停下。
- **现场**
  - 第一轮的速度改动已撤销。
  - 第二轮途中页面整页重载过一次，撤销历史随之清空，`undo_video_edit` 回报完成但没有撤掉速度改动；之后用 `ripple_video_edit_clip_speed` 设回 100%，回读该片段：start 0、duration 1200、速度 100%，与原来一致。
  - 那次空撤销具体做了什么没法确认；按重载后撤销历史为空推断，应当什么也没改。建议你提交前看一眼“性能验收-多机位”。
  - 没有执行 git，`D:\视频制作` 未改动，开发版没有重启。

# 七、没做到的与风险
- **全系统空闲路径**：真实窗口未验证（见六）。全系统空闲按 2 秒采样，用户在别的程序里刚开始操作时，最多约 2 秒后才停下。
- **窗口隐藏时**：不预渲染（见二第 6 条），是有意的限定，不是缺陷。
- **前台任务名单**：靠名单与状态表，新增解码原片的分析任务要记得加进名单或给出状态。智能区域某个条目若卡在“分析中”（异常路径没有回写），自动预渲染会一直等着；目前分析失败都会回写 failed。
- **跨剪辑让出**：没有精确测试，测试替身造不出两个剪辑。
- **导入**：没有单独信号，靠“内容变了”和“用户输入”挡住。
- **其他工作区的显卡重活**（图片编辑、画布）：不算前台任务，只靠用户闲着的判断挡住。

# 八、tsc
- `tsc -p tsconfig.json --noEmit`：本次改动的文件零错误。全工程只剩别人文件里的现存错误（`src/features/audioEdit/application/audioEditReflectionResult.test.ts:220`、`zzAudioEditEditCost.bench.test.ts:63`）。
- `tsc -p tsconfig.electron.json --noEmit`：零错误。
