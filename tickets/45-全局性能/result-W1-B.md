摘要：原生解码显存预算改为专用显存 × 75%（不封顶，下限 1.5GiB），只作淘汰目标；原生服务打开会话永不因预算失败。
超出时依次：收回最久没用的拖动留存帧 → 渲染层后台淘汰闲置会话 → 能共享的读取退回素材共享会话、提前打开暂停；当前帧要读的会话一律打开。
删掉了服务 32 路会话、16 路硬解、每窗口 16 路帧流、每窗口 64 路声音、每渲染器 10 路与独占保留 3 路这些固定上限；留存帧上限改为预算的 1/4。

# 新的预算公式（`native/video-decoder/src/budget.rs`）
- 显存预算 = 专用显存 × 0.75，下限 1.5GiB（集成显卡报告的专用显存只有几百 MiB），无上限；读不到显卡时 8GiB（这时也打不开会话）。
  本机 RTX 4090（24138MiB）→ 18103MiB ≈ 17.7GiB（原来封顶 8GiB）。`HENJI_VIDEO_DECODER_VRAM_BUDGET_MB` 仍经 hello 覆盖，只在开发版生效。
- 单会话估算 `session_bytes` 口径不变（4K HEVC 10 位硬解约 941MiB 起）。
- 前台保留 = 3 × max(实测最大会话, 预算/8)：拖动留存帧不占这部分。
- 每个会话的拖动留存帧至多 预算/4（4090 约 4.4GiB，≈68 帧 4K rgbaf16 或 ≈370 帧 4K nv12），且只在“预算 − 已登记 − 前台保留”之内授予；原来的 2GiB / 300 帧两个常数删除（帧数由字节/每帧大小得出）。
- stats 字段：`vramLimitBytes`、`vramReservedBytes`（含留存帧）、新增 `vramRetainedBytes`、`vramPeakReservedBytes`、`largestSessionBytes`、`foregroundReserveBytes`、`hardwareSessions`（只计数）；删 `hardwareSessionLimit`、`decoderSessionLimit`。

# 超出预算时的顺序
1. 原生：任何会话登记后总和超过“预算 − 前台保留”，按最近使用顺序收回其他会话的留存帧（账本立即扣除，会话线程在下一次命令、计划轮询或 ≤50ms 空闲时放掉纹理并 Flush；之后的拖动读取隔 2s 按当时余量重新登记）。会话本身仍超出预算只记 `decode.budget.over_target`（越过时一次），照常打开。
2. 渲染层，按读取对当前画面的必要性分三档（`VideoEditNativeAdmission`）：
   - `required`（文件的共享播放/定位会话、顺序读取）：直接打开；打开后后台 `relieve()` 刷新账本，超出预算就淘汰闲置会话（远的、久未用的先），不挡当前帧。正在读的文件距离记为 0（`reading()`），避免刚打开的会话被自己的回收先淘汰。
   - `optional`（代码视频输入的独占会话、同一素材第二个播放计划、拖动第二个图层自己的会话）：`makeRoom(1)` 先淘汰闲置会话腾出一个会话的余量，仍不够就以 `budget` 失败，调用方沿用已有退路回到素材共享会话（独占读取者走 `EXCLUSIVE_RETRY_MS` 2 秒后再试）。
   - `speculative`（前瞻预打开、剪辑点另一播放会话、代码输入预热）：仍要求 2 个会话的余量，不够就跳过提前打开。
3. 只有拿不到显卡解码器才软解：不再限硬解路数，驱动拒绝时由 `get_format` 落到软解（已有路径）。
- 显存真满时驱动会把显存换出到内存，变慢不失败（排查表的风险说明）。

