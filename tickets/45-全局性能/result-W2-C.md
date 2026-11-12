摘要：W2-C 完成代码与精确测试：字体目录改为“先比文件清单签名、没变不扫”，缓存不变不重写，监听事件合并成一次核对；首帧前不启动自动预渲染、帧指纹与时间线波形；首帧事件带分段耗时；节目会话离开工作区后保留复用。
未启动应用：真实首帧耗时、每次进入剪辑的 fonts.scan.start 次数、pool.ready 是否消失，需主会话按文末步骤验证。
字体连扫的直接触发源未能在不启动应用的前提下定论（见“问题 1”），修法同时堵住了两个候选，并加了 fonts.watch.changed 诊断日志。

# 启动编排文件（改动前登记）
- `src/features/videoEdit/VideoEditPreview.tsx`：节目面板卸载时由“释放会话”改为“交给池保留”，接管时传入所在窗口；首帧回执带上 renderStages。
- `src/features/videoEdit/timeline/VideoEditClipWaveform.tsx`：首帧前不开始批量读波形。
- `src/features/videoEdit/engine/videoEditRenderTransport.ts`：一行，把 Worker 阶段计时转给首帧窗口（`noteVideoEditWorkerTiming`）。
- 注：排查表写的 `videoEditRenderCache.ts`、`videoEditRenderFingerprints.ts` 实际在 `src/features/videoEdit/application/`，不在 engine。

# 问题 1：字体重复扫描
- 日志核对：11-11 06:49:47.40 自动预渲染启动，34 ms 后第一次 fonts.scan.start，此后 25 次首尾相接（每次完成后约 15 ms 下一次开始）。预渲染会话不带 fixedTextFonts，不走 captureSnapshot；连扫只可能来自 list() 时 dirty=true，而置脏的只有目录监听回调、扫描线程失败与 captureSnapshot。旧代码每次扫描都原子重写 catalog-cache.json（临时文件名与缓存名本身有过滤，但空文件名等系统合并事件没有），监听置脏 → 200 ms 后广播 → 渲染层 loadFontLibrary(true) → 全量扫描 → 再重写缓存，形成自激环。没有启动应用不能确认具体是哪一种事件，所以两条路都改成不依赖过滤：
  - `scanner.ts`：新增 `inventory()`（只遍历与 stat，算路径+大小+修改时间签名）；`scan()` 复用它；缓存 JSON 与上次读到/写入的文本一致时不重写。
  - `service.ts`：dirty 时先让 Worker 算清单签名，与当前目录一致就直接返回缓存，不扫描、不广播；只有签名变了才 `fonts.scan.start` 全量扫描，扫描结果真的变了才广播 `fonts:changed`。监听回调不再直接广播，500 ms 合并后由服务自己核对；空文件名同样只触发核对。`captureSnapshot` 不再强制全量扫描，改为强制核对签名（导出读取时仍逐个校验文件身份）。导入失败时清掉签名强制完整重扫（部分文件可能已写入）。新增 debug 事件 `fonts.watch.changed`（合并后的前 8 个事件样本），下次能看到到底是哪个目录的什么事件。
  - `src/platform/fonts.ts`：主进程目录修订号没变时不重建渲染层字体列表、不打扰订阅者。
  - 导入新字体：仍走 import → 完整 scan → apply → 广播，立即可用（`service.test.ts` 原有导入/删除用例覆盖）。

# 问题 2：首帧前不启动后台任务
- 首帧窗口（`videoEditFirstFrameTiming.ts`）新增 `videoEditFirstFramePending` / `whenVideoEditFirstFrame` / `subscribeVideoEditFirstFrame`。首帧上屏、窗口超时（30 s）或关闭时放行；打开后马上切序列，等待者转给新序列的窗口。
- 自动预渲染：调度循环在该工程首帧未上屏时跳过（手动预渲染不受影响）。
- 帧指纹：后台计算先等首帧再开渲染会话。
- 时间线波形：任一工程首帧未上屏时新挂载的片段先不取波形；已经取过的片段不收起（切序列不闪烁）。

# 问题 3：首帧分段计时
- `video_edit.program.first_frame` 新增 `phases`（contentCheck、fonts、code、workerDocument、decoderSession、firstDecode、gpu，单位 ms，各段可能并行）与原始 `stages`（首帧前各阶段累计）。来源：主线程 render.prepare.* / render.update.*，Worker 的 render.native.openDecoder、render.compositor.device/pipelines（经 transport 日志转发），首帧回执的 decodeMs、gpuMs 和 renderStages（含 code*/author* 编译准备）。没有新建通道。

