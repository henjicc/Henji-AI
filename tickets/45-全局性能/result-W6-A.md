摘要：多机位视图现在会按各机位素材估算格子加节目画面的解码负载，判为带不动时做两件事：
- 在格子下方给一条不打断操作的常驻提示，可选 1080P / 720P，主动作是“创建代理”，可以关闭。同一个多机位、同一组机位素材只提示一次。
- 代理建好之前，还在解原片的格子只解关键帧和参考帧。原生播放计划为此新增 `referenceOnly`，协议升到 8。

代理逐路复用现有的生成、排队与进度。建好一路，格子当场换用代理，并按新负载恢复逐帧解。助手通过只读属性 `video_edit.sequence.multicam_playback` 读到同一份结论，建代理走已有的 `generate_video_edit_proxy`。

实测：只解参考帧时节目画面 57.6 帧/秒、丢 2.2%；四路都有代理后 57.7 帧/秒、丢 1.7%。第二路代理没能在真实窗口里建完，原因是同时期其他任务的源码改动让开发版不停整页重载（见第五节）。

# 一、估算模型与依据（`src/core/videoEdit/decodeLoad.ts`）
- **单位是“参考路”**：一路 4K60 H.264 150Mbps 8 位 4:2:0 记为 1。
- **每路代价 = 帧率 ×（每帧固定开销 × 像素比）+ 每兆比特开销 × 码率**，两项相加。
  - 系数由 4090 的四个实测吞吐点解出：
    - H.264：每个 4K 帧 3.5ms，每兆比特 0.42ms；
    - HEVC、AV1、VP9：每个 4K 帧 1.23ms，每兆比特 1.075ms（熵解码每比特更贵）。
  - 单测验证模型能复现 220 / 260 / 255 / 470 帧/秒这四个点，误差小于 0.05 参考路。
  - 系数只用来定出不同素材之间的相对代价，不代表本机能力。
- **显卡解不了的格式按 3 倍计**：H.264 10 位、4:2:2 / 4:4:4、其他编码。
- **码率缺失时按参考素材的每像素码率推算**，宁可估高。
  - 码率来自原生探测，本次给探测结果加了 `bitRate` 字段，取流码率，没有就取容器码率。
- **一个多机位的负载 = 各格子 + 节目画面一路**：
  - 格子：有代理的按代理尺寸算，没有的按原片算；
  - 节目画面：按最重的那个机位算，只有项目开了代理时才按代理算。
- **本机能力**：
  - 默认 3 参考路，比 4090 实测的约 3.7 路保守。
  - 运行时修正：一次逐帧解、至少 2 秒的多机位播放，如果估算带得动却丢帧 ≥15%，能力降到这次负载 × 0.95，之后同样的负载判为带不动（`video_edit.multicam.decode_capacity.updated`）。所以解码单元更少的显卡，第一次播放后就会被纠正。
  - 只解参考帧的播放不参与修正。播放途中负载变化的（有代理建成）也不参与，这次的丢帧率对应不上某一个负载。
  - 修正只保存在本次运行里，不写盘：打开剪辑后自动预渲染那段 4K 负载会让一次观测偏低，不该带到下次。
- **判定**：至少有一个格子在解原片，并且负载大于能力，才判为可能卡顿。素材全有代理时始终判为带得动。
- **边界算例**（单测覆盖）：

| 素材组合 | 负载 | 判定 |
|---|---|---|
| 4 路 4K60 H.264 150Mbps + 节目 | 5 | 可能卡顿 |
| 2 路 + 节目 | 3 | 带得动 |
| 4 路 4K60 HEVC 50Mbps + 节目 | 2.3 | 带得动 |
| 4 路 1080P 代理 + 节目原片 | 2 | 带得动 |

# 二、只解参考帧
- **原生**：
  - `SchedulePlan::Times` 增加 `reference_only` 字段；`DropState::reference_only` 从第一项起一直跳过非参考帧，不随纹理池的走向退出。
  - 区间计划（导出、预滚）在原生 `main.rs` 和主进程 `texture-bridge.ts` 两处都拒绝 `referenceOnly`。
  - 协议升到 8；旧服务会在握手时被拒。
