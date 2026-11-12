摘要：W3-E 完成代码与精确测试：多机位视图改为一个渲染会话（一个 Worker、一个 GPU 设备）把全部机位作为同一源序列的嵌套片段按网格合成为一张画面，Worker 在 GPU 上拷出整张网格后直接画到各格子自己的画布，不经主线程 2D 拷贝。
正向播放跟随节目时钟，按节目的呈现时刻走顺序播放解码（与节目同一套 playback 路径）；暂停、拖动、倒放按播放头定位；去掉 100ms 轮询。格子有代理就读代理，回放缩小倍数按格子实际显示宽度取。
未启动应用：4 机位 4K60 长 GOP 的网格实际帧率与节目是否掉帧，需主会话按文末步骤验证（看 `video_edit.multicam.playback.stats`）。

# 设计
- 网格合成（`engine/videoEditMulticamGrid.ts`）：网格是一份合成文档，N 个 `sequence` 片段都指向多机位源序列的条目，各自带 `multicamCameraId`，按 2 列（>4 机位 3 列）摆进 columns×rows 个源画面大小的画布，缩放 1/min(columns,rows) 正好一格。渲染器已有的嵌套路径按 `videoEditNestedPictureKey`（序列 + 机位）给每个机位一个嵌套渲染器，嵌套渲染器的合成器都从根合成器 `fork`，同一 GPU 设备、一次根合成。渲染器一行未改。
- 网格的时间轴就是源序列的时间轴（网格第 N 帧 = 源序列第 N 帧）：网格只带源序列、它用到的嵌套序列、条目与素材，不含父序列。父序列上切机位、加剪辑点不改网格内容，播放中按 1–9 切机位不会更新文档、不重建解码。父帧 → 网格帧由界面线程用当前片段的 `videoEditNestedFrame` 换算（与节目取同一幅源画面，剪辑点两侧连续）。
- 出帧调度（`panels/videoEditMulticamMonitor.ts`）：
  - 正向播放：节目每呈现一帧就把播放头设到这一帧。监视器从这些通知推算节目时钟零点（起播第一帧不按时钟，不参与；较早的观测直接采用，较晚的按 0.1 慢慢跟上，吸收声音时钟漂移），每个网格帧带上与节目同一公式的呈现时刻（deadline）走 `present(帧, sequential=true, …, deadline, submitted)`。在途帧上限与节目相同（3 个在途、2 个未提交），只提前排到“应在屏帧 + 3”，跟不上就用 `videoEditPlaybackTarget` 跳帧；慢放、定格相邻父帧映射到同一源帧时只画一次。停播或节目重新起播时 `stopPlayback` 撤下未上屏的播放帧。
  - 暂停、拖动（scrubbing）、倒放、倒放片段：按播放头 `present(帧, false, scrubbing)`，最多 2 个在途，Worker 当场跳过排队中被取代的旧请求；拖动松手后按精确方式重画一次。
  - 不再轮询：视图、领域变化和请求回执唤醒调度；网格内容只在领域变化时重算并比对内容键。
- 分辨率：`proxyProjectId` + `exportProxies: true`，机位格子有代理就读代理（不看节目的代理开关：格子小，代理够清楚，起停不必换回原片重建解码）。合成与纹理分开取倍数（审查返工后，见文末）：合成画布的倍数只按格子显示宽度取，各路纹理按各自解码尺寸只缩到格子大小。
- 呈现：网格会话初始化时把各格子的 `<canvas>` `transferControlToOffscreen()` 交给 Worker。Worker 每帧在合成提交里用已有的 GPU 位图拷贝钩子（`capture.gpu`，W3-C 导出也用它）拷出整张网格，再用 2D 画布 `drawImage(位图, 源矩形 → 格子)` 画进各格子画布（GPU 位图到 GPU 画布，不回读），位图随即关闭。播放帧仍是“提交后先回执”的两帧流水。
- 解码预算（W1-B）：网格会话在自己的 Worker 里有自己的原生帧源，播放读取是 required、只淘汰本会话的闲置会话；原生服务从不为预算关闭会话，所以网格不会挤掉节目当前帧的会话。
- 界面：布局与样式不变，只给 `<canvas>` 加了 `key`（源序列 + 机位 + 代次）：已交给 Worker 的画布不能再交第二次，每个新会话（换源序列、Worker 恢复、重试）换一批新画布。`onError` 改用 ref，不再因回调变化重建会话。切机位命令、高亮、点选格子、1–9 键原样保留。

