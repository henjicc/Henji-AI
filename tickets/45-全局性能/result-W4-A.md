摘要：问题 2、3 已修好并实测通过：停放工程后 0.2 秒内解码会话归零（原 24 路、8.4GB 占着 18–34 秒）；HEVC 成片的码流与容器都是 tv/bt709。
问题 1 只修掉了两处根因：解码计划反复重建的死循环，以及跟不上时仍逐帧解非参考帧。8 轨 4K 播放的合成帧率从约 2.8 fps 升到 7.4 fps，丢帧 91.5% → 86.7%，没有达到 30% 的目标。
剩余瓶颈是渲染层成批取帧与交还帧的往返：解码线程约 30% 的时间在等纹理槽位，交还延迟 p95 约 1 秒。另外 NVDEC 总吞吐只够约 3.5 路 4K60 全解。下一步方案见文末。

# 问题 1：多轨 4K 播放几乎不出帧

## 根因（证据）
1. 硬件上限：本机 NVDEC 解这批素材（Sony 4K59.94 H.264 High、150Mbps、GOP 30 帧 IBBP、B 帧 nal_ref_idc=0）的总吞吐是固定的，多开会话也不会增加。
   - 测法：随包 ffmpeg 9.0，`-hwaccel d3d11va`，只解不出。
   - 单路逐帧解约 3.5 倍实时（720 帧 3.38s）。两路并行合计约 175 fps，不比单路多。
   - 只解参考帧（`-skip_frame noref`）单路约 8.4 倍实时，三路并行合计约 9 倍实时。
   - 结论：8 轨 4K60 逐帧解需要约 2.3 倍的解码能力。不管怎么调度，逐帧精确都不可能跟上；只解参考帧时才刚好够 8 路。
2. 计划反复重建（死循环）：解码按 22 fps/路追 60 fps 的时钟，落后超过 1 秒后，`continuesPlayback` 判为跳转。
   - 结果是 `disposePlayback` 加重建计划，8 路解码器同时 flush、回到关键帧重解。重建要 0.5–2 秒，期间时钟又走过 1 秒以上，于是下一帧再重建。
   - 证据：验收日志 13:07:47–13:08:02 这 14.5 秒里，每路依次跑了 s2–s8 共 7 个计划，全部 `cancelled`，后几个各只交出 2–10 帧。vf-321 的 `seeks 8`、`flushes 8`。decode p95 约 1.8–2.1 秒，正好是一次重建的耗时。
3. 跟不上时仍逐帧解：时间点计划里每一帧（含被时钟跳过的 B 帧）都要完整解码、写共享纹理、经主进程转给 Worker，再由渲染层取出丢掉。

## 改动
- 原生 `decode/mod.rs` 的 `schedule_times`：
  - 每项推进时跳过本项之前用不到的非参考帧，与 `frame_at` 相同：`skip_limit`，目标前 0.1 秒或 3 帧以内照常全解。起播首帧和重建后定位都因此变快。
  - 开头填满纹理池之后，按 `DropState`（`plan.rs`）判断是否跟不上：消费方交出未还的帧少于 2 时只解参考帧，交出未还的帧回到“池大小 − 1”时恢复逐帧解（迟滞）。
  - 画面与上一项相同的项答 `frame_missing { reason: 'held' }`，不占槽位、不复制。计数 `held` 写进帧流统计。
  - 协议升到 7（`protocol.rs`、`protocol.ts`）。
- 渲染层：
  - `VIDEO_EDIT_PICTURE_HELD` 经 `videoEditNativeFrameSource`、路由与代理帧源传给渲染器。
  - 渲染器收到沿用标记就保留这一层当前画面，不再走另读精确帧的退路。
  - 沿用的画面或交出的参考帧不是这一时刻的那一幅时，整帧标为近似。停下后节目按原有逻辑精确重画。
  - `takeScheduled` 记 `scheduleWait`，计划画面复制记 `pictureCopy`（诊断分段）。
- 统计：
  - `video_edit.playback.stats` 增加 `approximateFrames`（呈现了、但有图层沿用早于这一时刻画面的帧）。
  - 渲染条实测把近似帧记为没按时出画（`videoEditRenderCache.ts`），自动预渲染不会把这种段落当成流畅。
- 没改 `continuesPlayback` 的 1 秒规则。只解参考帧后，重建与续解都变快，实测 8 轨 10 秒内每路只有 1 个计划，不再重建。