- **渲染层**：
  - 网格会话的 Worker 用一个模块级集合 `referenceOnlyMedia` 记录要只解参考帧的素材，由 `setReferenceOnly` 设置。
  - `VideoEditNativeFrames.referenceOnly(media)` 只在播放计划 `schedule()` 里读取，并传给分段计划和独立会话。
  - 单帧读取、顺序读取（`frames`）和预热都不带这个选项。
  - 节目监视器和导出各有自己的 Worker，不受影响。
- **监视器**（`videoEditMulticamMonitor.ts`）：每次准备画面时读取判断。带不动时把还在解原片的机位交给会话；变化时结束当前这次播放，下一个播放计划按新方式解。

# 三、界面选型
- **扩展 `UiToast`，没有新建组件**，加了四个有限变体：
  - `placement="inline"`：留在面板的文档流里。不盖住格子与操作；正文单行，放不下就截断，悬停看全文。
  - `choice`：主动作前的一个短选项，内部就是 `UiSegmented`。
  - `action.emphasis="primary"`：提示本身建议的唯一主动作。
  - `onClose`：关闭按钮。
- **为什么不用全局 `useNotification`**：全局通知会定时淡出，而且固定在窗口顶部，会盖住剪辑命令带。这个提示要等用户选择，所以放在多机位视图格子的下方。
- 已登记进 skill 的复用表（两侧同步，`check:skill-sync` 通过），设计系统样张也补了这种用法。
- **分辨率选项**：按还在解原片的最大机位算出实际输出尺寸，标签写短边：
  - 4K 横屏原片：1080P / 720P；
  - 如果 720p 预设不比 auto 小（原片本身不大），只留 auto 一档，不显示选择。
  - 为此把代理尺寸规则 `videoProxySize` 从主进程移到 `src/core/videoEdit/proxy.ts`，主进程改为导入，规则只有一份。
  - 显示文字一律大写 P；预设的值仍是 `auto` / `720p`。
- **文案**：“这组机位实时播放可能卡顿，建议创建代理”，进了 i18n（`notifications.multicamPlaybackHeavy`，中英各一份）。
- **截图**（`tickets/45-全局性能/验收证据/第四轮/`）：
  - `prompt-zoom.png`：提示放大。单行没有折行；分段选中为中性抬起底；只有“创建代理”一个强调色动作。
  - `a2.jpg`、`d1.jpg`：整窗。提示在格子下方，不遮挡格子和节目画面。
  - `e1.jpg`：点击后提示收起。
  - `e2.jpg`：第一路代理建好后，提示收起，格子换成代理并重新排布。
  - `g-ready.jpg`：全部有代理时不提示。
- **目视检查**：位置、层级、不折行、不遮挡都已看过，只看了深色主题。

# 四、助手同源
- `video_edit.sequence.multicam_playback`，只读：
  - 值为 `{ realtime: smooth | may_stutter | unknown, mediaWithoutProxy: [video_edit.media 引用] }`，普通序列读到 null。
  - 读取前会先确保各机位的探测结果和代理状态都已读到。
  - 属性描述里写了改善办法：对这些素材逐个调用 `generate_video_edit_proxy`。
- 没有新增工具；`check:application-control-coverage` 通过。
- 真实窗口里用 MCP 读到过：4 路原片的多机位是 `may_stutter` 并列出两个没有代理的素材；3 路已有代理的多机位是 `smooth`。
- `generate_video_edit_proxy` 的参数说明更新为：720p 是更小的可选档。

# 五、实测（RTX 4090，开发版，测试工程“性能验收-剪辑 11-12”）
测试素材：同目录新导入 0402、0407、0408、0409，新建多机位源“多机位-4路原片无代理”，以及父序列“多机位节目-无代理”。其中 0408、0409 本来就有代理，所以实际是 2 路原片加 2 路代理：
- 负载 3.5，判为可能卡顿；
- 0402、0407 只解参考帧。