# 对共享文件加的入口（只做增量）
- `videoEditRenderTransport.ts`：选项 `gridCells?: VideoEditGridSurfaces`（格子画布 + 列数），init 请求带上并转移这些画布。共 3 处，各一行。
- `videoEditWorker.ts`：
  - init 请求类型加 `gridCells?`；模块变量 `gridCells`；init 时建 `VideoEditGridCells`，`direct = !!surface || !!gridCells`（网格会话与节目一样不交回位图、建前瞻、播放帧先回执）。
  - render：网格会话（无 readRgb、无 history）也取 GPU 位图快照（`gpu: true`、`maxPixels: Infinity`），渲染返回后切给格子画布并关闭位图，不进回执。
  - dispose 时收起格子画布（宽高设 1）。
- `videoEditRenderer.ts`、`videoEditRenderSession*.ts`、合成器：未改。

# 改动文件
- 新增 `src/features/videoEdit/engine/videoEditMulticamGrid.ts`（网格合成、布局、缩小倍数、Worker 侧格子画布）与 `videoEditMulticamGrid.test.ts`。
- 新增 `src/features/videoEdit/panels/videoEditMulticamMonitor.ts`（会话生命周期、节目时钟、出帧调度、统计）。
- `src/features/videoEdit/panels/VideoEditMulticamView.tsx`（换画面来源，结构不变）、`VideoEditMulticamView.test.tsx`（按新设计重写，保留原三条恢复用例的语义）。
- `src/features/videoEdit/engine/videoEditWorker.ts`、`videoEditRenderTransport.ts`（见上）；`videoEditWorker.test.ts`、`videoEditRenderer.test.ts` 各加一条。

# 日志（logger `features.videoEdit.multicamPreview`）
- `video_edit.multicam.preview.start`（info）：projectId、sourceId、cameras、columns、rows、网格宽高、proxies（读代理的机位数）。
- `video_edit.multicam.preview.first_frame`（info）：从监视器建立到第一幅网格画面的 durationMs、cameras、divisor。
- `video_edit.multicam.playback.stats`（info，每次正向播放结束：停播、节目重新起播、关闭视图）：沿用节目播放统计的 `VideoEditPlaybackCollector`（与 `video_edit.playback.stats` 同一套字段：expectedFrames、presentedFrames、droppedFrames、droppedRatio、maxConsecutiveDropped、durationMs、renderMs 与 presentLatencyMs 分布、各渲染分段），另加 cameras、fps（网格即源序列帧率）、actualFps（(呈现帧数−1)/首末帧间隔）、divisor、网格宽高、proxies、reason。单位是网格帧。
- 原有 `video_edit.multicam.preview_recover.start|completed|failed` 保留（start 多了 delayMs）。

# 验证（均已实际执行）
- 级别 L2（跨线程协议、生命周期与恢复）。渲染层 tsc（heavy.sh，12GB 堆）零错误。
- vitest 5 个文件 251 条全部通过：`videoEditMulticamGrid.test.ts`（4，新）、`VideoEditMulticamView.test.tsx`（5，重写）、`videoEditRenderer.test.ts`（155，新增 1）、`videoEditWorker.test.ts`（45，新增 1）、`videoEditRenderSession.test.ts`（42，未改，确认传输层不受影响）。
- 改动的 9 个 TS/TSX 文件 eslint `--max-warnings 0` 通过；`check:surface`、`check:colors`、`check:dependency-graph` 通过（surface 的 350 条启发式告警均为原有文件）。
- 测试证明的内容：
  - 一个会话、一个设备：视图层 4 个机位只构造 1 个渲染会话、4 张画布全部交给它；渲染器层 2 个机位的网格只有根合成器，两个嵌套渲染器都是 `fork`（共用设备），一次根合成画出两格。
  - 顺序解码：渲染器层网格正向播放 6 帧，每个机位各建一条播放计划（共 2 条）、之后不再新建，两格的源时间都来自计划（把 `sequential` 改成定位时这条断言失败，已实测）；视图层播放时全部请求 `sequential=true`、deadline 等于节目时钟下该帧的呈现时刻、网格帧连续。
  - 画面对应机位与时间：每个网格片段嵌套后只剩自己机位的画面、四角正好落在自己那一格（与合成器同一套几何）；同一播放头取的源帧与节目相同；剪辑点两侧网格帧连续，切机位后网格内容键不变。
  - 切机位：高亮换到新机位，会话不重建、不更新文档、不重画。
  - 释放：卸载视图释放会话；Worker 关闭时格子画布收起；恢复时新会话等旧会话释放完才建立。
  - 其他：Worker 按格切位图、不交回位图、播放帧先回执；缩小倍数按最小解码宽度/代理宽度与显示宽度选，网格过大时提高；停播 `stopPlayback` 并写出帧统计。