## 数字（同一测试工程、同一测量脚本；实测按要求收紧为 8 轨、播放 ≤13 秒）
| 场景 | 改动前 | 改动后 |
|---|---|---|
| 8 轨播放：呈现 / 应出帧 | 30 / 353（丢 91.5%；验收记录 94.7%） | 77 / 577（丢 86.7%） |
| 8 轨：最长连续丢帧 | 82（验收 125） | 18 |
| 8 轨：decode 分段 p50 / p95 | 32 / 1879 ms | 113 / 298 ms |
| 8 轨：合成帧率 | 约 2.8 fps | 约 7.4 fps；其中 32 帧有图层沿用参考帧 |
| 8 轨：每路计划数（一次播放） | 7 个，全部被取消重建 | 1 个 |
| 8 轨：每路交出 / 沿用 | 交出全部 | 交出约 262，沿用约 340（约 56%） |
| 单轨播放 | 785 / 785，render p50 4.47 / p95 6.27 ms | 593 / 593，render p50 4.56 / p95 7.06 ms |
| 单轨拖动（同一拖动轨迹） | 248 次呈现，松手后精确帧 41 ms | 251 次呈现，松手后精确帧 53 ms |
| 5 秒导出（1 轨，硬件） | — | H.264 300 帧 5.35s；HEVC 300 帧 5.83s，均为编码器受限（encodeQueueWait 约 2.8s） |

- 单轨拖动这一轮整段拖动用了 18.3 秒，基线是 14.9 秒，所以按秒算的呈现率从 16.6 降到 13.7 次/秒。
  - 按同一指针轨迹算，呈现次数相同。
  - 拖动路径（`frame_at` 与区间计划）这次没有改动；变慢的是 CDP 指针事件的派发，应用刚重启，属于测量环境差异。
- 导出路径解码用区间计划与单帧取帧，这次没有改动。由于不再做 4K60 整段导出，没有与验收的 51.7 秒做同口径对比。

## 剩余瓶颈（数字）
- 合成每帧仍要等计划画面：decode 分段 p50 113 ms。`scheduleWait` 8 层合计 p50 264 ms、p95 977 ms。
- 原生侧并不慢：每路在约 10 秒播放里有 2.8–3.5 秒在等纹理槽位（池满）。
  - 帧桥统计里播放流的 `releaseMs` p95 为 0.8–1.1 秒，定位流约 0.12 秒。
  - 原因：渲染层只在合成某一帧时才成批取计划里的项，被时钟跳过的项也要到那时才交还。交还还要经渲染进程主线程关闭 VideoFrame。
  - 结果：解码一段时间池满停住、一段时间又落后，平均跟不上时钟。
- 建议的下一步（需要改出所有权外的契约、preload 与主进程 IPC，本次没做）：
  - 渲染层每请求一帧，就把“当前呈现到第几项”发给原生会话（新端口调用）。
  - 原生据此把之前的项直接答沿用，不写纹理、不经 IPC。
  - 目标所在 GOP 超出已送入的包时，直接定位到前方关键帧（GOP 级跳帧）。
  - 这样跟不上时不会白占槽位，12 轨这类连参考帧都解不完的情况也能平稳降帧。
  - 替代做法是在 Worker 里按时钟持续交还已过时的项，只改渲染层，但跳过的参考帧照样要复制与转发。

# 问题 2：停放的工程不释放解码会话
- 根因：
  - 保留节目会话时 `replaceContent(空内容)` 确实释放了全部读取者。
  - 但 `VideoEditNativeFrames.release()` 对“前瞻距离有限且有会话”的文件会留着闲置会话，等前瞻下一次 `maintain` 回收。
  - 停放后节目不再出帧，前瞻永远不会再跑，所以 24 路会话一直留到页面重载。
  - 跳转预览的读取器和悬停取帧渲染器也各自留着按旧内容打开的读取。
- 改动：
  - Worker 处理 `replaceContent` 后调用 `nativeBackend.disposeIdle()`，并改为并行关闭。
  - 渲染器 `replaceContent` 交还跳转预览读取器（`releaseReaders`，常驻画面留着），并关闭悬停取帧渲染器。
- 实测：14:30:38.114 `pool.parked`，到 38.321 共 8 路会话全部关闭，之后 20 秒每秒采样都是 hardwareSessions 0、streams 0、vramReserved 0MiB。收尾时再采样一次，同样为 0。
- 测试：`videoEditWorker.test.ts` 新增一条：换成空内容后关闭闲置解码会话。

# 问题 3：HEVC 成片没有色彩标记
- 根因：
  - Windows 上经 Media Foundation 的硬件编码器写出的 SPS 带 VUI，但没有 video_signal_type 与色彩描述（H.264 的 SPS 同样没有）。
  - mediabunny 按编码器报告的 decoderConfig.colorSpace 在容器里写了 `colr nclx 1/1/1 limited`，两种成片都有。
  - FFmpeg 的 HEVC 解码器在 SPS 没有色彩描述时，把色彩重置为未指定；H.264 解码器保留容器的值。所以按码流解码的工具读出 unknown。
    - FFmpeg 8.0.1 的 ffprobe 流级别显示 unknown（验收用的就是这个版本）。
    - FFmpeg 9.0 帧级别显示 unknown。
