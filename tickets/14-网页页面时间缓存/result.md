摘要：design.md 已按 review.md 全部19条裁定改写；完成可复现的 Electron/WebGPU/FFmpeg 探针，尚未实现网页时间缓存。
摘要：触发用户规定的停止条件：HEVC 4:2:0 彩字即使用无损编码参数，PSNR 24.31dB、SSIM 0.8587，未达到45dB/0.995；停止功能实现。
摘要：本机4:4:4 CUDA硬解成功，无损候选通过本夹具；下一步须先裁定4:2:0不达标设备的路线，再接入实际捕获/消费链及macOS验证。

# ticket 14 回报（2026-11-01）

## 状态与范围

- 状态：**设计及探针阶段完成，任务未完成，按画质门槛停止**。不能报告“19条已实现”或“03遗留已收口”。
- 工作目录 `D:/VibeCode/Henji-AI-t14`，分支 `task/14-网页页面时间缓存`，开始HEAD `a05191f9d`，已确认包含 `102735cea`；初始干净，无上游。未切分支、未合并到main、未merge/pull/rebase、未push。
- 外部交付在 `D:/VibeCode/Henji-AI/tickets/14-网页页面时间缓存`；将design/result及现有plan/review同步到任务分支同路径以供提交，未改plan/review内容。提交内容以该任务分支 `git log -1` 为准，最终回复给出提交号。
- 生产代码、.tsx、导出schema、package.json、锁文件均未修改。未安装/卸载依赖。node_modules联接点未替换；只消费现有依赖。
- 没有连接/控制9334，没有启动真实资料实例，没有访问或修改 `D:/视频制作` 工程。只启动本探针隔离Electron、随机CDP端口及其FFmpeg进程；结束检查无本探针遗留Electron/FFmpeg进程。
- 随包FFmpeg二进制在主工作区只读执行；输入/输出全部为本任务生成夹具，产物落本任务 `.artifacts/web-time-cache/`，未向主工作区写入运行产物。

## 已改内容

1. design正文统一为读回先行、多平台编码选择、先探色度、带相位网格、变体共用解码会话、主进程外来确认、可靠帧发布、显式精度与来源传播、可续录抢占、段族回收。移除旧第14节冲突的实施指令。
2. `scripts/probe-web-time-cache.cjs`：复用既有Electron隔离启动器，打包现有GPU reader内核，串行运行尺寸矩阵及独立色度候选；记录FFmpeg原始参数/退出码/日志。明确区分未取证、未达标与候选通过。
3. `scripts/lib/webTimeCacheProbe.ts`：生成中文/英文饱和彩字、1px细线和灰阶夹具；复用 `GpuFrameCapture`，验证实际帧尺寸，预热后计时，退出仅清理自己持有的编码子进程。

## 真机环境与证据

- RTX 4090，驱动610.47，24564MiB；Electron44.9.3，Chromium152.0.7977.167，FFmpeg `n9.0.2-17-g2a571b6068-20260930` GPL shared（现有随包构建）。
- 探针读取：`D:/VibeCode/Henji-AI/native/video-decoder/target/release/ffmpeg.exe`。未用PATH里另一份FFmpeg冒充随包版本。
- 正式证据目录：[2026-10-31T16-03-35-902Z](../../../Henji-AI-t14/.artifacts/web-time-cache/2026-10-31T16-03-35-902Z)（UTC，对应北京时间11月1日00:03）。含 `evidence.json`、`output-streams.json`、`truth.png`、四档编码/硬解PNG/原始日志、三档吞吐MP4。大文件/临时产物不进Git。
- GPU已有其他活动：开始查询15%，后续查询20%、显存约9915MiB；未关闭用户开发版或其他进程。不是独占GPU的稳定性能验收，未采集峰值显存/RAM，不能据此承诺帧率或与普通视频等速。
- 每个负载串行；一次完整正式探针约数十秒，FFmpeg每项180秒超时，Electron矩阵180秒总超时。所有FFmpeg媒体命令带 `-hwaccel cuda`；硬解强制 `hevc_cuvid`、CUDA输出再 `hwdownload`，拒绝把软件回退当硬解。

复现（从任务工作目录）：

```powershell
node scripts/probe-web-time-cache.cjs 'D:\VibeCode\Henji-AI\native\video-decoder\target\release\ffmpeg.exe'
```

