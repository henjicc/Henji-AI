摘要：W3-C 完成代码与精确测试：导出与预渲染的视频编码搬进剪辑渲染 Worker，合成设备拷出的 GPU 位图直接构造 VideoFrame 送进 VideoEncoder，不再跨线程传位图、不再经界面线程 2D 画布与 CanvasSource。
帧 N 交给编码器即回执，界面线程随即发帧 N+1，GPU 完成、编码与下一帧合成并行：最多 3 帧在途，编码器队列满 2 帧时 Worker 停下等待（背压）；下一秒的声音在画面合成期间先混好。
未启动应用：真实 4K60 导出的耗时对比、逐帧画质对比、预渲染文件可播放，需主会话按文末步骤验证。渲染器与合成器一行未改（复用已有的“GPU 位图快照”钩子）。

# 设计
- 改动前（核实）：每帧界面线程 `await render` → Worker 合成后等 GPU 完成 → 位图跨线程传回 → 界面线程 `drawImage` 到 2D 画布 → `CanvasSource` 再从画布取 VideoFrame → `await add`，三段串行；编码在界面线程。Worker 侧 `capture.gpu` 已经把画布纹理在 GPU 上拷进一块 WebGPU 画布并 `transferToImageBitmap()`（不回读）。
- 帧的来源：直接用这块 GPU 位图 `new VideoFrame(bitmap, { timestamp, duration })`。选它而不是 `new VideoFrame(合成画布)`：合成画布的纹理下一帧就复用，多帧在途必须每帧有自己的存储；位图是转移所有权、零拷贝，GPU 上只有一次 `copyTextureToTexture`（4K 约 33MB，显存带宽下可忽略）。像素同步由共享图像的同步令牌保证，不必等这一帧 GPU 完成就能交给编码器；GPU 完成与故障仍逐帧核对，出错这一帧按失败答复，导出停下并删除半成品。
- 编码放在 Worker、封装留在界面线程：Worker 只交回压缩数据（4K60 每帧约 100–200KB，ArrayBuffer 转移），界面线程用 mediabunny `EncodedVideoPacketSource` 封装，音频轨、文件写入、压制、字幕、响度会话都不动。没有把整个 mediabunny `Output` 搬进 Worker：那要把音频（含主进程响度会话）、文件写入一起搬过去，改动面大且收益不在这里。
- 与 mediabunny 自己编码的一致性（逐项复刻，测试钉住）：原生配置就是原 `onEncoderConfig` 最终交给 VideoEncoder 的那份（`videoEditExportVideoStream`，真实 mediabunny configure 逐字段 toStrictEqual）；时间秒→微秒截断相同；精确时间按微秒反查送出时的秒数（与 mediabunny 的 preciseTimings 相同）；关键帧节奏 `floor(t/间隔)` 变化即关键帧、未指定间隔 2 秒（mediabunny 默认）；AVC 级别修正在封装前调用；轨道标称码率取原生配置码率（同 `_nominalBitrate`）；编码器闲置被回收（QuotaExceededError reclaimed）时换新编码器并从关键帧接着编（mediabunny 同样处理）。
- 流水与背压：`runVideoEditEncodePipeline` 只在上一帧交给编码器（Worker 回 `submitted`）后发下一帧，Worker 里最多一帧排队，请求看门狗只算各自的合成；在途（已发未完成）上限 3 = 会话请求上限 4 − 1，留一个名额给与之并行的混音或该帧的字体/文字预检（二者按顺序发生，不会同时占用）。编码器 `encodeQueueSize ≥ 2` 时 Worker 在回执前等 `dequeue`，在途 VideoFrame 因此至多约 3 份；等写入文件的编码结果超过 8 份时先等封装写完（文件写入背压）。
- 取消与失败：流水任一帧失败或中止信号立即停止发帧并抛出（预渲染让出时不再等在途帧）；调用方先 `close()` 编码流（Worker 立即关编码器、丢弃排队帧、唤醒在等背压的一帧并关闭其位图），再撤掉输出与半成品。之后排在 Worker 队列里的编码帧发现编码流已关，不再合成。会话释放时 Worker 关闭全部编码流；Worker 崩溃时编码器与帧随 Worker 上下文一起释放。
- 成片画幅与合成不同（裁切、留边、缩放）：Worker 里用 2D 画布按同一导出几何、同一 `drawImage` 重采样画进黑底，再 `transferToImageBitmap` 构造帧——与改动前界面线程的缩放同一算法，只是不跨线程。日志标 `capture: 'scaled'` 与原因。
- 预渲染：每帧关键帧、同一编码档案与缓存键（键与档案未变，文件格式不变，现有读取方照常读）；自动预渲染保持占空比（一次只在途 1 帧、按实测帧时长歇），用户或助手发起的预渲染 3 帧流水。
- 没写兜底的情形：Worker 与界面线程的 WebCodecs 支持同源（Chromium 在 Worker 里经主线程取同一份 GPU 工厂），Worker 打开时再 `isConfigSupported` 一次，不支持就给出原因失败，不保留界面线程旧路径。VideoFrame(ImageBitmap) 总能构造；GPU 位图是否被编码器在 GPU 上转 NV12 由 Chromium 决定（与改动前 2D 画布帧走同一分支），JS 侧无法也无需判断。