全部就绪的那次用原有的“多机位-4路4K”：0402 的代理由本次流程建成，0403、0404、0406 原本就有。

每次播放 10 秒，前后间隔至少 1 分钟。

| | 代理前（2 原片只解参考帧 + 2 代理）`b1` | 全部有代理 `g` |
|---|---|---|
| 节目画面 | 566/579，57.6 帧/秒，丢 2.2%，最长连丢 5 | 568/578，57.7 帧/秒，丢 1.7%，最长连丢 4 |
| 网格实际帧率 / 丢帧 | 55.2 / 11.6%（最长连丢 21） | 57.7 / 7.5%（最长连丢 20） |
| 原片格子真实帧 : 沿用帧 | 每格 202 : 402（约 20 帧/秒，平稳） | — |
| 代理格子 | 每格 586 真实帧，没有沿用 | 每格 585 真实帧，没有沿用 |
| 解码单元平均 / 显卡平均 | 64% / 21% | 53% / 27% |

- 节目画面在两次实测里都读的是预渲染文件，`cached` 分别是 565 和 567。
- 两次网格的最长连丢都出现在起播头一段。
- 参照 W5-A 的 mc3（4 路原片全解）：网格 21.5 帧/秒、丢 63%，节目 47/493。这次原片格子只解参考帧，节目接近满帧，网格不再成片卡住。
  - 两次素材组合不同（这次只有 2 路原片），只能算定性对比。没有做“同一组素材、关掉只解参考帧”的对照。
- 代理生成：0402（358 秒 4K60）走 CUDA 硬解加 NVENC，用时 109 秒（`video.proxy.completed`，hardwareDecode=true）。建成后格子换用代理，判断改为带得动（负载 2.75），只解参考帧当场撤销。日志 `reference_only.changed` 显示 referenceOnly 从 2 变为 0。
- 截图与数据：`b1-play.json`、`g-play.json`、`b1-gpu.csv`、`g-gpu.csv`，以及上面列出的各张截图。脚本有 `multicam.cjs`、`full.cjs`、`play.cjs`、`pstats.cjs`、`eval.cjs`、`click.cjs`、`crop.cjs`、`shot.cjs`、`rawcdp.cjs`。

# 六、改动文件
- 原生：
  - `native/video-decoder/src/protocol.rs`（协议 8、`referenceOnly`）
  - `src/main.rs`（区间计划拒绝该选项）
  - `src/decode/mod.rs`（`SchedulePlan::Times { reference_only }`、集成测试）
  - `src/decode/plan.rs`（`DropState::reference_only` 与单测）
- 主进程：
  - `electron/main/services/video-decoder/protocol.ts`（版本 8）、`client.ts`、`texture-bridge.ts`（含测试）
  - `media-probe.ts`（`bitRate`）
  - `electron/main/services/video/proxy.ts`（尺寸规则改为导入）
- 契约：`src/platform/contracts/videoFrameTypes.ts`、`videoDecoderTypes.ts`
- 渲染引擎：`src/features/videoEdit/engine/videoEditNativeFrameSource.ts`（含测试）、`videoEditWorker.ts`、`videoEditRenderTransport.ts`
- 新增：
  - `src/core/videoEdit/decodeLoad.ts`（含测试）
  - `src/features/videoEdit/application/videoEditMulticamPlayback.ts`（含测试）
- 多机位：`src/features/videoEdit/panels/videoEditMulticamMonitor.ts`、`VideoEditMulticamView.tsx`（含测试）
- 代理与助手：
  - `src/features/videoEdit/application/videoEditProxy.ts`（批量生成可指定预设）
  - `videoEditFields.ts`、`videoEditReflection.ts`
  - `src/core/videoEdit/proxy.ts`
  - `src/core/application-control/domains/videoEdit/videoEditProxyCapability.ts`
- 界面：
  - `src/components/ui/UiToast.tsx`
  - `src/features/devGallery/gallerySections.tsx`
  - `src/i18n/locales/{zh-CN,en-US}/ui.json`
  - `.claude/skills/henji-ui-surface/SKILL.md` 与 `.codex/` 同名文件