- 改掉的旧断言：原视图测试钉的是“每机位一个会话、100ms 轮询、位图画到主线程画布、onError 变化即重建会话”，这正是本任务要改的；三条恢复语义（退避两次后显示重试、30 秒窗口重新计数、新会话等旧会话释放）在新设计上保留。

# 偏离
- 没有给渲染器加新入口：嵌套序列 + 机位键已有全部能力（独立嵌套渲染器、共用设备、播放计划随父帧下传）。
- 原生解码服务没有缩放输出，“降低解码分辨率”只能靠代理；没有代理时按格子尺寸降低的是复制进合成设备的纹理与合成尺寸（盒式缩小），解码本身仍是原片分辨率。
- 网格会话的暂停精确帧带着位图拷贝钩子，渲染器不把它当作可中途放弃的暂停帧（与改动前的多机位相同）；拖动中旧请求仍由 Worker 跳过。
- 节目时钟是从节目每帧更新的播放头推算的，比节目实际呈现时刻略晚（回执延迟，取最早观测压低）。若要严格同一时钟，需要节目（`VideoEditPreview.tsx`，不归本任务）把 `clockPerformanceStart / startFrame` 发布到共享状态，监视器直接读取。
- 代理不看节目的代理开关（见设计）；代理就绪或失效时网格对同一内容再交一次完整更新以重新选代理。

# 遗留：需主会话验证（真实 Electron，开发版即可；先 `electron:bundle` 或开发版热更新）
1. 准备 4 机位 4K60 长 GOP（HEVC 或 H.264，GOP ≥ 2 秒）工程，建多机位源序列放进时间线；不建代理。打开节目面板的“多机位视图”，从片段中段起播 20 秒以上再停。
2. 看日志（`npm run logs:query` 或日志窗口）：
   - `video_edit.multicam.preview.start`：cameras=4、columns=2、rows=2；`first_frame` 的 durationMs 与 divisor（格子约 960 像素宽时应为 4）。
   - 停播后的 `video_edit.multicam.playback.stats`：目标 actualFps ≥ 30、droppedRatio 低；renderMs p95 看网格合成是否吃紧。若 actualFps 偏低而 renderMs 不高，多半是解码（4 路 4K60 原片），可看同时段 `video_decoder.stats` 与 `video_edit.decode.*`。
   - 同一次播放节目侧 `video_edit.playback.stats`：droppedFrames 与关闭多机位视图时同一段对比，目标不增加（节目不掉帧）。
3. 播放中按 1–4 切机位：节目画面与高亮立即一致，网格不闪、不停顿；日志里不应出现 sequenceId 以 `multicam-grid:` 开头的 `video_edit.render.document.updated`（网格会话不因切机位更新文档）。
4. 暂停、拖动播放头：格子跟手；松手后四格是精确帧。
5. 给其中两个机位建代理（不必打开节目的代理开关）：`preview.start` 或下一次 stats 的 proxies=2，divisor 不变（合成尺寸不因代理变大）；画面无错位、不糊。
6. 改变面板宽度：格子变宽超过 960 像素时 divisor 变为 2（看下一次 stats），画面不模糊。
7. 关闭多机位视图：网格会话的 Worker 退出、`video_decoder.stats` 中会话数回落。
8. 播放中最小化窗口再还原：日志出现 reason=hidden 的 `video_edit.multicam.playback.stats`，最小化期间网格会话没有解码活动；还原后网格接着出帧。
9. 把窗口拖到缩放比例不同的另一块屏幕：下一次 stats 的 divisor 随之变化。