# 删掉的上限
- 原生：`admit_session` 32 路会话、`hardware()` 16 路硬解上限（只留计数）、`reserve_vram` 的 `BUDGET_EXCEEDED`、hello 里 `hardwareSessions`/`decoderSessions` 覆盖（旧字段被忽略）。
- 主进程：纹理桥每窗口 16 路帧流、声音会话每窗口 64 路（都抛 `BUDGET_EXCEEDED`）；`VideoDecoderErrorCode` 里删掉 `BUDGET_EXCEEDED`（旧服务若仍返回，按 INTERNAL → 服务故障可重试处理）。
- 渲染层：每渲染器 10 路 `VIDEO_EDIT_NATIVE_MAX_SESSIONS`、独占保留 3 路、`maxSessions` 选项、前台遇到预算拒绝后“取消前瞻、等关闭屏障、淘汰再重试”的循环；`headroom` 只看显存。
- `videoEditNativeFailure.ts`：`budget` 只表示“能共享的读取或提前打开没有显存余量”，由渲染层自己产生且调用方一律退回，不再从错误码映射；文案改为“显存紧张，素材「X」的画面稍后显示。”，不再出现“请减少同时显示的视频”。

# 取舍
- 没有做“非当前帧降输出分辨率”：原生服务没有缩放输出，加缩放要改转换着色器、纹理池尺寸与渲染层对齐，改动面大；本任务的降级用“退回共享会话 + 不提前打开”，画面精确只是变慢。代理切换不在本任务文件内。
- 渲染层判定 optional 而不是在原生协议里加准入参数：请求类型 `VideoFrameDecoderRequest` 在 `src/platform/contracts`，不归本任务；渲染层用服务账本判定，跨渲染器的竞争最多让一个可共享会话略超目标（目标本来就可超）。
- 选 75%：取用户给的 70–80% 中间；剪辑帧缓存、合成另有预算，都只是淘汰目标，叠加偶尔超出时按上面的风险变慢。

# 验证（全部本机实跑）
- `node scripts/video-decoder-ffmpeg.cjs test --locked`（经 heavy.sh；写 target/debug，不碰开发实例使用的 target/release 可执行文件）：86 通过、1 忽略（需要本机样片的复用测量）、0 失败；含真实 D3D11 设备的着色器/D3D11VA 用例。新增 `reclaimed_retention_is_released_and_reads_stay_exact`（收回后不交出作废留存帧、读取仍是精确画面），`budget.rs` 改写为“超出照常登记”“留存帧给前台留余量并让位新会话”两条。
- vitest：`videoEditNativeFrameSource.test.ts`、`texture-bridge.test.ts`、`audio-sessions.test.ts`、`client.test.ts`、`paths.test.ts` 共 99 通过。证明“压小预算先降级不报错”的用例：
  - 预算压到一个会话以下时当前帧照常打开、随后后台回收闲置会话（`余量足够保留超过四个…`）；
  - 预算只够一个半会话时第二个代码视频输入退回共享会话、画面不失败，推测读取不开也不借用（`显存没有余量给独占会话时…`）；
  - 第二个播放计划在显存不足时退回共享会话；会话数不设上限（12 路照常打开）。
- `tsc -p tsconfig.electron.json` 通过；`tsc -p tsconfig.json`（8GB 堆，4GB 默认堆会内存不足）第一次只有 W1-A 图片编辑文件的 2 个错误，等其改完重跑通过；改动的 10 个 TS 文件 eslint（`--max-warnings 0`）通过。
- 没有新增跨 `src` 的主进程 import，未跑 `check:main-imports`。

# 本机没法验证的
- 真实工程：8 轨 4K 10 位 HEVC + 4 机位播放/拖动不出预算提示、显存实际占用曲线（`video_decoder.stats`）、用 `HENJI_VIDEO_DECODER_VRAM_BUDGET_MB` 压小后的真实窗口表现——按约束不启动 Electron，交主会话真实窗口验收（需先 `build:video-decoder` 换掉 target/release 里的旧服务）。
- 留存纹理收回后 D3D11 是否立即归还显存（已在放掉后 Flush，未在真机测占用）。
- 驱动拒绝新硬件解码器时的软解退路只在代码层面确认（`get_format`），本机 4090 没有触发条件。