- 实测脚本与证据：`tickets/45-全局性能/验收证据/第四轮/`

# 七、验证
- 原生：
  - `node scripts/video-decoder-ffmpeg.cjs test -j 8`：94 通过、1 忽略；新增“要求只解参考帧时，即使解码领先也不解非参考帧”。
  - `build` 通过，开发版跑的就是这一份。
- 渲染层与主进程 tsc（12GB 堆）：本次改动零错误。现存的 3 个错误在 `screenRecording` / `screen-recording`，是其他任务正在改的。
- vitest 相关 7 个文件 100 条全部通过：
  - `decodeLoad`
  - `videoEditMulticamPlayback`
  - `VideoEditMulticamView`
  - `videoEditNativeFrameSource`
  - `texture-bridge`
  - `video/proxy`
  - `UiToast`
- 另跑过并通过：`videoEditWorker`、`videoEditProxy`、`media-probe`、`client`。
- 门禁：
  - `check:surface:strict`、`check:colors`、`check:skill-sync`、`check:application-control-coverage` 通过；
  - 改动文件 eslint `--max-warnings 0` 通过。
- 新增测试保护的风险：
  - 估算判定边界；
  - 只解参考帧不进单帧读取、顺序读取和区间计划；
  - 同一组素材只提示一次，批量生成途中也不再提示；
  - 估算带得动却丢帧后改判。
- 提交前审查两轮：
  - 第一轮 1 条重要：提示去重键按“还在解原片的机位”计算，代理逐个建成后键随之变化，提示会再次出现，还可能重复发起生成。已改为按多机位全部机位素材计，并补了中途状态的测试。
  - 两轮共 5 条小问题，均已修：分辨率标签按实际输出写；能力修正改用播放全程的负载；渲染前确认剪辑还开着；档位失效时按第一档提交；注释位置。

# 八、未验证与风险
- **第二路代理（0407）在真实窗口里没建完**：
  - 同时期其他任务在改 `src/`（audio-capture、screen-recording 等），开发版每 10 秒到 1 分钟整页重载一次，渲染层持有的代理任务随之取消。0407 先后从提示流程和助手能力各发起过一次，都被取消。
  - 因此“格子逐路切到代理”只在真实窗口里看到第一路；全部就绪的实测改用原多机位。
  - 逐路切换和撤销只解参考帧由单测覆盖。
  - 整页重载会取消进行中的代理，这是原有行为，只在开发热重载时明显。
- **截图里节目画面区域偏右、超出面板**（`a3.jpg`、`e2.jpg`），还有播放头在 0 帧时原片格子全黑：都是多机位视图原有的现象，W5-A 已记过黑格子，本次没有处理。
- **只解参考帧的帧率取决于素材的 GOP**：这批 Sony IBBP 每格约 20 帧/秒；全 I 帧或全 P 帧的素材几乎没有可跳的帧。
- **能力修正只看多机位网格的丢帧**，只在本次运行里生效。显卡较弱的机器第一次播放会卡一次，之后才提示。
- **只在 4090 上实测**；Mac 上的 VideoToolbox 没有验证。
- **默认 3 参考路是保守值**：在 4090 上，2 路 4K60 H.264 原片加节目正好在线上，判为带得动。

# 九、现场
- 测试工程“性能验收-多机位”里，新增了素材 0407、0408、0409 的引用，多机位源“多机位-4路原片无代理”，和父序列“多机位节目-无代理”。原有内容没改。
- 为了重测提示，清过一次本机的提示关闭记录（localStorage `videoEdit.multicamProxyPrompt`），只影响这个测试多机位。
- 0402 新建了 1080P 代理；其他工程的代理没有动。`D:\视频制作` 只读。
- 开发版（调试端口 9334）在运行，停在工具首页。
- 没有执行任何 git 操作；`src/core/theme/__snapshots__/themeEngine.test.ts.snap` 没有动。