# 问题 9：节目会话保留
- `videoEditProgramPool.ts` 新增 `parkVideoEditProgram`：节目面板正常卸载（离开剪辑工作区、面板隐藏、同窗口重挂载）时停播放、清预渲染窗口、换成空文档（由现有 updateDocument 路径释放全部素材读取与解码会话），把回放分辨率/显示方式/网页档位恢复默认；Worker、GPU 设备与管线保留。同一工程再进入时 `takeVideoEditProgram` 直接返回原会话，记 `video_edit.program.pool.reused`，不再出现 pool.start/ready。
- 回收时机：工程关闭（每 5 s 随内存检查，或下次保留/接管时）、系统可用内存不足、会话已出错（GPU 丢失或 Worker 中断走原来的释放重建）、换到另一个窗口（弹出窗口的画布宿主不同，先等旧会话释放再新建）、原生解码服务状态变了。
- 偏离排查表：保留期间按系统内存而非显存回收（与原池一致）；保留会话不设时长上限。

# 待确认第 4 条：波形 range 请求
- 已核实，不改（归音频任务）：`electron/main/services/audio/ops.ts` 的 `extractRange` 每次都 probe + 起 ffmpeg 解码该区间，不读多级波形缓存，只有同参数在途去重，没有结果缓存。它服务的是渲染层 `waveformDataService.ts` 的“精细波形”（`acquireWaveformDetail`，`samples: true` 要原始样本，多级缓存只存峰值，设计上就无法从金字塔取），所以打开时恢复的放大视图会串行发出若干次 160–670 ms 的解码。可选改进（留给音频任务）：精细窗口加磁盘/内存结果缓存，或复用一次解码的 PCM。本任务已让首帧前不发起这些请求。

# 验证
- 测试（均通过）：`electron/main/services/fonts/service.test.ts`（新：监听风暴 25×2 个事件只核对一次签名、清单不变不扫不广播、真有变化才扫描并广播一次；再次导出只核对不重扫）、`scanner.test.ts`（新：缓存内容不变不重写；原有 rename 重试改为在内容变化时验证）、`electron/main/ipc/fonts.test.ts`、`src/platform/fonts.test.ts`、`videoEditFirstFrameTiming.test.ts`（新：等待者在首帧后放行、切序列转交、phases 汇总）、`videoEditProgramPool.test.ts`（新：保留后同工程接管同一会话不新建；换窗口回收；工程关闭回收）、`videoEditRenderCache.test.ts`（新：首帧前自动预渲染不开始，首帧后开始）、`videoEditRenderFingerprints.test.ts`、`videoEditRenderSession.test.ts`、`fontReflection.test.ts`、`VideoEditPreview.test.tsx`。
- `VideoEditPreview.test.tsx` 改了 4 处旧断言：它们钉的是“卸载/隐藏就释放会话、重挂载等释放后新建”，这正是问题 9 要改的行为；改为断言保留与复用，迟到画面不发布的保护不变。afterEach 关闭工程后清掉保留会话，避免跨用例串扰。
- 主进程 tsc 通过；渲染层 tsc 仅剩 `videoEditRenderer.test.ts(10,29)` 缺 `videoEditCodeInputsKept`，不属于本任务文件（W2-B 正在改）。改动文件 eslint 通过（顺手删了 service.ts 原有未用的 `app` 导入）。`check:dependency-graph` 通过。

# 遗留：需主会话验证（真实 Electron，开发版即可）
1. 冷打开同一工程（11-11 那个代码素材多的工程）：`npm run logs:query` 或日志窗口看 `video_edit.program.first_frame` 的 elapsedMs 与 `phases`/`stages`，记下最大的一段；同时确认 `video_edit.render_cache.start`（预渲染与 phase=fingerprint）都晚于 first_frame。
2. 打开工程期间及之后 10 s 内 `fonts.scan.start` 次数（期望 ≤1，首次启动后通常为 0）；若有 `fonts.watch.changed`（debug），看 samples 里是哪个目录的事件，可据此给问题 1 的触发源定论。
3. 导入一个新字体（字体选择器“导入”或拖入），确认立即出现在列表、剪辑文字能用；在系统字体目录手动拷入一个字体，约 0.5 s 后出现 `fonts.scan.start` 一次。
4. 剪辑 → 画布 → 剪辑来回切 3 次：期望出现 `video_edit.program.pool.parked` / `video_edit.program.pool.reused`，不再出现 `video_edit.program.pool.start/ready`；回来后画面正常、播放正常、回放分辨率设置保持。再把节目面板弹出到独立窗口又收回，确认画面正常（这条走“换窗口回收再新建”）。
5. 关闭工程后 5 s 内应有 `video_edit.program.pool.released`（reason=project-closed）。