只测吞吐可追加 `--throughput-only`。独立色度候选都未达标时退出状态为 `stop-quality-gate`（脚本设退出码2）；任一探针执行/解析失败为 `incomplete-evidence`（3），不把未取证记为画质失败。只要某个4:2:0候选通过就不按“全部4:2:0失败”停止；不把某一候选通过等同整条缓存链验收。

## 1080p / 4K / 8K 读回与编码吞吐

**范围：现有 compositor共享纹理→GPU reader NV12/BT.601→主进程IPC/拼片→stdin→HEVC420 NVENC。不是新的html-in-canvas可靠帧流水线，也不是4:4:4/BT.709缓存成品路线。**

全屏每帧改变背景，60帧测量、6帧预热；NVENC p5/hq/vbr/cq16/b=0/bf=0/g=30。真实CSS视口1920×1080，offscreen DPR为1/2/4，CDP按正式网页源的视口覆盖方式配置；每帧断言实际输出尺寸。文件经ffprobe确认三档尺寸分别为1920×1080、3840×2160、7680×4320，均HEVC Main/yuv420p、60/1、66帧。

| 实际尺寸 | 含编码排空总吞吐 fps | 60帧总时长ms | 取帧+读回 P50/P95 ms | 管道写入 P50/P95 ms | 排空ms |
| --- | ---: | ---: | ---: | ---: | ---: |
| 1920×1080 | 46.02 | 1303.87 | 18.77 / 22.92 | 0.77 / 1.15 | 65.53 |
| 3840×2160 | 17.12 | 3505.61 | 50.66 / 56.05 | 4.18 / 5.22 | 89.39 |
| 7680×4320 | 4.66 | 12874.44 | 187.65 / 235.98 | 13.65 / 18.89 | 196.08 |

“取帧+读回”包含等待paint、GPU计算/读回、IPC与主进程拼片/复制，**不是纯GPU mapAsync时间**；“管道写入”不是纯编码器耗时，编码异步重叠。不能把8K的187.65ms直接说成GPU读回瓶颈，尚无依据另立原生桥实施。每档67次paint、1次旧票据丢弃；这是捕获诊断，不能当正式播放丢帧率。

探针调试记录：首次preload立即初始化时取不到WebGPU，改为DOMContentLoaded后安装既有reader；第二个问题是Windows工作区将离屏4K/8K窗口裁成3840×2100，已用DPR+视口覆盖解决，失败尺寸未计入上表。之前的失败/探索目录仍留本地便于排查，不作为验收通过证据。最终完整运行全部三档已取证。

## 色度、硬解与画质门槛

独立候选探针：同一个1920×1080 Chromium页面无损PNG→FFmpeg显式BT.709 limited转换→HEVC NVENC→强制CUDA/cuvid硬解→显式BT.709反变换→RGB PNG。比较采用RGB三个通道的PSNR/SSIM（gbrp），**没有先把真值降成420再比较**。VUI标记bt709矩阵/原色、sRGB传递、limited范围。4帧编码，比较硬解首帧；未把这一局部通过当整页/8K/所有字体验收。

| 候选 | CUDA硬解 | RGB PSNR dB | RGB SSIM | 对45dB/0.995门槛 |
| --- | --- | ---: | ---: | --- |
| HEVC444 p5/hq/cq16 | 成功 | 36.823481 | 0.972583 | 不通过 |
| HEVC444 p5/lossless/constqp/qp0 | 成功 | 50.298923 | 0.999582 | 本夹具通过 |
| HEVC420 p5/hq/cq16 | 成功 | 24.145606 | 0.850781 | 不通过 |
| HEVC420 p5/lossless/constqp/qp0 | 成功 | 24.310977 | 0.858687 | 不通过 |

四组编码、硬解、指标命令均退出0，原始日志留证，故这里是真实画质不合格而非执行失败。已打开原图和420硬解图目视，彩线/彩字边缘有暗淡与色边；数值门槛本身已足以否决。编码器的lossless只能保留进入它的YUV，不能恢复RGB→420时丢失的色度，不能以提高码率解决。

重要边界：444通过的是**独立编解码候选**，当前reader仍输出NV12/420，未实现444读回；CUDA硬解成功也不等于应用现有D3D11VA/共享纹理消费链已经可用。macOS/VideoToolbox、其他GPU、444在4K/8K、完整可靠帧与逐帧几何均未验证。不能宣称跨平台缓存档已确定。

本轮按用户“4:2:0也过不了门槛就停下回报”停止功能实现；同时保留本机444无损候选作为后续裁定证据，未擅自取消macOS覆盖或改用另一种持久编码格式。

## 19条裁定实际状态