# 零拷贝路径的适用条件
- 渲染会话不是节目直出（导出、预渲染都是），Worker 用 `capture.gpu` 取 GPU 位图；合成设备是硬件 WebGPU 适配器（软件适配器的位图在 CPU，构造帧照常可用，但不是零拷贝）。
- 成片画幅与合成画面相同（`videoEditExportRenderPlan(...).direct`；默认“按输出分辨率合成”时只要不裁切/留边就成立），日志 `capture: 'gpu-bitmap'`；否则 `capture: 'scaled'`，在 Worker 里多一次 2D 画布 GPU 绘制。
- 版本：仓库实际 Electron 44.9.3（AGENTS 写 42）。用到的 API 均已稳定：VideoFrame(ImageBitmap) 与 Worker 内 VideoEncoder（MDN：Dedicated Worker 可用）、`encodeQueueSize`/`dequeue` 事件（MDN 已查）。

# 改动文件
- 新增 `engine/videoEditFrameEncoder.ts`（Worker 侧编码：构造帧、背压、缩放、回收重建、关闭）与测试。
- 新增 `engine/videoEditEncodedVideo.ts`（界面线程侧：编码轨封装、精确时间、关键帧节奏、写入背压；通用流水 `runVideoEditEncodePipeline`）与测试。
- `engine/videoEditWorker.ts`：请求 `encoderOpen`/`encoderFlush`/`encoderClose`（关闭不进队列），`render.encode`；编码帧先回执 `submitted` 再在后台核对 GPU 完成；响应带 `encoded` 耗时；消息 `encoder.chunk`；释放时关闭全部编码流。
- `engine/videoEditRenderTransport.ts`：`openVideoEncoder()`（返回 encode/flush/close）、`encoder.chunk` 分发、`present` 末尾加 `encode` 参数、`VIDEO_EDIT_ENCODE_FRAMES_IN_FLIGHT`；位图版 `render()` 仍被录屏成片使用，保留。
- `engine/videoEditExportEncoderConfig.ts`（+ `videoEditExportEncoder.ts` 再导出）：`videoEditExportVideoStream()`。
- `application/videoEditExport.ts`：流水循环、声音提前一秒混好、`video_edit.export.performance` 新字段、失败先停编码流；多帧在途时日志里的失败帧取最先失败的那帧。
- `application/videoEditExportFrame.ts`：只设合成尺寸并返回导出几何（缩放移到 Worker）。
- `application/videoEditRenderCache.ts`：窗口编码改走 Worker 编码流。
- 渲染器 `videoEditRenderer.ts`、合成器 `videoEditGpuCompositor.ts`：未改，没有新增接口。界面 tsx：未改。

# 日志
- `video_edit.export.performance`（每 10 秒与最后一帧）：保留 audioMs/renderMs/copyMs/encodeMs/frames/preview*/composite*/webCache*；新增 `framesInFlight`（送出未收到编码结果的最多帧数）、`encodeQueueWaitMs`（Worker 等编码器队列空出的累计）、`maxEncodeQueue`、`capture`。口径变化：renderMs 是各帧合成到 GPU 完成之和（各帧重叠，可大于总耗时），copyMs 是 Worker 构造编码帧（含缩放），encodeMs 是提交编码。预期 copyMs 接近 0。
- `video_edit.export.encoder_config`（界面线程，配置与关键帧间隔，`worker: true`）、`video_edit.export.encoder.opened`（Worker，codec/尺寸/硬件偏好/capture/缩放原因）。