# 审查返工（第 2 轮）
1. 合成与纹理分开取缩小倍数（必须改）：
   - `videoEditMulticamGridDivisor` 只按格子显示宽度取：格子（一个源画面，`composition.width / columns`）缩小后仍不小于显示宽度的最大倍数，代理不再参与；网格去掉 `decodedWidth`，改存各机位素材 ID `cameraMedia`。
   - 新增 `videoEditPictureDivisorForTarget(画面宽, 高, 目标宽, 高)`：画面按“适合”放进渲染目标后实际画出多大，盒式缩小就到这个大小为止（1/2/4/8 取最大）。4K 原片在 960×540 目标里缩 4 倍，1920 代理缩 2 倍，1280×720 不缩。
   - 授权的最小入口（只增量）：
     - `videoEditGpuCompositor.ts`：`setPictureSizing(按画面显示宽高取倍数的函数 | undefined)`。`snapshot` 的倍数取值改为 `显式传入 ?? pictureSizing(sample.displayWidth, sample.displayHeight) ?? 回放缩小倍数`（只改了这一行的取值来源），不设时行为不变。
     - `videoEditRenderer.ts`：选项 `fitPicturesToTarget?: boolean`。`ensureCompositor` 新建合成器后，若整棵渲染树（读 owner 的选项）开了这一项，就给合成器设 `setPictureSizing`，目标取该渲染器自己的画布尺寸（嵌套机位渲染器即格子大小）。节目等其他会话不设，行为不变。
     - `videoEditWorker.ts`：网格会话（带 `gridCells`）建渲染器时传 `fitPicturesToTarget: true`。
   - 结果：4 个 4K 机位、其中 1 个有 1920 宽代理、格子 960 时，合成仍是 1920×1080（倍数 4）；3 路原片纹理缩 4 倍、代理缩 2 倍，都是 960 宽。
2. 代理变化：代理生成好或失效时只发普通视图通知。现在监视器在视图通知里比对各机位的代理签名（`videoEditMulticamProxyKey`），变了就标记网格过期，下一步对同一份内容再交一次完整更新，重新选代理。通知回调先确认工程还在（`listVideoEditInstances`）。
3. 不可见时停止：`document.hidden`（窗口最小化、切到后台）或格子尺寸为 0（面板收起）时，结束当前播放（`stopPlayback` 撤下还没上屏的播放帧，统计 reason=hidden），不再请求画面；尺寸为 0 时连会话都不建。监听 `visibilitychange` 和 ResizeObserver，恢复后接着跟随节目时钟，或按播放头定位。
4. 屏幕缩放比例：`matchMedia('(resolution: Ndppx)')` 触发 change 时重新量格子、重选倍数，并按新比例重新挂查询。

验证（返工后实跑）：
- 渲染层 tsc（heavy.sh，12GB 堆）零错误；改动的 12 个文件 eslint `--max-warnings 0` 通过；`check:dependency-graph` 通过。
- 单测 6 个文件共 300 条全部通过：
  - `videoEditMulticamGrid`（4）
  - `VideoEditMulticamView`（8，新增 3）
  - `videoEditGpuCompositor`（46，新增 1）
  - `videoEditRenderer`（155，网格用例补纹理断言）
  - `videoEditWorker`（45，网格用例补选项断言）
  - `videoEditRenderSession`（42）
- 真实 WebGPU（RTX 4090，`--mode gpu`）：`videoEditPlaybackResolution.gpu` 5 条通过。各路纹理用的就是这组 1/2/4/8 盒式缩小着色器，着色器本身未改。
- 新增与改写的断言：
  - 有代理时合成倍数仍是 4。原用例断言“有代理 → 倍数 2”，已改成这条。纹理倍数：4K 取 4，1920 代理取 2，1280 取 1，竖画面按高度取 2。
  - 合成器设了按画面取倍数后，4K 与 1920 画面都复制成 960×540；撤掉后回到回放倍数（1920 → 480×270）。
  - 渲染器的两个嵌套机位合成器，都拿到按各自目标（480×270）取倍数的函数。
  - Worker 网格会话建渲染器时带 `fitPicturesToTarget`。
  - 视图通知里代理出现、消失各触发一次重新选代理（同一份内容交两次），合成倍数不变，会话不重建。
  - 窗口转到后台时撤下播放帧，之后节目再出帧网格也不出帧；回到前台继续顺序出帧。
  - 格子尺寸为 0 时不建会话；有了尺寸后建会话（倍数 4）；缩放比例从 1 变成 2 后倍数改为 2。
- 视图测试夹具的源序列改成 4K。原来是 1920×1080 序列放 4K 素材，而合成倍数现在按序列格子宽度取。
- 第 5 步补充：建代理后对比 stats 的 renderMs 与 `video_decoder.stats`，应不升反降。