全部19条均已进入design正文；实现状态如下，未把文档修改计为功能完成。

| 裁定 | 实际状态 |
| --- | --- |
| 1 读回+既有FFmpeg、多平台 | Windows现有读回内核三尺寸吞吐已测；缓存生产适配/macOS未实施 |
| 2 色度先探针 | 已测，420不达标触发停止；444无损只通过独立1080p夹具 |
| 3 网格相位 | 设计已改，未实施 |
| 4 变体共享解码 | 设计已改，未实施 |
| 5 主进程外来确认 | 设计已明确仅这一次范围，未实施 |
| 6 确定性/网络/字体/分区 | 设计已改，未实施 |
| 7 仅可靠帧发布 | 设计已改，未实施；本轮吞吐不冒充可靠帧验收 |
| 8 显式精度 | 设计已改，未实施 |
| 9 ≤1440p优先 | 设计已改，未实施 |
| 10 保留会话续录/导出顺手缓存 | 设计已改，未实施 |
| 11 内核锁协调 | 设计已改，未实施 |
| 12 会话不足退槽 | 设计已改，未实施 |
| 13 缺帧向前重演/守护区 | 设计已改，未实施 |
| 14 离散倍率迟滞 | 设计已改，未实施 |
| 15 同尺寸占位 | 设计已改，未实施 |
| 16 批次哈希、不复制目录 | 设计已改，未实施 |
| 17 无限底层预算、段族回收 | 设计已改，未实施 |
| 18 多槽交叠比对 | 设计已改，未实施 |
| 19 旧provenance兼容 | 设计已改，未实施 |

## 功能验收尚缺的数据

播放/拖动流畅度、命中率、补录进度、正式回退原因日志、导出网页段每帧耗时、冷页首3秒丢帧均**未测**：缓存功能未实施，不能用上表的探针吞吐替代这些数据。ticket03的完整取帧流水线、屏幕倍率、作者占位尺寸、剪点预开、冷页首播五项均未实施/未验收。未添加导出选项。

供Claude后续把关的唯一UI行候选：标签“使用网页缓存”；悬停提示“加快导出，网页画面经过有损压缩；缺失部分实时渲染”。候选未落进.tsx，未修改其他界面。

## 验证与独立审查

- `npm run verify:changed -- --level L2 scripts/probe-web-time-cache.cjs scripts/lib/webTimeCacheProbe.ts --test electron/main/services/web-replay/player/gpuCapture.test.ts --test electron/main/services/web-replay/player/encoder.test.ts`：通过，2文件5测试。显式选择的是实际复用内核测试；该入口对scripts只安排测试，**不代表脚本已被全应用tsc覆盖**。
- `node node_modules/typescript/bin/tsc --noEmit --target ES2022 --module commonjs --moduleResolution node --types node,electron --skipLibCheck --esModuleInterop --strict scripts/lib/webTimeCacheProbe.ts`：通过，补充检查探针TS入口及直接依赖，不写联接点增量缓存。
- `node node_modules/eslint/bin/eslint.js scripts/lib/webTimeCacheProbe.ts --report-unused-disable-directives --max-warnings 0`、`node --check scripts/probe-web-time-cache.cjs`：通过。夹具数值颜色是测量输入，局部注明静态规则例外，不是正式UI颜色。
- 门槛聚合状态临时定向验证：全部420失败/有一个420通过/有候选未取证三种情况通过；`inf`已单独处理，不把无穷PSNR写成null或不合格。
- 真机专项：全部探针执行取证成功，**画质门槛失败**，报告status=stop-quality-gate；不得将其称为专项全部通过。
- `check:assistant-capabilities`未运行：按明确停止条件未进入功能实施，应用能力/入口未改。`check:persistence-compat`不适用：未改导出或其他持久schema。完整应用GPU专项、播放/拖动/导出Reality未运行，不能宣称满足整票完成标准。
- 独立审查2轮。首轮2项重要：不同链路证据可能混用、未取证与失败未区分；分别增加明确scope/报告边界、阶段状态和非零退出码。另1项小问题inf解析已修。第二轮只审增量，未发现新增问题。
- 实际检查范围：新增探针、直接复用GpuFrameCapture/reader/编码与Electron隔离启动链；未更改或全面审计网页缓存消费方。已修探针报告问题；正式链路同源缺陷未做修复结论。

## 下一步

先由Claude/用户依据本报告裁定420失败设备的处理路线；本机可继续研究444无损，但必须实现实际444读回、验证正式解码/色彩消费与macOS路径，不能把CUDA候选结果当已经接通。若仍要求所有目标平台提供缓存，需重新确定达标的跨平台编码/回退方案；本轮不自行改设计方向或降低门槛。