# 验证（均已实际执行）
- 级别 L2（跨线程协议、取消与失败、导出格式）。渲染层 tsc（heavy.sh，12GB）：全部通过、零错误。
- vitest 12 个文件全部通过：videoEditFrameEncoder（4，新）、videoEditEncodedVideo（3，新）、videoEditWorker（44，新增 1）、videoEditRenderSession（42，新增 1）、videoEditExportEncoderConfig（32）、videoEditExportEncoder（16）、videoEditExportFrame（3）、videoEditRenderCache（39）、videoEditExportQueue（60）、videoEditLoudness（14）、videoEditOutputs（25）。
- 改动的 19 个文件 eslint 通过；`check:dependency-graph` 通过。
- 测试证明的内容：编码器排满 2 帧时 Worker 等 dequeue 才回执；流水最多 3 帧在途、上一帧交给编码器才发下一帧、按帧序完成；取消时等背压的帧立即返回、之后的帧不进编码器、全部 VideoFrame 与位图关闭；编码器报错后下一帧与收尾都失败；闲置回收换新编码器并强制关键帧；缩放几何；时间按微秒截断、封装还原精确秒数、关键帧节奏、AVC 修正在封装前、写入失败在下一帧与收尾抛出；原生配置与真实 mediabunny configure 逐字段相同；导出帧数/时间戳、失败停在该帧且之前的帧全部编码（原有用例在新路径上通过）。
- 改掉的旧断言：导出测试里 CanvasSource 选项（mediabunny 层）改为断言原生编码配置（同一组取值）；导出缩放的 drawImage 参数改为断言交给 Worker 的几何；关键帧间隔从选项断言移到 `videoEditExportVideoStream` 与配置等价测试；预渲染“删除等在途编码写完才删”改为“取消立即停编码、丢临时文件后才删、无半成品登记”（在途帧不再拖住删除，保护的“不会有迟到窗口变为就绪”不变）。
- 原有问题（顺手补了测试替身）：`videoEditRenderSession.test.ts` 在 W2-B 提交后 40/41 条失败（平台替身缺 `system.memoryInfo`、`mediaCache.hardwareCapabilities`，`videoEditDeviceMemory()` 同步抛错），本任务给替身补了这两项，未改产品代码。

# 偏离
- 没有从合成画布本身零拷贝构造帧：多帧在途要求每帧独立存储，画布纹理下一帧即复用；GPU 位图是转移所有权，GPU 上一次拷贝。
- 不保留界面线程旧编码路径作回退（理由见设计末条）。
- 只有导出写了性能日志；预渲染沿用原有 `video_edit.render_cache.*` 事件。

# 遗留：需主会话验证（真实 Electron，先 `electron:bundle`，导出一次只跑一个）
1. 基线（改动前）：在本任务提交之前的构建上，打开 4K60 工程，导出同一段（建议 10–20 秒、含原片与代码素材、H.264 硬件）。记下最后一条 `video_edit.export.performance` 的 elapsedMs、frames、renderMs、copyMs、encodeMs，与 `video_edit.export.completed` 的 elapsedMs。
2. 改动后同一段、同一设置再导一次：期望 `capture: 'gpu-bitmap'`、copyMs 接近 0（每帧 <0.2ms）、framesInFlight 为 3–5、总耗时下降；encodeQueueWaitMs 占比大说明瓶颈在编码器，接近 0 说明在合成。`video_edit.export.encoder.opened` 的 hardwareAcceleration 应为 prefer-hardware。若吞吐反而下降且 CPU 明显升高，说明这台机器上 Chromium 没能在 GPU 上把 WebGPU 位图转成编码输入、改走回读，请把两份日志交回。
3. 结果核对：`ffprobe -v error -select_streams v -count_frames -show_entries stream=nb_read_frames,r_frame_rate,color_range,color_space,color_primaries,color_transfer -of compact 文件` 两份一致；`ffprobe -select_streams v -show_entries frame=pts_time,key_frame -of csv 文件` 时间戳与关键帧位置一致；`ffmpeg -i 旧.mp4 -i 新.mp4 -lavfi "[0:v][1:v]ssim;[0:v][1:v]psnr" -f null -` 人眼对比一致（硬件编码同输入常为逐位相同，至少 SSIM > 0.99）。再导一段画幅不同的（如 4K 序列导 1080×1920 留边），日志 `capture: 'scaled'`，画面与改动前一致。
4. 取消与失败：导出中途取消，任务显示已取消、半成品删除、无 `video_edit.export.failed`；再导出一次正常。
5. 预渲染：渲染条上对吃力段“渲染入点到出点”，`video_edit.render_cache.completed` 正常、节目播放该段取预览文件（不掉帧）；自动预渲染期间起播，`video_edit.render_cache.preempted` 后会话立即释放、节目不卡。

