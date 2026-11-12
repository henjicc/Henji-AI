摘要：代理生成在 NVIDIA 机器上改为 CUDA 解码、显存内 scale_cuda 缩放后直送 NVENC（实测 4K60 10 位 HEVC 约 280 帧/秒，原 4 线程软解约 78 帧/秒），macOS 用 VideoToolbox；失败逐档回退软解、软编。
代理超并发不再报错：主进程排队（可取消、排队期间状态可查），每段占一个后台媒体重型槽；缩略帧同样硬解、进程占重型槽，磁盘缓存并入全局自动预算。
默认值不变（代理“启用”“自动创建”仍默认关）；完成事件带是否硬解、耗时、素材时长与分辨率。

## 改动文件
- `electron/main/services/video/proxy.ts`：硬解探测 `probeHardwareDecode`（每进程一次）、CUDA 适用判断 `cudaDecodeEligible`、硬解参数与滤镜、逐档回退、转码报告；`VideoProxyService` 排队（`VIDEO_PROXY_LANES`、`queueState()`、观察者 `queued/transcoded`），转码放进 `withMediaHeavyTask`。
- `electron/main/services/video/filmstrip.ts`：硬解取帧、每个取帧进程占一个重型槽（排队可随批次取消）、软解每进程最多 2 路单线程输入、硬解进程失败改软解重取；缓存 `budgetBytes` 改为不设单类上限；完成事件补字段。删掉了 `decodeThreads` 依赖项（线程数改由预算决定）。
- `electron/main/ipc/video-proxy.ts`：去掉“每窗口最多 2 段”的拒绝；接入硬解探测、分阶段回退日志、排队日志与完成报告。
- `src/features/videoEdit/application/videoEditProxy.ts`：创建时状态带 `queued: true`，收到第一条进度后清除。
- **界面数据来源（唯一一处越出清单的文件）**：`src/core/videoEdit/proxy.ts` 的 `VideoEditProxyState` 新增可选 `queued?: boolean`。只加数据，界面显示未改（排队中仍显示“生成中 0%”），助手读 `video_edit.media.proxy_state` 能看到 `queued`。没改 IPC 契约：主进程排队期间不发进度、开始转码时先发一次 0，渲染层据此区分。
- 测试：`proxy.test.ts`、`proxy.ffmpeg.test.ts`（已在 FFMPEG_CLI_TEST_FILES）、`filmstrip.test.ts`、`videoEditProxy.test.tsx`。

## 硬解适用与回退条件
代理（Windows）：
- 只在三者同时成立时用 CUDA：本机探测通过（实际初始化 CUDA 设备并跑通 scale_cuda）、编码器是 h264_nvenc（显存帧只能直送 NVENC）、原片格式在范围内。
- 格式范围：H.264 8 位 4:2:0；HEVC、AV1、VP9 8/10 位 4:2:0；非全范围（排除 yuvj 与 color_range=pc）；逐行或未标记。
- 其余一律软解：4:2:2、4:4:4、全范围、隔行、ProRes 等。
- 已实测与软解一致：10 位 HLG 的平均 Y/U/V 相差不到 1 级，色彩标记由 setparams 照写；旋转元数据两条路径都原样保留；时间戳逐帧对齐（核对放在每次尝试里）。
- 回退顺序：硬解失败或时间戳不对齐 → 同编码器软解（`video.proxy.hardware_fallback`，stage=decode，不清编码器缓存）→ 显卡编码失败 → libx264（stage=encode，清编码器缓存）。

代理（macOS）：
- 探测到 FFmpeg 带 VideoToolbox 就加 `-hwaccel videotoolbox`。帧自动下载到内存，后续滤镜与软解相同；FFmpeg 对不支持的格式会自动改软解。
- 本机无法实测。

缩略帧：
- 探测通过且原片满足上面的格式范围时，每路输入加 `-hwaccel cuda`（同进程共用一个设备；macOS 加 videotoolbox）。帧下载到内存后仍走原来的 area 缩放、自动旋转与 libwebp，与软解完全相同。
- 不在显存里缩放：scale_cuda 的固定核做几十倍缩小会混叠，而定位取帧只有最后一帧进滤镜。
- 硬解进程退出码非 0 且有缺帧时，缺的帧改用软解直接定位重取（`video.filmstrip.hardware_fallback`），再按原逻辑提前 10 秒重试。
- 不在格式范围内的素材直接软解：不能用“FFmpeg 自动改软解”兜底，否则一个进程的多路输入会超出线程预算。