路线裁定后继续：缓存键/相位与段契约→主进程信任与可靠帧→共享解码会话和段族回收→补录/抢占→显式精度所有直接消费者→03五遗留→导出useWebCache/能力/日志→相关单测与完整真机指标。需改依赖时按用户约束停下记录。

一手资料：[FFmpeg色彩、PSNR/SSIM滤镜](https://ffmpeg.org/ffmpeg-filters.html)、[NVIDIA NVDEC能力说明](https://docs.nvidia.com/video-technologies/video-codec-sdk/13.0/nvdec-application-note/index.html)。本机结论以探针日志为准，未用能力表替代实测。


## 续作：4:4:4 GPU 读回与正式消费链核验（2026-11-01）

摘要：按 11-01 色度裁定实现了现有 GPU reader 的 BT.709 limited 平面 4:4:4 输出；1440p/4K 无损探针达到 45 dB / 0.995，编码前后 YUV 首帧逐字节相同。
摘要：**ticket 14 未完成**。CUDA 硬解通过，但正式 D3D11VA 解码入口实际软解回退；尚未接入缓存发布、调度、节目监视器或导出。
摘要：本轮交付可复用的读回阶段代码、专项证据和解码阻塞定位；只提交任务分支、不 push。后续应先补通正式 4:4:4 硬解消费链，再实施其余裁定。

### 本轮范围

- 从 `1af8af950decac87dd08745ef822c5ef52e02308` 的干净任务分支开始，未切分支、未同步/合并 main、未 push。最终提交号见本轮回复。
- 最终依据为外部 `review.md` 末尾“探针后的裁定（11-01）”；其中 4:4:4 硬编硬解双探测、macOS 不启用覆盖 design 中此前的平台/420 候选描述。任务分支同步该 review 原文，未修改外部 review/design。
- 扩展现有 `GpuFrameCapture` 与 `web-replay-reader`，沿原共享纹理/IPC/瓦片增量路径，增加 GPU BT.709 limited Y/U/V 三平面打包。NV12 默认调用仍维持原有矩阵与尺寸行为；444 保留奇数边缘、独立色度和预览反变换。帧格式通过泛型保持调用方类型约束，未让旧 H.264 编码器误收 444。
- 探针改为 1440p/4K、HEVC NVENC p5/lossless/constqp/qp0、无 B 帧、30 帧 GOP、关闭 lookahead；输入端与输出端同时声明 BT.709、limited、sRGB 传递。只有 1440p60 超过 200 Mbps 才启动 qp 4/6/8 候选。
- 增加原始 YUV 首帧硬解逐字节比对、RGB 指标、正式 `VideoDecoderService.openDecoder` 探测、构建包与二进制 SHA。原生探测检查真实解出的首帧；尚不包括共享纹理交付/随机 seek/连续播放。
- 没有更改产品 .tsx、设置/导出 schema、业务缓存文件格式、助手入口或正式缓存日志。没有新建另一套生产编码器；FrameEncoder 的正式 HEVC 接入仍待做，当前 FFmpeg stdin 属专项夹具。
- `node_modules` 保持指向主工作区的联接点；未 install/ci/uninstall，未更改 package/锁文件。类型检查缓存落本任务 `.tmp`，未写联接点内缓存。没有操作 9334，没有访问 `D:/视频制作` 工程，没有启动真实资料实例。主工作区仅追加本 ticket/result；随包二进制只读使用。

### 真机数据与可复现边界

- 正式证据目录：`D:/VibeCode/Henji-AI-t14/.artifacts/web-time-cache/2026-10-31T16-23-15-835Z/`，控制台日志 `.artifacts/web-time-cache/final-run.log`。`evidence.json` 包含准确参数、命令退出码、bundle SHA、基线 HEAD 与环境；探针直接打包本次源码，不读取陈旧 out。该目录不入 Git。
- 环境：RTX 4090 / 驱动 610.47 / Electron 44.9.3 / Chromium 152.0.7977.167 / FFmpeg `n9.0.2-17-g2a571b6068-20260930`。后续静态检查时 GPU 查询为 9%、10199/24564 MiB；机器仍有其他 GPU 活动，未取得独占负载或峰值内存证据。
- 各尺寸同一全屏交替背景、中文/英文饱和彩字、1px 线与灰阶夹具，6 帧预热+120 帧计时，实际编码126帧，文件时长2.1秒。以下每项为最终运行的一次样本；此前两次修正后重复运行字节数/画质相同，吞吐有共享机器波动，不能称稳定性能基准。
- CSS viewport 1920×1080，DPR 为 4/3 和 2；每帧断言实际像素尺寸。真值取该画布未经 YUV 转换的 PNG；比较硬解首帧，不把真值先降到 420。两档 YUV 首帧与编码输入逐字节相同，RGB 误差来自 8 位矩阵量化。

| 尺寸 | 含排空吞吐 fps | 文件 Mbps@60fps | MB/分钟（十进制） | 等 paint+读回+IPC P50/P95 ms | GPU 复制/差分/票据小块 P50/P95 ms | GPU 打包+像素读回 P50/P95 ms | RGB PSNR dB / SSIM |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| 2560×1440 | 19.49 | 49.54 | 371.54 | 45.67/51.81 | 3.80/4.90 | 8.00/9.10 | 50.252887 / 0.999598 |
| 3840×2160 | 9.25 | 107.11 | 803.32 | 94.67/134.80 | 6.40/27.40 | 15.70/24.50 | 50.199880 / 0.999613 |

- 1440p 的 49.54 Mbps 未触发约 200 Mbps 阈值，**未试 qp4–8，未批准近无损档**。每分钟体积由短片推算，尚无复杂网页、视频纹理、噪声等素材的最坏值证据。
- 计时范围是 compositor 夹具→共享纹理→既有 GPU reader→IPC/拼片→FFmpeg。票据小块计时包含 GPU 全帧复制和瓦片差分；像素计时包含打包、mapAsync 与拷贝。尚未接 html-in-canvas 可靠快照/网页源守护区，不把这一组数当正式录制流水线或前台播放帧率。
- 所有 FFmpeg 媒体命令带 `-hwaccel cuda`；硬解额外强制 `hevc_cuvid` + CUDA 输出 + hwdownload，未把软件回退记作 CUDA 成功。媒体命令180秒限时，Electron矩阵180秒限时，重任务串行执行；结束未发现本探针 Electron/FFmpeg/原生解码进程遗留。

复现命令：

```powershell
node scripts/probe-web-time-cache.cjs 'D:/VibeCode/Henji-AI/native/video-decoder/target/release/ffmpeg.exe'
```

本机最终退出码 **4**，`status=native-playback-unavailable`；这是正式硬解入口未通过，不能报告整个 GPU/FFmpeg 专项通过。其他状态：命令/指标未取证为3，qp0画质/无损字节校验不通过为2；候选通过不能代替页面缓存验收。

### 已定位的两个原因

1. **FFmpeg 输入色彩缺失导致二次转换，已修复。** 初次运行只在输出声明 BT.709，rawvideo 输入是 unknown，FFmpeg 9 自动插入 YUV→RGB→YUV 矩阵转换。表现为37.27/37.43 dB、SSIM约0.974，硬解 YUV 与输入最大差21；补上输入色彩声明后达到上表指标并逐字节相同。失败证据保留在 `2026-10-31T16-13-35-911Z`，未混入正式通过结果。
2. **正式硬解消费尚未接通，未修复。** 同一1440p MP4通过现有 VideoDecoderService 打开，日志 `video_decoder.native.decode.hardware_fallback_reopen`，最终 `decoder.hardware=false`、`decoder.path=shader_planar`、`pixelFormat=yuv444p`。最终 hardwareRequested=false 是软解重新打开后的结果；原始请求确为 hardware:auto。这证明当前入口回落软件，不能据此把4090判成“不支持444”。

FFmpeg 对应版本的 [HEVC get_format 一手源码](https://github.com/FFmpeg/FFmpeg/blob/2a571b6068/libavcodec/hevc/hevcdec.c) 中，YUV444P 分支提供 CUDA 等格式，未提供 D3D11；现有宿主 `native/video-decoder/src/platform/windows/mod.rs` 只创建 D3D11VA 设备。另查 `convert/mod.rs:write_path`，硬解转换仅接受 NV12/P010，尚无444硬件表面消费。因此仅把编码器切到444、或仅增加能力标签，均不能接通播放。后续需在现有原生服务内支持可用的444硬解及转换/共享纹理，不以软件解码绕过裁定。此处为路线接入缺口；本轮没有实现、也没有按此宣布所有设备均永久不可用。

原生二进制 SHA256：`5154d81954d9ddc649558fdae775cf5e91e0d18be9c2817b6d5b9d41cbe93a14`；FFmpeg SHA256：`972c36ee5e1716c5b6610723e6a53f31b1cb51a09b48543c8885771de04975ab`。原生代码本轮未改，探测使用现有随包构建，不能当作新原生实现的验收。

### 19 条裁定落实清单

| 条目 | 本轮实际状态 |
| --- | --- |
| 1 读回+既有编码链 | 现有 GPU reader 增加444并实测；生产 FrameEncoder/缓存服务未接入；macOS未启用 |
| 2 色度/能力 | GPU444、NVENC无损、CUDA硬解与画质通过；正式D3D11VA消费未通过；运行时双探测门禁尚未接入 |
| 3 相位网格/分段键 | 未实施 |
| 4 共享解码会话 | 未实施；先解决上述硬解入口缺口 |
| 5 外来确认 | 未实施缓存登记；没有执行任何外来页面 |
| 6 网络/字体/存储环境 | 未实施 |
| 7 可靠帧发布 | 未实施；本轮是compositor夹具，不能计作html-in-canvas可靠快照 |
| 8 显式精度/所有消费者 | 未实施 |
| 9 ≤1440p优先 | 测了1440p档，尚无调度实现 |
| 10 抢占保留/导出顺手缓存 | 未实施 |
| 11 内核锁跨实例协调 | 未实施 |
| 12 资源不足退槽 | 未实施；探针执行错误保留为未取证，不记永久不支持 |
| 13 向前重演/守护区 | 读回阶段开销已分列；正式网页守护区、缺帧重演未实施 |
| 14 离散倍率/迟滞 | 未实施 |
| 15 同尺寸占位 | 未实施；444奇数边缘保留不等于占位尺寸修复 |
| 16 批次清单哈希 | 未实施 |
| 17 段族缓存回收 | 未实施 |
| 18 多槽交叠一致性 | 未实施 |
| 19 provenance兼容 | 未实施，原预渲染格式未动 |

ticket03五项：完整取帧流水线、按屏幕实际尺寸定倍率、占位宽高、硬剪点预开、冷页首播，均尚未实施/验收。播放/倒拖与普通视频对照、抢占P95、冷页前三秒、导出提速均未测，不能用录制吞吐代替。

导出唯一UI行仍未落代码。供Claude把关的文案：标签“使用网页缓存”；悬停“使用缓存加快网页渲染；色彩转换可能产生轻微误差，缺失部分实时渲染”。无损指编码阶段，未许诺RGB往返逐字节无损。

### 验证、审查与下一步

- 验证级别L2：共享捕获格式和preload跨进程契约变动。显式7文件 `verify:changed -- --level L2` 通过：2份精确测试/6测试、改动lint、Electron类型、依赖图、主进程导入、IPC对账。新增用例通过公开take接口验证65×67三平面边缘、增量瓦片和已交付快照不被覆写。
- preload reader不在tsconfig.electron默认include的有效范围，另以 `tsc --noEmit --target ES2022 --module commonjs --moduleResolution node --lib ES2022,DOM --types node,electron,@webgpu/types --skipLibCheck --esModuleInterop --strict electron/preload/web-replay-reader.ts` 检查通过。
- 探针TS入口及直接依赖以同样严格选项（types node,electron）单独检查通过；packages类型与探针TS lint、`node --check scripts/probe-web-time-cache.cjs`、`git diff --check`通过。
- 按本次用户明确完成标准运行：`npm run check:persistence-compat`通过（65格式）；`npm run check:assistant-capabilities`通过（结构门禁、覆盖15测试、不变量31文件237测试）。未改schema/能力登记，这些门禁不能证明尚未实现的缓存功能。
- 真GPU/FFmpeg专项：444读回/编码/CUDA首帧字节/画质通过，正式硬解入口失败，整体退出4。无需启动业务应用验证该阶段；探针直接打包最新reader，未以旧out充数，也未跑完整electron:build。
- 独立审查1轮：未发现本次引入的重要问题。实际覆盖共享reader、444瓦片拼接/奇数尺寸、默认NV12调用链、预览矩阵及探针判据；正式web-source、全部精度消费方、调度与持久缓存尚未实现/未验收。
- 下一步先接通并实测原生服务的444硬解→色彩转换→既有共享纹理输出；通过后才把该消费链作为能力门禁，再依次实施网格/段契约、信任与可靠帧发布、共享解码/回收、补录抢占、精度传播、03五遗留和导出一行。当前无可交付的网页时间缓存功能，不应合并或按整票完成验收。