# 审查返工（第 2 轮）
1. 首包类型校正（必须改）：`videoEditEncodedVideo.ts` 移植 mediabunny 1.61.0 `determineVideoPacketType` 的 AVC/HEVC 判定（`videoEditVideoPacketType`，MPL-2.0 署名），首包标成 delta 且带解码配置时按码流 NAL 类型校正：AVC 1–4 为 delta、5（IDR）为 key；HEVC <16 为 delta、16–23（IRAP）为 key。只移植长度前缀布局（编码器按 avc/hevc 格式配置，输出必带配置记录）；H.264 恢复点 SEI 分支 mediabunny 在 Chromium 上本就跳过，未移植。测试：误标成 delta 的 HEVC 关键帧包（VPS+IDR_W_RADL）封装为 key，后续包原样；AVC SEI+IDR 判 key、非 IDR 判 delta。
2. 编码器卡住：Worker 编码器在手里有帧时 30 秒（`VIDEO_EDIT_ENCODER_STALL_MS`，短于 60 秒看门狗）既不取帧也不交结果，就判定卡住、关闭编码器并以 `VideoEditEncoderFailure('stalled')` 失败；送帧背压与收尾都受它约束，新送一帧时重新计时。看门狗因此只会碰到合成卡住。测试：假时钟下 29 秒不失败、31 秒失败并关闭编码器、帧全部释放；收尾卡住同样。
3. 编码失败的用户文案：Worker 抛 `VideoEditEncoderFailure(reason, 诊断细节)`，答复带 `encoderFailure: { reason, detail }`，界面线程还原后由 `VideoEditEncodedVideo` 换成 i18n 文案 `errors:videoEditEncoder.unsupported|stalled|failed`（改用软件编码或 H.264、降低分辨率、更新显卡驱动），codec 等细节只进日志 `video_edit.export.encoder_failed` / `video_edit.render_cache.encoder_failed`（同一条轨记一次）。新增文案在 `src/i18n/locales/{zh-CN,en-US}/errors.json`（所有权外，加 i18n 必需）。测试覆盖三种原因的文案、跨线程保留原因。
4. 注释里相对旧版本的说法已改（四处及顺带的两处“不再”）。
5. 日志按用途区分：`encoderOpen` 带 `purpose`；导出记 info `video_edit.export.encoder.opened` / `video_edit.export.encoder_config`，预渲染记 debug `video_edit.render_cache.encoder.opened` / `video_edit.render_cache.encoder_config`。
6. 请求上限改由在途数推导：`VIDEO_EDIT_ENCODE_FRAMES_IN_FLIGHT = 3`，`VIDEO_EDIT_RENDER_QUEUE_LIMIT = 在途 + 2 = 5`。注释写清：发第 K 帧前 K−1 帧 + 一个准备请求（降噪权重、字体、文字预检，依次发出）+ 一份混音预取 = K+1，发出后 K 帧 + 混音预取也是 K+1；余量 1 给跟随字体库的预渲染会话在字体库变化时追加的字体同步。注意：节目预览的兜底上限随之由 4 变 5（预览另有自己的在途限流）；会话测试“请求排满”改为从源头读上限。
7. 导出队列测试“CBR 软件关键帧”：替身逐次记录关键帧标记，内容加长到 150 帧（4K60），断言默认（未指定，2 秒）关键帧在第 0、120 帧，1 秒间隔在第 0、60、120 帧。
- 另：Worker 编码器的等待唤醒由单槽改为等待集合（收尾与送帧背压同时等待时不会互相覆盖）；取消导致的收尾 AbortError 不再记成编码器出错。

验证（第 2 轮，均已执行）：渲染层 tsc（12GB）零错误；vitest 全部通过——videoEditFrameEncoder（5）、videoEditEncodedVideo（5）、videoEditWorker（44）、videoEditRenderSession（42）、videoEditExportEncoderConfig（32）、videoEditExportEncoder（16）、videoEditExportFrame（3）、videoEditRenderCache（39）、videoEditExportQueue（60）、videoEditLoudness（14）、videoEditOutputs（25）；改动的 19 个文件 eslint 通过；`check:surface` 通过（350 条启发式告警均为原有 tsx，本任务未动 tsx）；`check:dependency-graph` 通过。
主会话验证补充：导出 HEVC（有 AMD 显卡机器时优先在那台上），日志无 “First packet must be a key packet”，成片首帧可解码。“不支持”文案只在渲染线程与提交前探测判断不一致时出现（平时设备不支持的设置在提交前就被拦下），难以人为复现，由单测覆盖。