## CPU 预算（24 线程机器上的最坏并行度）
- 沿用 W1-D 的预算：后台媒体线程 18（75%），重型槽 3 个，每个按 3 线程计；波形队列 4 路，每路 2 线程。
- 代理与缩略帧都进同一组重型槽，没有另开并行度，所以最坏情况仍是 **3×3 + 4×2 = 17 线程（约 71%）**，留出约 29%。
- 代理：
  - 同时最多 `VIDEO_PROXY_LANES = min(2, 重型槽数 − 1)` 段，24 线程机器上是 2 段，至少给导入缩略图和缩略帧留 1 个槽。
  - 线程：解码 2、滤镜 1、编码 1。软编 libx264 从 2 线程改为 1 线程。
  - 硬解时实际 CPU 占用远低于 3 线程，按 3 线程计是保守值。
  - 代价：软解兜底变慢（4K 2 线程约 45 帧/秒，原来 4 线程约 78 帧/秒）。
- 缩略帧：
  - 每个进程占 1 槽。软解每进程最多 2 路输入，每路 1 线程，加滤镜 1 线程；硬解时按像素上限可放更多路，解码在显卡上。
  - 原有“同时 2 个进程”的限制保留。
- 8 线程机器：重型槽 1 个，代理 1 段，与缩略帧、导入缩略图轮流用这 1 个槽，排队不报错。

## 验证（本机，RTX 4090，驱动 610.47）
- `proxy.test.ts` 6 项、`filmstrip.test.ts` 9 项、`videoEditProxy.test.tsx` 5 项全部通过。新增覆盖：
  - 第 3、4 段排队；取消排队中的第 4 段，它不转码；第 3 段在第 1 段完成后开始并最终完成，排队期间无进度。
  - 硬解参数只在给出硬解方式时出现；CUDA 适用范围的判断。
  - 缩略帧探测为空时不带 `-hwaccel`；硬解进程失败后用软解按每进程 2 路重取。
- `proxy.ffmpeg.test.ts` 9 项通过，真实 FFmpeg 实跑：
  - 10 位 HLG HEVC 走 CUDA 后 `hardwareDecode: true`，标记 bt2020 / arib-std-b67 / tv、yuv420p，时间戳对齐。
  - 1024×128 HEVC（低于 NVDEC 高度下限 144）硬解失败，回退 stage=decode，输出对齐。
- `HENJI_FILMSTRIP_NATIVE=1` 的 `filmstrip.native.test.ts` 通过：样本 320×180 H.264 4:2:0 在本机走 CUDA，逐帧亮度核对取帧位置（含起点 11.4 s 的 MPEG-TS）。
- 主进程 tsc、渲染层 tsc、改动文件 eslint 通过。

## 需要主会话用真实 4K60 HEVC 素材验证
1. 先对比代理生成耗时。拿 10 分钟 4K60 HEVC（最好 10 位，有手机竖拍的再加一段旋转素材），开发版里“为选中素材生成代理”，查日志：
   - `video.proxy.completed` 的 `elapsedMs`、`hardwareDecode`（应为 true）、`durationSeconds`、`sourceWidth/sourceHeight`。
   - 不应出现 `video.proxy.hardware_fallback`。
   - 对比基线可在设备管理器里临时禁用 N 卡；或用同素材按命令行 `-threads 4` 软解跑一次（约 78 帧/秒，即 10 分钟素材约 7.7 分钟）。
2. 再测并发：一次选 4 段以上素材生成代理，或在不同素材上快速连点。都不应报错，日志里有 `video.proxy.queued`。中途取消排队中的一段，它不应开始转码。
3. 竖拍素材生成的代理在节目监视器里方向正确，HLG 素材与原片切换时颜色不跳。
4. 打开“启用代理”后，跑 ticket 34 的冷倒拖和跨段拖动场景，看是否达到门槛。
5. 时间线缩放到能看到很多缩略帧：`video.filmstrip.batch.completed`（debug 级）的 `hardwareDecode` 应为 true，`durationMs` 应明显短于改动前。不应出现 `video.filmstrip.hardware_fallback`。
6. 资源监视器里看：生成代理与刷缩略帧同时进行时，总 CPU 不超过约 75%。

## 偏离
- 越出清单改了 `src/core/videoEdit/proxy.ts`（只加一个可选字段，见上）。
- 去掉了 `FilmstripServiceDependencies.decodeThreads`：线程数改由 CPU 预算决定，不再由调用方传入。没有外部调用方。

## 遗留
- 渲染层 `createVideoEditProxies` / `autoCreateVideoEditProxies` 仍逐段串行提交。主进程已经排队，串行无害，没改。
- 代理只按 3 线程占槽，硬解时这个估计偏保守，会让同时进行的导入缩略图多排一会儿。真实使用中如果嫌慢，可以把硬解代理改为不占重型槽：硬解时每段实际约 1 个线程。