# 遗留（不在本任务文件内，需要配合）
- `src/platform/contracts/videoFrameTypes.ts:464` 的 `budget` 类型：删 `hardwareSessionLimit`、`decoderSessionLimit`（服务已不发），加 `vramRetainedBytes?: number`。
- `scripts/lib/uiInspectionSceneVideoEditNativeFaults.cjs` 的超预算阶段（同时显示 11 个视频，等“同时读取的视频素材过多”提示）会失败：应改成断言 11 个视频都出画面、没有提示，并可配合 `HENJI_VIDEO_DECODER_VRAM_BUDGET_MB` 压小预算验证先降级。
- `videoEditRenderer.ts:1589` 同时读取的视频画面超过 32 份就抛错（排查表问题 1 ④），归 W2-B/下一批。
- `videoEditFrameRouter.ts` 仍把 `budget` 当不重试；现在 `budget` 不会到达路由，可不改；若想彻底，可与 `service` 同样重试一次。
- `docs/task/原生视频解码与专业格式支持/任务/第三阶段-稳定性与交付/3.1-故障回退与资源治理.md` 第 71–74 行记的是旧上限与依据，主会话按需更新。
- 问题 10 的全局显存账本：剪辑帧缓存、图片/文字、代码驻留等渲染层预算若也按设备显存推导，应与本预算一起按比例分（本预算 75% 是解码服务一侧的淘汰目标）。

# 追加：收掉两处遗留（主会话授权）
- `src/platform/contracts/videoFrameTypes.ts` 的 `VideoFrameNativeStats.budget`：删 `hardwareSessionLimit`、`decoderSessionLimit`，加 `vramRetainedBytes?`，注释改为“只作淘汰目标、不限会话数与硬解路数”。全仓（src、electron、scripts）搜过，再没有读取这两个旧字段的地方：渲染层 `headroom` 已不读，测试替身已改，`uiInspectionSceneVideoEditNativeSoak.cjs` 只读仍存在的 `hardwareSessions`；没有诊断界面读它们。
- `scripts/lib/uiInspectionSceneVideoEditNativeFaults.cjs` 超预算阶段改写：
  - 预算经 `HENJI_VIDEO_DECODER_VRAM_BUDGET_MB=256` 压到约三路 1080p 会话。诊断变量只在握手时读，所以借“缺失”阶段恢复服务的那次启动带上，不为此再结束一次服务（一分钟内第四次异常退出会停止自动重启）；阶段因此移到缺失阶段之后，先关掉故障工程并等原生会话归零，账本回到预算内。
  - 11 个视频每层同一文件首尾相接三次，播放 10 秒跨过 8 秒处的剪辑点。断言：stats 里的 `vramLimitBytes` 等于 256MiB（压小生效）；首帧 11 层都是源时间 0；播放中每次呈现都是 11 层、逐帧精确，且多于 30 次；全程没有“节目画面无法显示”；日志里有 `video_decoder.native.decode.budget.over_target`（会话超出预算照常打开）和 `video_edit.decode.schedule.cut_shared`（显存没有余量，剪辑点不另开会话、改在同一播放会话上定位）。证据记账本快照和降级、淘汰、收回事件。
  - finally 里删掉预算变量；已运行的服务保留压小的预算直到下次启动，这一点写在场景注释里（该场景写用户数据，单独运行）。
- 验证：`node --check` 通过；`node --test scripts/lib/uiInspection.test.cjs` 里本场景的登记用例通过（`expectedLogEvents` 不变）；两套 tsc 重跑通过；`videoFrameTypes.ts` eslint 通过。场景本身要真实 Electron 才能跑，按约束未运行，交主会话（先 `build:video-decoder` 和 `electron:bundle`）。