- 改动前的导出是否就缺：是。
  - W3-C 之前由 mediabunny 自己编码，用的是同一份原生配置、同一个编码器。两条路径都不改 SPS，只由 mediabunny 写 colr。
  - 这是按代码推断的结论，没有找旧版成片核对。
- 改动：
  - 新增 `videoEditExportHevcColour.ts`：按 H.265 7.3.2.2 走到 VUI，只改写 video_signal_type 一段，写入编码器报告的色彩。没有 VUI 时补一段最小 VUI。其余各位原样保留，并重新加防竞争字节。
  - 作为 HEVC 的 `onEncodedPacket`，改写配置记录（hvcC）里的 SPS。导出、预渲染、录屏成片共用这个入口。
  - 全片核对过，编码器只在配置记录里放参数集，码流内不重复。
- 核对：
  - 用 FFmpeg trace_headers 与解码首帧检查改写后的 SPS：有 VUI 与无 VUI 两种都正确，后续字段（时序信息、sps_extension）不变。
  - 真实导出 `多轨4K - 自定义导出 (4).mp4`（HEVC，5 秒，300 帧）：
    - 流级别 tv/bt709/bt709/bt709，FFmpeg 9.0 与 8.0.1 一致。
    - 帧级别 I、P 帧均为 tv/bt709。
  - 同时导出的 H.264 `(5).mp4` 不变，仍为 tv/bt709。
- 测试：`videoEditExportHevcColour.test.ts`（3 条），用真实编码器 hvcC 与经 FFmpeg 核对过的写入结果。

# 改动文件
- 原生：
  - `native/video-decoder/src/decode/mod.rs`
  - `decode/plan.rs`
  - `streams.rs`
  - `protocol.rs`
- 主进程：`electron/main/services/video-decoder/protocol.ts`
- 渲染层 engine：
  - `videoEditFrameSource.ts`
  - `videoEditFrameRouter.ts`
  - `videoEditNativeFrameSource.ts`
  - `videoEditRenderer.ts`
  - `videoEditWorker.ts`
  - `videoEditJumpPreview.ts`
  - `videoEditExportEncoderConfig.ts`
  - `videoEditExportHevcColour.ts`（新）
- 渲染层 application：
  - `videoEditPlaybackStats.ts`
  - `videoEditRenderCache.ts`（一处：近似帧计为没按时出画）
- 所有权外，一处：`src/platform/contracts/videoFrameTypes.ts`，在 `frame_missing` 的 reason 里加 `'held'`（含一行注释）。不加的话渲染层无法按类型区分沿用与缺画面。
- 测试：
  - `videoEditNativeFrameSource.test.ts`
  - `videoEditRenderer.test.ts`
  - `videoEditWorker.test.ts`
  - `videoEditFrameRouter.test.ts`（类型）
  - `videoEditExportHevcColour.test.ts`（新）
  - 原生两条：`a_schedule_its_consumer_waits_on_decodes_reference_pictures_only`、`drops_from_an_empty_cushion_until_the_pool_is_nearly_full`

# 验证
- 原生：`video-decoder-ffmpeg.cjs test --locked --target-dir <scratch>/vd-target`（CARGO_BUILD_JOBS=8）：90 通过、1 忽略、0 失败，无编译警告。
- 原生构建：`build:video-decoder`（CARGO_BUILD_JOBS=8），开发版已用新服务重启（协议 7 握手正常）。
- vitest 共 13 个文件全部通过：
  - videoEditExportHevcColour、videoEditNativeFrameSource、videoEditWorker
  - videoEditPlaybackStats、videoEditFrameRouter、videoEditExportEncoderConfig
  - videoEditRenderer、videoEditRenderCache、videoEditJumpPreview、videoEditProgramPool
  - client、texture-bridge
- tsc：
  - `tsconfig.electron.json` 通过。
  - `tsconfig.json`（12GB 堆）：最终代码上零错误。
- eslint：改动的 17 个 TS 文件加主进程 protocol.ts 通过。

# 遗留
- 问题 1 未达标：8 轨丢帧 86.7%，目标是 30%。剩余瓶颈与建议方案见上。
- 12 轨按要求未复测。
- 暂停态每个文件仍占 2 路会话（定位 + 预备起播）。这是提前打开的设计，本次没动；停放后已全部释放。
- 开发版在 15:16（UTC）左右退出，日志里最后几条是字体目录监听，没有报错或崩溃记录，我没有重启它，原因未查。重启前需先确认 target/release 里是协议 7 的解码服务（已构建）。
- 测试工程“多轨4K”的 12 条视频轨已恢复全部启用。新增导出文件：`导出\多轨4K - 自定义导出 (4).mp4`（HEVC 5 秒，38MB）、`(5).mp4`（H.264 5 秒）。