## 返工（审查意见 1–7）
1. 代理不再独占公共重型槽。
   - 硬解代理：不占公共槽，只受代理自己的并发上限 `VIDEO_PROXY_LANES = 2`（显卡编码会话有限）。解码与滤镜各 1 线程，实际约 1 个线程。
   - 软解那一次尝试才按 CPU 预算走 `createVideoProxySoftwareRunner`：
     - 公共槽 ≥2 个时，占一个槽，用标准线程（解码 2、滤镜 1、编码 1）。
     - 公共槽只有 1 个（逻辑核 ≤15）时，不占这个槽：解码降到 1 线程，同一时间只跑一段软解代理，缩略帧和导入缩略图照常用这个槽。
   - 代理的 FFmpeg 进程都设为低于正常优先级。
   - 补了测试：槽数为 1 时，代理进行中缩略帧任务仍能拿到槽执行；槽数多于 1 时，软解代理占槽，等槽期间报告排队。
2. 排队状态显示“排队中”。项目面板“代理”列的状态文案全部改走 i18n（新增 `ui.videoEditProject.proxyState.*`，中英各一份），布局与样式未动。
   - 这一列原来是写死的中文，整面板也没有接 i18n，这次只把这一列接上。
   - 判断方式：主进程每次真正开跑 FFmpeg 才发第一条进度（0）；在此之前，渲染层都显示“排队中”。
3. 失败原因分开处理。
   - 时间戳不一致改抛 `VideoProxyAlignmentError`：硬解时退回软解重做一次，软解仍不一致就直接报错，不再试 libx264。
   - 编码器探测结果只在“显卡编码失败、处理器编码成功”时才作废（由 IPC 层按最终 `report.encoder` 判断）；原片本身坏时不再作废编码器探测结果。
4. 等 CPU 预算也算排队：软解尝试等公共槽或 reduced 位置时，记 `video.proxy.queued`（stage=cpu），渲染层同样显示“排队中”。等代理并发位置时记 stage=lane。
5. 硬解探测超时（或找不到 FFmpeg）不缓存，本次按不可用处理，下次请求重新探测；探测明确失败才缓存。
6. VideoToolbox 套用同一格式判断（函数改名 `hardwareDecodeEligible`）：4:2:2、4:4:4、全范围、隔行一律软解。**Mac 真机未验证。**
7. 缩略帧不论硬解软解，每进程最多 2 路输入，每路解码 1 线程，加滤镜 1 线程。某路 NVDEC 初始化失败时 FFmpeg 会自动改软解，那时也不会超出一个槽的线程数。代价：1080p 素材一批 8 帧要分 4 个进程，每个进程都要初始化一次 CUDA（约 0.2–0.3 秒）。

### 更新后的最坏并行度
- 24 线程：后台媒体预算 18，重型槽 3 个（每个 3 线程），波形 4 路（每路 2 线程）。代理软解占重型槽；硬解代理最多 2 段，各约 1 线程，不占槽。最坏约 3×3 + 4×2 + 2×1 = 19 线程（约 79%）。
- 12 线程：重型槽 1 个（3 线程），波形 2 路（4 线程），reduced 软解代理约 3 线程，硬解代理另外最多 2 段（各约 1 线程）。最坏约 10–12 线程（83–100%）。
- 8 线程：重型槽 1 个（3 线程），波形 1 路（2 线程），reduced 软解代理约 3 线程，另外最多 1 段硬解代理（约 1 线程）。最坏约 8–9 线程，**会超过 90%**。
- 1 个槽的机器上，要同时满足“缩略帧保底”与“留 10% CPU”，只能在两者之间取舍。这次选了缩略帧保底，代理进程以低优先级运行来缓解。若要严格守住 10%，可在 1 个槽的机器上把软解代理也排进公共槽，但缩略帧会重新等它。这一取舍请主会话决定。

### 返工验证
- 通过：`proxy.test.ts`、`filmstrip.test.ts`、`videoEditProxy.test.tsx`、`VideoEditProjectPanel.test.tsx`。
- 真实 FFmpeg 实跑通过：`proxy.ffmpeg.test.ts` 9 项（含 CUDA 硬解与回退）；`HENJI_FILMSTRIP_NATIVE=1 filmstrip.native.test.ts`（CUDA 路径，逐帧核对）。
- 改动文件 eslint 0 问题；`check:surface` 通过，没有新增错误。这次没改模型文案，`check:model-i18n` 不涉及。
- 两套 tsc 见下一行。
- 两套 tsc（主进程、渲染层）均通过。
