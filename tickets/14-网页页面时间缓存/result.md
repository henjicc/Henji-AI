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


## 续作：正式 HEVC444 硬解共享纹理消费链（2026-11-01）

摘要：本轮接通 **FFmpeg NVDEC → CUDA/D3D11 GPU 缓冲互操作 → 既有 HLSL → rgbaf16 共享纹理 → 正式 VideoFrameBridge → Chromium VideoFrame/Canvas2D**。1440p、4K 的真实消费及画质通过。
摘要：**整票未完成**；尚未实现网页时间缓存调度、发布/失效、缓存命中与回退、精度传播、03 遗留和 useWebCache。不能把解码底座通过写成 19 条全部落实。
摘要：只在 task/14-网页页面时间缓存 提交；不切分支、不合 main、不 push。阶段提交号见回复及本分支 git log。

### 路线证据与实现边界

- 从干净 HEAD `180bcbf27` 开始。优先读取外部 review.md 的“读回阶段后的裁定（11-01）”，将裁定原文同步到任务分支；未改外部 review/design。
- **本机确有 Main444 GUID**：原生服务枚举 RTX4090 的 27 个 D3D11 档案，含 `4008018F-F537-4B36-98CF-61AF8A2C1A33`（Main444）、`0DABEFFA-4458-4602-BC03-0795659D617C`（Main10 444）、`9798634D-FE9D-48E5-B4DA-DBEC45B3DF01`（Main12 444）。档案表已补齐，诊断返回完整 GUID。证据：`.artifacts/web-time-cache/native-consumption/profiles.json`。
- 第一条路线的实际缺口是**随包 FFmpeg 实现**：固定版本的 HEVC get_format / dxva2 档案只为 D3D11 提供 Main/Main10，没有 RExt444 协商及消费支持。存在驱动 GUID 不等于该 FFmpeg 可用；遵守“不改依赖”，没有改 FFmpeg DLL 或自行实现 HEVC 解码器，继续使用已裁定的第二条互操作路线。
- 选择复用现有 FFmpeg 原生 HEVC/NVDEC（`decoderName=hevc`，实际硬件帧 CUDA）与 D3D11 HLSL 转换，新增的只是 Driver API 绑定和 GPU 缓冲交接；没有复制编解码算法、引入 CUDA Toolkit 运行依赖或 CPU 下载/再上传路径。
- 同适配器通过 `cuD3D11GetDevices` 取得 CUDA ordinal，不能默认取 GPU0。系统驱动动态载入；FFmpeg 自己管理 NVDEC 设备。每会话缓冲只注册一次，逐帧 map/设备到设备平面复制/unmap，同步完成后才归还帧；缓冲持有 FFmpeg 设备引用，销毁时先解除注册再释放上下文。
- 容器快速打开时 `AVCodecParameters.format=-1`，不能据此选硬解。设备重选放在 FFmpeg 已解析 SPS 的 get_format 回调，以软件格式变化触发；驱动/图形 API 选择仍由平台层完成，通用解码层只查询 FFmpeg 硬件格式契约。
- 普通素材的 auto 软件回退保持可用。当前**没有启用网页缓存**；专项必须同时得到 hardware=true、cuda_planar、成功共享纹理消费及合格画质才通过，软件结果不被接受为缓存能力。正式运行时的“硬编+硬解+互操作双探测后才建缓存”门禁仍待调度阶段接入。
- 未改变 .tsx、导出 schema、持久缓存格式、助手注册或业务 UI；没有新增正式 IPC/日志通道。探针专用 IPC 仅存在于隔离测试窗口，正式生产交付复用现有纹理桥和日志链。

### 真机专项

环境仍为 RTX4090 / 驱动610.47 / Electron44.9.3 / Chromium152 / 随包 FFmpeg n9.0.2-17-g2a571b6068。非独占 GPU；未关闭用户的其他活动。数据不是节目监视器物理呈现帧率。

最终原生二进制 SHA256：`19a461147e1b69e3477cf178febe9f222027f4fb5a1d5b204b8918629c351b3d`；FFmpeg SHA256：`972c36ee5e1716c5b6610723e6a53f31b1cb51a09b48543c8885771de04975ab`。此产物包含常驻解码工作线程修复。

| 尺寸 | 正式共享纹理 RGB PSNR / SSIM | 顺序取帧至渲染侧消费 P50/P95 | 交付/释放 | 导入/发送失败 |
| --- | --- | --- | --- | --- |
| 2560×1440 | 50.245394 dB / 0.999599 | 3.023 / 7.759 ms | 64/64 | 0/0 |
| 3840×2160 | 50.192739 dB / 0.999614 | 4.969 / 14.174 ms | 64/64 | 0/0 |

- 每档60个连续网格请求，再跳至1.5、0.2、1、0秒；每帧真正导入、生成 VideoFrame 并交给 Canvas2D。表内延迟只取第2–59帧（排除PNG检查点0/1），包含请求/解码/互操作/进程交接/Canvas2D提交，不是 GPU 完成或屏幕上屏时间，不据此宣称时间线已流畅。
- 0/1/63三个检查点读回PNG；第63次回到首帧与首次PNG SHA相同，相邻帧PNG不同。所有记录的PTS与请求网格一致（允许微秒取整）。正式共享纹理RGB与未降色度的原始canvas真值对比，两档均达到45dB/0.995；已打开4K实际输出目视。
- 两档关闭后：streams为空、hardwareSessions=0、vramReservedBytes=0、桥无未释放导入。进程实际显存分别约50.4/98.9MiB，包含驱动常驻，不冒充0；未测设备丢失恢复及跨GPU。
- 最终1440p证据：`.artifacts/web-time-cache/2026-10-31T16-56-14-248Z/`；4K：`2026-10-31T16-56-37-978Z/`。两次状态均为 native-texture-consumption-complete、退出0，含bundle/输入/二进制SHA、原生与桥日志、PNG、RGB指标与关闭后资源。
- 编码复跑证据：`2026-10-31T16-38-49-959Z/`。GPU444读回+无损编码：1440p19.88fps / 49.54Mbps / 371.54MB每分钟；4K9.67fps / 107.11Mbps / 803.32MB每分钟。两档硬解YUV与输入逐字节相同；体积由2.1秒夹具外推，未触发qp4–8，未宣称复杂网页最坏值。
- 早期探索目录 `16-36-23-019Z` 和 `16-40-06-146Z` 用于定位，不替代最终二进制对应证据。

复现（在本任务目录；先用仓库脚本构建原生服务，不更改依赖）：

```powershell
node scripts/video-decoder-ffmpeg.cjs build
node scripts/probe-web-time-cache.cjs native/video-decoder/target/release/ffmpeg.exe
node scripts/probe-web-time-cache.cjs native/video-decoder/target/release/ffmpeg.exe --native-only .artifacts/web-time-cache/2026-10-31T16-38-49-959Z/3840-qp0.mp4
```

native-only 使用本探针生成的MP4及同目录 `*-truth.png`；它包含交替帧夹具，不能拿任意静态视频的“下一帧应不同”结果当通用解码判据。

### 生命周期回归与同源排查

- 重复开关20次暴露 CUDA 会话每次遗留2个进程句柄：H264对照574→574，CUDA593→631；只创建解码器、不做互操作仍增长。改为共用设备上下文试验仍增长，试验代码已撤销。
- 用临时原生诊断隔离：同一线程20次创建/销毁CUDA上下文保持518；20条新线程则520→558。根因范围是驱动的线程状态，不能只调整纹理释放掩盖。
- 复用已有Rayon管理常驻解码线程：每个并发会话独占一条，按实际并发扩容，空闲复用；会话资源仍按原生命周期销毁，panic交回既有流治理。没有新增并发硬上限。非Windows仍保留原线程方式。
- 最终20次开关（每次0、0.5、1、0.2秒定位）通过句柄恒定断言：**601→601**；显存72990720→72990720字节，关闭后的streams/硬件会话/预算归零，没有cuda.release_failed。私有提交425672704→427528192字节，未见按会话数线性增长，但不外推长时高并发。
- 同源消费回归：H264 NV12、HEVC420、HEVC10分别保持copy_nv12/copy_nv12/shader_semiplanar；显式hardware=off保持shader_planar，后者只是普通素材兼容性负对照，不能用作网页缓存能力。
- 证据：`.artifacts/web-time-cache/native-consumption/regression.json`、同目录`regression.cjs`、`.tmp-native-context-handles.log`。复现：`node .artifacts/web-time-cache/native-consumption/regression.cjs`（依赖本轮生成的夹具）。常驻线程测试覆盖会话阻塞互不影响及panic后继续服务；未做真实CUDA并发高水位和设备丢失专项。

### 19条与剩余范围

| 条目 | 本轮后状态 |
| --- | --- |
| 1 读回+现有编码链 | GPU444读回已有；正式解码消费接通。生产FrameEncoder/录制服务仍未接；Mac不启用 |
| 2 色度与能力 | 本机无损444硬编、NVDEC及真实共享纹理画质均通过；生产缓存能力门禁未接 |
| 3 相位网格 | 未实施 |
| 4 同变体共享解码 | 未实施。现为每视频会话，参考表面仍用通用预算，未按实际参考数收缩 |
| 5 外来确认 | 未实施缓存登记；本轮仅本机自造夹具 |
| 6 确定性/网络/字体/分区 | 未实施 |
| 7 可靠帧发布 | 未实施，不能将compositor夹具等同html-in-canvas可靠帧 |
| 8 显式精度 | 未实施 |
| 9 1440p优先调度 | 未实施，仅两档底座实测 |
| 10 抢占保留/导出顺手缓存 | 未实施 |
| 11 跨实例内核锁 | 未实施 |
| 12 资源不足退槽 | 未实施缓存槽调度，普通原生会话行为保留 |
| 13 向前重演/守护区 | 未实施正式网页录制链 |
| 14 离散倍率迟滞 | 未实施 |
| 15 同尺寸共享占位 | 未实施 |
| 16 批次哈希 | 未实施 |
| 17 段族回收 | 未实施 |
| 18 多槽交叠 | 未实施 |
| 19 provenance兼容 | 未实施，旧格式未改 |

03的完整取帧流水线、屏幕倍率、占位尺寸、剪点预开、冷页首播均未收口；没有导出选项行。播放/倒拖与普通视频对照、真实缓存命中率、抢占P95、冷页前三秒、导出提速仍无验收数据。

### 验证、审查与约束

- 按 testing.md 的L2共享公共契约、异步生命周期及跨层消费风险验证；没有升级全仓/L3。
- `node scripts/video-decoder-ffmpeg.cjs test` 最终 **72通过、0失败、1忽略**（既有显式reuse_measurement基准）；`build`通过。新增CUDA ABI与硬件路径边界、会话并发/panic收口测试。
- 显式13文件的 `verify:changed -- --level L2` 通过：4份精确测试（client、texture-bridge、preload video-frames-api、renderer videoDecoder）**54通过**，ESLint、渲染层类型、IPC440请求/7消息端口/40订阅通过。随后增加的Rust工作线程/streams改动由最终72项原生测试和真实开关专项覆盖，TS证据按同代码复用。
- 首轮渲染层tsc因Node默认4GB堆OOM退出134；只对重跑进程设置NODE_OPTIONS=--max-old-space-size=8192后通过，未改项目配置。证据`.tmp-native-l2-final.log`。
- Electron工程noEmit类型检查通过；探针TS及preload以strict、ES2022、node/electron/@webgpu/types单独类型检查通过；scripts ESLint、node --check及git diff --check通过。
- 按用户明确要求：`check:persistence-compat`通过（65格式）；`check:assistant-capabilities`通过（结构+覆盖15测试+不变量31文件237测试）。未改持久格式与能力登记，门禁通过不能证明未实现的缓存功能。
- 最终GPU/FFmpeg两档正式消费均退出0，20次生命周期及原有格式专项退出0；本票既有probe通过仓库electronLaunch创建隔离窗口、直接打包最新reader/正式桥，未启动业务开发版或把旧out当新代码。

独立审查3轮：首轮1项重要问题（严格硬解判断误伤普通HEVC444的auto回退）已修；第二轮与第三轮（常驻任务、并发和资源归还）增量审查无新增问题。实际检查共享硬件格式协商、CUDA ABI/生命周期、HLSL与预算、原生取帧/纹理桥/renderer释放及原有格式消费；没有将未实施的缓存调用方算作已检查通过。

node_modules仍为联接点，未install/ci/uninstall，package/Cargo依赖与锁文件未改。首次构建网络下载很慢，停止本次下载进程后，只读复制主工作区已校验的固定FFmpeg包到本任务目录，仍由既有video-decoder-ffmpeg脚本构建；没有写主工作区原生目录。未控制9334、未读写D:/视频制作工程、未启动真实资料应用。一次调度失误：首轮L2的tsc仍待退出时启动了原生复验，短暂重叠；发现后其余重任务均等待前一项退出再执行。

### 下一步

底座阻塞已解除，本轮按可独立验证的硬解链阶段交付，**没有触发“两条路线均失败”的停止条件，也不再需要重做色度路线裁定**。后续直接以review.md为准：能力实探门禁→持久段/变体键与相位→主进程信任、可靠帧与批次校验→同变体解码与段族回收→补录/抢占/锁/多槽一致性→精度全消费方→03遗留→导出一行与完整功能验收。当前尚不能交付可用的网页时间缓存，不能合并或按整票完成。

一手依据：[Microsoft SDK的HEVC444 GUID](https://raw.githubusercontent.com/microsoft/win32metadata/main/generation/WinSDK/RecompiledIdlHeaders/um/dxva.h)、[固定FFmpeg的D3D11档案表](https://raw.githubusercontent.com/FFmpeg/FFmpeg/2a571b6068/libavcodec/dxva2.c)、[NVIDIA CUDA/D3D11互操作契约](https://docs.nvidia.com/cuda/cuda-driver-api/cuda_driver_api/group__CUDA__D3D11.html)。ABI同时核对本机固定FFmpeg包的hwcontext_cuda.h及本机NVIDIA cuda.h/cudaD3D11.h，不用能力表代替实测。


## 续作：相位网格、正式分段编码校验与占位生命周期（2026-11-01）

摘要：从干净 HEAD `b2f86ec8d` 继续，新增相位网格和码流校验，正式 FrameEncoder 接入无损444；修复文件哈希复用漏洞及网页/普通视频占位的尺寸与释放。
摘要：**整票未完成**。生产能力门禁、可信可靠帧发布、补录调度、共享段解码、精度传播、useWebCache 与整体验收仍未接通；本轮不能按19条完成验收。
摘要：只在 `task/14-网页页面时间缓存` 本地提交，不切分支、不合并、不 push；提交号见本分支 git log 与本轮回复。

### 已实现与边界

- `src/core/videoEdit/webTimeCache.ts`：有理帧率归一、BigInt 相位、绝对帧号推导时间；精确请求只命中网格，预览可取不晚于请求的帧。每段 N=round(2F)，已知时长裁掉端点，未知时长只产生被请求的段。复用既有 time.ts 的分数转换；没有另造时间库。**尚未接入生产变体键与缓存查找。**
- `FrameEncoder` 正式支持有理帧率、yuv444p rawvideo→HEVC444无损，编码参数收口到 `video/hwaccel.ts`。BT.709 limited、sRGB传递标记，无B帧、无lookahead、半秒IDR；奇数尺寸向右/下补齐，显式MP4封装允许暂存名 .tmp。444逐帧连续提交，拒绝缺帧、复制补帧、finish延长或截短。原BGRA/NV12重演的静帧语义保留。
- 修复共享编码管道在EPIPE时只等待drain导致悬挂的问题：逐次写回调交付失败；提前观察子进程退出；启动中取消阻止迟到spawn，串行写入，finish拒绝未完成的写入。检查了现有重演调用方与探针，未复制另一套生产编码器。
- `web-source/segmentValidation.ts`：流式读取ffprobe和FFmpeg trace_headers，核对逐帧本地PTS/DTS、帧数、尺寸/色彩、参数集、首帧真实IDR、半秒IDR及SPS DPB容量。复用成熟FFmpeg解析器，没有手写HEVC解析器；这是**码流校验**，不代表页面可靠性、硬解能力门禁或发布事务。
- `site.ts/content.ts`：去除只按size/mtime复用文件SHA的进程表；保持尺寸和修改时间改写文件也会重新读字节。测试覆盖同元数据改写、增删。**尚未实现批次开始/发布前清单、Worker哈希和失效事务**，不能将该修复算成条16全部完成。
- 占位按GPU设备和物理尺寸共用纹理，网页元数据保留，作者输入读到实际需求尺寸；不计入本帧必需输入预算。引用归还后等待GPU提交完成再释放，网页和普通视频路径统一登记根帧释放集合，迟到结果立即归还。检查共享合成器、网页输入、普通视频首帧之前、取消与关闭。真实GPU专项证明同设备共享、一个合成器关闭后另一引用仍可绘制且输出透明；**未完成真实Electron中Canvas2D/layers/WebGPU全部作者路径矩阵**。
- 本轮未改.tsx、UI、导出schema、持久格式、助手能力登记或正式IPC；useWebCache选项行尚未实施。生产缓存日志待随发布/调度链路实现，现有探针证据不充作业务日志。

### 真机 GPU / FFmpeg 证据

环境为既有 RTX4090 / 驱动610.47 / Electron44.9.3 / Chromium152 / 随包FFmpeg；GPU非独占。使用本票既有隔离探针，直接打包最新入口/reader/正式编码器；未连接9334，未以旧out作验证依据。本轮未改原生Rust或FFmpeg依赖。

1. `node scripts/probe-web-time-cache.cjs native/video-decoder/target/release/ffmpeg.exe` 退出0，状态 `candidate-probes-complete`。证据 `.artifacts/web-time-cache/2026-10-31T17-06-20-288Z/evidence.json`，日志 `.tmp-web-cache-production-encoder.log`。qp0吞吐已走正式FrameEncoder，两个尺寸均得到硬解YUV与输入逐字节相同。

| 尺寸 | 读回+正式编码吞吐 | 码率 / 外推每分钟 | RGB PSNR / SSIM | 捕获与读回 P50/P95 |
| --- | --- | --- | --- | --- |
| 2560×1440 | 13.16 fps | 49.54 Mbps / 371.54 MB | 50.252887 dB / 0.999598 | 64.31 / 83.49 ms |
| 3840×2160 | 5.46 fps | 107.11 Mbps / 803.32 MB | 50.199880 dB / 0.999613 | 158.02 / 202.69 ms |

上述为compositor夹具，不是html-in-canvas可靠帧，也不是节目监视器播放或屏幕呈现性能。吞吐低于上轮，在GPU非独占条件下不作退化归因。126帧（含6帧预热）的PTS/IDR均通过；同次1440p正式共享纹理消费PSNR 50.245394 / SSIM 0.999599，前后跳转回首帧字节相同、相邻帧不同。该证据中的旧字段 `referenceFrames:5` 实际读取的是SPS **DPB容量**，后续字段已正名为 `decodedPictureBufferSize`，不能将5冒充实际参考帧数或据此完成表面预算收缩。

2. `node scripts/probe-web-time-cache.cjs native/video-decoder/target/release/ffmpeg.exe --segments-only` 退出0，状态 `segment-contracts-passed`。证据 `.artifacts/web-time-cache/2026-10-31T17-11-02-157Z/evidence.json`，日志 `.tmp-web-cache-segments.log`。
   - 257×259有效矩形→258×260编码；裁掉补边后，强制CUDA解码的全部帧与输入YUV SHA一致。
   - 60fps、相位617/500000秒：整段120帧，IDR 0/30/60/90；末段3帧。
   - 30000/1001fps、相位1/1500000秒：整段60帧，IDR 0/15/30/45；末段3帧。
   - 四段均通过码流契约，故意传错预期帧数均拒绝；每段DPB容量5。未将独立文件解码计为“同变体共享解码会话”。

### 19条实际状态与03遗留

| 条目 | 本轮后状态 |
| --- | --- |
| 1 读回+既有编码链 | 正式FrameEncoder已接444并实测；生产网页录制服务未接，Mac按裁定不启用 |
| 2 色度与能力 | 本机候选硬编/硬解/消费证据通过；运行时能力实探门禁未接 |
| 3 相位网格 | 核心算法、段边界及实码流专项通过；变体键/查找尚未接 |
| 4 同变体共享解码 | 未实施；DPB容量不等于实际参考帧数 |
| 5 外来确认 | 缓存登记未实施，探针仅本机自造夹具 |
| 6 确定性/网络/字体/分区 | 缓存链未实施 |
| 7 可靠帧发布 | 未实施 |
| 8 显式精度 | 未实施 |
| 9 1440p优先调度 | 未实施 |
| 10 抢占保留/导出顺手缓存 | 未实施；编码器取消收口不等于抢占保留会话 |
| 11 跨实例内核锁 | 未实施 |
| 12 资源不足退槽 | 未实施 |
| 13 向前重演/守护区 | 正式网页录制链未实施；编码器已拒绝补重复帧 |
| 14 离散倍率迟滞 | 未实施 |
| 15 同尺寸共享占位 | 实现、精确测试和真实GPU局部验证通过；完整作者路径矩阵未验收 |
| 16 批次哈希 | 已修size/mtime复用漏洞；批次清单和发布前校验未实施 |
| 17 段族回收 | 未实施 |
| 18 多槽交叠 | 未实施 |
| 19 provenance兼容 | 未实施，旧持久格式未改 |

ticket03：占位尺寸及生命周期已有上述实现/局部证据；完整取帧流水线、屏幕倍率、剪点预开、冷页首播仍未收口。

| 用户要求的整体验收数据 | 当前证据 |
| --- | --- |
| 播放/来回拖动流畅度 | 未测：生产缓存消费未接，底层取帧不能替代 |
| 缓存命中率 | 未测：缓存查找未接 |
| 补录进度 | 未测：补录调度未接 |
| 回退原因分布 | 未测：生产缓存回退与日志未接 |
| 导出网页段每帧耗时 | 未测：useWebCache未接 |
| 冷页首播丢帧 | 未测：冷页首播遗留未收口 |

### 验证、审查和下一步

本次按 testing.md 的L2共享时间契约、文件I/O、异步取消和GPU资源生命周期风险验证。最终门禁结果在本节末追加，未运行全仓/L3。
独立审查共3轮：重要问题为占位历史尺寸累积，以及同源的普通视频占位未归还；均已修复，第三轮增量审查无新增问题。审查后最终测试发现夹具所有纹理共用销毁spy，修为每纹理独立计数，原35项精确测试通过；未因此放松释放断言。未实施的生产缓存消费者不算已检查。

下一步依次完成：生产硬编/硬解/共享纹理实探门禁；可信来源登记、可靠快照与批次发布；命名互斥体、抢占保留和多槽交叠调度；段共用解码、读取回退与段族回收；精度/provenance全消费方传播、03遗留和导出一行；最后跑实际播放/拖动/冷页/导出指标与日志核查。**没有触发硬件路线停止条件，但本轮只形成以上阶段成果，尚不能交付可用的网页时间缓存。**

node_modules与FFmpeg联接点未删除或替换，未install/ci/uninstall，依赖和锁文件未改；未控制9334、未启动真实资料实例、未访问D:/视频制作工程。外部写入仅本ticket的result.md；本轮重任务串行调度。


最终验证结果（均对应本轮代码）：

- 显式17文件 `npm run verify:changed -- --level L2 <本次文件...>` 全部通过，8文件203测试（含11项真实GPU）、改动ESLint、渲染层及Electron类型、依赖图、主进程传递导入。完整显式文件清单与命令在 `.tmp-web-cache-final-l2-pass.log`。仅给本次进程设置8GB Node堆，未改项目配置。
- 失败记录保留：`.tmp-web-cache-final-l2.log` 的占位测试夹具失败，修复后35项精确复跑通过（`.tmp-web-cache-placeholder-final.log`），随后完整L2通过。GPU输出的格式不匹配日志来自已有故障注入用例“原生滤镜格式不匹配只写设备日志，按 target.format 修正后恢复”；新增占位GPU用例单跑通过且无该错误，没有跳过或降低阈值。
- `npm run check:persistence-compat` 通过，65种格式（`.tmp-web-cache-final-persistence.log`）。
- `npm run check:assistant-capabilities` 通过：结构门禁、覆盖15测试、不变量31文件237测试（`.tmp-web-cache-final-capabilities.log`）。未改格式/能力登记，不能据此声称缓存接口已经落地。
- `node scripts/video-decoder-ffmpeg.cjs test` 通过：72通过、0失败、1忽略（既有显式reuse_measurement基准；`.tmp-web-cache-final-native.log`）。本轮没有改Rust，无需重建原生二进制；GPU/FFmpeg专项见上文。
- 探针独立strict类型与ESLint通过，CJS `node --check`、`git diff --check`通过。首次独立tsc漏带JSON开关及现有模块声明，报解析错误；按Electron工程的 `--resolveJsonModule` 并纳入 `electron/types/es-module-lexer.d.ts` 后通过，未修改源码或放宽strict。最终命令：`node node_modules/typescript/bin/tsc --noEmit --target ES2022 --module commonjs --moduleResolution node --lib ES2022,DOM --types node,electron,@webgpu/types --resolveJsonModule --skipLibCheck --esModuleInterop --strict scripts/lib/webTimeCacheProbe.ts electron/types/es-module-lexer.d.ts`。日志 `.tmp-web-cache-final-probe-types-pass.log`、`.tmp-web-cache-final-probe-lint.log`。
- 自身隔离探针已退出，未遗留本轮探针Electron/FFmpeg进程。阶段代码与本记录纳入同一本地提交；临时日志/媒体/截图留在被忽略的证据目录，不提交。

## 续作：硬件能力门禁服务与共享纹理多桥生命周期（2026-11-01）

摘要：从干净 HEAD `06bf583b8` 继续，实现按需 HEVC444 硬编、原生硬解和 Chromium/WebGPU 共享纹理消费的能力门禁服务。
摘要：**整票未完成**。本轮门禁服务尚待补录调度接入，不能把独立专项通过等同于缓存已在播放/导出启用；可靠发布、调度、共享段解码、精度传播等仍待完成。
摘要：仅在 `task/14-网页页面时间缓存` 本地提交；不切分支、不合并、不 push，未控制 9334。

### 本轮实现与实际边界

- `web-source/capability.ts`：正式 FrameEncoder 编码三幅不同的 256×256 YUV444 平面；正式段校验检查 HEVC444/色彩/帧数；正式 VideoDecoderService/VideoFrameBridge 硬解并经现有 GPU reader 消费，逐像素检查通道与帧身份，并检查 0→1→2→0 倒跳。软解不允许通过，macOS 按裁定不启用。小幅实探证明设备链路可用，不代替上一轮 1440p/4K 彩字画质证据或未来各档位的会话创建检查。
- `getWebCacheCapabilityGate()` 为主进程按需唯一入口，不在开页或启动时自动抢占 GPU。当前没有生产补录消费者，所以条 2 只能记“服务已实现、专项已验证、调度接入待完成”。
- 同一门禁合并并发检查；成功只在当前 GPU 代次复用；GPU 信息变化、GPU 子进程退出与原生解码进程退出使结果失效；在途探测跨代次后不发布迟到成功。失败冷却 30 秒后允许重试，不把 NVENC 会话不足永久登记为不支持。
- GPU reader 新增已导入纹理的读回入口，仍用现有 reader 窗口/消息/转换实现；修复导入失败时离屏纹理未归还，以及发送失败时等待表未清理。没有另建传输或业务日志通道。
- 多桥共用原生服务的流号改为服务级分配；不属于本桥的帧事件直接忽略，防止提前 release_frame 覆写另一消费者仍在使用的槽位。已移出登记表但仍在关流的请求纳入 dispose 屏障，防止失败收尾时抢先删掉被解码器占用的样本。
- 业务日志接入 `main.web_source` 的 `web_source.capability.start/completed/failed`。尚没有录制、命中率、补录进度或回退分布的业务链路，不能将实探日志充作这些证据。
- 技术选择复用现有 FFmpeg、原生硬解、纹理桥与 reader；没有引入依赖、复制编解码器或自建 GPU 传输。生命周期核对 [Electron sharedTexture 官方契约](https://www.electronjs.org/docs/latest/api/shared-texture) 与 [GPU 信息及进程事件](https://www.electronjs.org/docs/latest/api/app)。

### 19 条与 ticket 03 状态

本轮仅推进条 2 的能力门禁服务、条 12 的实探临时失败重试，并修复其共享纹理调用链。条 12 的调度退槽尚未实施。
条 1/3/15/16 保持上一节边界（编码/相位算法/占位已有，生产录制及批次事务未接）；条 4–11、13–14、17–19 的生产缓存实现仍未完成，不能据本轮标为落实。
03 的完整取帧流水线、屏幕倍率迟滞、硬剪点预开、冷页首播未完成；占位仍只有上一节的局部证据，本轮没有新增完整作者路径矩阵。
useWebCache 未实施，导出界面未改，候选文案继续沿用 design.md 等待 Claude 把关。

| 整体验收指标 | 本轮结果 |
| --- | --- |
| 播放/来回拖动流畅度 | 未测，生产缓存消费未接 |
| 命中率 | 未测，缓存查找未接 |
| 补录进度 | 未测，调度未接 |
| 回退原因分布 | 未测，只有能力实探失败原因日志 |
| 导出网页段每帧耗时 | 未测，useWebCache 未接 |
| 冷页首播丢帧 | 未测，冷页预热未收口 |

### 审查、验证与下一步

独立审查两轮：首轮重要问题为跨桥提前归还纹理槽位，另有失败清理漏等关流问题；均已修复，第二轮增量审查无新增问题。实际排查多桥共享服务、开流早到帧、发送失败、关闭/迟到释放、reader 导入/发送失败及设备代次切换；没有把未实施的缓存消费者算作验收通过。
本轮按 testing.md L2 的跨消费者、异步生命周期、资源释放及文件 I/O 风险验证；硬件结论另用现有隔离 Electron/FFmpeg 专项，用户指定的原生、持久兼容和助手能力门禁串行补验。最终命令与证据在本节末追加。

失败记录：初次自动 related 解析超过工具 45 秒预算，改用显式 4 份直接消费者测试；首次 L2 的 Vitest mock 类型使用了新版本泛型写法，与仓库 Vitest 1 不符，已改为从实现函数推导类型。多桥新增测试最初暴露假服务只存单个 listener，已按正式服务的多订阅语义改为 Set，没有删减并发断言。

下一步仍按 review.md：将门禁接入生产补录登记，完成主进程信任、环境签名和可靠快照/守护区；批次清单校验与原子发布；命名互斥体、保留会话抢占、退槽与交叠校验；共享段解码与段族回收；精度/provenance 全消费者、03 遗留及导出一行；最后做表中整体真机指标。本轮没有触发硬件路线停止条件，只形成以上可独立验证的阶段成果，**尚不能交付可用的网页时间缓存**。

node_modules 与 FFmpeg 联接点未删除或替换，未 install/ci/uninstall，依赖与锁文件未改；未操作 D:/视频制作 工程；未启动真实资料实例；本轮自身重任务串行，隔离探针按最新源码打包，不使用旧 out 冒充当前代码。外部写入仅本 ticket 的 result.md。

本轮最终证据：

- `npm run verify:changed -- --level L2` 显式 9 文件、4 份直接消费者测试通过：31 测试、ESLint、Electron 增量类型、依赖图、主进程传递导入、IPC（440 请求/7 消息端口/40 订阅）。完整文件/测试参数在 `.tmp-t14-capability-l2-pass.log` 首行。仅给该次 Node 进程设置 8GB 堆；不涉及渲染层/core 改动，未无故追加渲染层全量类型检查。
- `node scripts/probe-web-time-cache.cjs native/video-decoder/target/release/ffmpeg.exe --capability-only` 最终退出 0，`production-capability-passed`；证据 `.artifacts/web-time-cache/2026-10-31T17-43-20-146Z/evidence.json`，日志 `.tmp-t14-capability-gpu-final.log`。RTX4090/驱动32.0.16.1047（610.47）、Electron44.9.3/Chromium152.0.7977.167；256×256@30、三幅不同彩色平面、4 次取帧含倒跳、全部像素通道误差≤2码值。正式门禁耗时 1724.88ms，硬解路径 cuda_planar，导入/发送/解码错误均0，最终 streams=[]、hardwareSessions=0、vramReservedBytes=0。
- 此次硬件专项同时保留另一套业务纹理桥监听同一原生服务；不会替实探提前归还纹理。关流日志采样时仍有1个异步归还引用，不能报告“所有引用在关流前已归零”；最终原生会话/预算归零，随后服务与隔离Electron正常退出，未遗留本轮进程。小幅取帧 P50/P95 不是播放/屏幕呈现性能，未据此填补整体指标。
- 首次实探证据 `.artifacts/web-time-cache/2026-10-31T17-35-05-683Z/evidence.json`，约2121ms；最终版修正关流屏障并加入第二套桥后复验，以上只以最终版作为通过依据。专项通过注入 logger 收集结构化事件；本轮未做正式应用日志查询回读，不能声称业务日志整体验收已完成。
- `node scripts/video-decoder-ffmpeg.cjs test` 退出0：72通过、0失败、1忽略（既有显式reuse_measurement基准）；`.tmp-t14-capability-native.log`。未改Rust或二进制，无需重建原生服务。
- `npm run check:persistence-compat` 退出0：65格式；`.tmp-t14-capability-persistence.log`。
- `npm run check:assistant-capabilities` 退出0：结构门禁、覆盖15测试、不变量31文件237测试；`.tmp-t14-capability-assistant.log`。本轮未改变业务能力或持久schema。
- 探针 strict 类型检查通过：`node node_modules/typescript/bin/tsc --noEmit --target ES2022 --module commonjs --moduleResolution node --lib ES2022,DOM --types node,electron,@webgpu/types --resolveJsonModule --skipLibCheck --esModuleInterop --strict scripts/lib/webTimeCacheProbe.ts electron/types/es-module-lexer.d.ts`；`.tmp-t14-capability-probe-types.log`。CJS语法及 `git diff --check` 通过。
- 代码和本节记录纳入同一本地提交；临时日志/媒体均在忽略目录，不提交。主工作区仅同步追加本 ticket/result.md；任务分支内也保存相同记录。提交号见本轮最终回复与 git log。

## 续作：可靠像素身份与整段原子发布（2026-11-01）

摘要：从 `58ce671f7` 继续，完成可靠快照入口、像素守护区、批次字节清单和带能力门禁的段发布服务；可靠快照已独立提交 `e11529af5`，段发布另作本地提交。
摘要：**整票未完成，生产播放/导出尚未使用网页时间缓存。** 本轮完成的是可靠发布底座；补录调度、跨实例互斥、环境/信任登记和缓存消费者仍未接通，不能按19条全部落实验收。
摘要：仅任务分支提交，不切分支、不合并、不 push；隔离实例使用最新源码，未控制9334，重任务串行。

### 实现、选择与边界

- `WebSourcePage.captureReliable` 只接受已就绪的 html-in-canvas 快照，录制页禁止普通 compositor 取帧；时间必须前进，失败后页面失效，后续由调度从段首重演。关闭、重载、设备丢失撤销该代快照的发布资格。`isCurrent` 用于同步检查，`validate` 在提交前再查页面 GPU 设备状态；异步设备丢失以实际 lost 事件为准。
- 每次帧身份由随机值、streamId、来源字节哈希、时间、请求票据共同生成，32个十六进制位写成左上角8×4灰阶像素。快照端先保存原8×4像素，再在**同一输出纹理**写身份；reader先回读守护区，逐像素误差≤2且alpha有效才继续读整帧。恢复原8×4像素后才做既有GPU YUV444转换，不把标记烙进编码内容。保存与校验各读回1024字节（4行×256字节对齐）；不到8×4的录制尺寸暂不支持，实时路径照旧。
- 守护区曾试放内容外边距，但真实 Chromium OSR layout 裁剪使该方案无法验证，已彻底移除。最终方案保留可见角落原像素，专项用红蓝角落验证恢复；不是画面外边距方案。核对了 [Chrome HTML in canvas](https://developer.chrome.com/blog/html-in-canvas-ot-changes) 与 [Electron sharedTexture](https://www.electronjs.org/docs/latest/api/shared-texture) 官方契约。
- 共享 GPU reader 现在串行处理取帧；交付的像素缓冲独立持有，防止下一帧覆盖已交付帧。复用现有 reader、FrameEncoder、FFmpeg、段验证器和日志，不引入依赖或复制编解码路径。
- `WebSourceBatch` 在散列前监视来源目录；Worker 流式计算完整文件路径、大小、SHA与目录身份，不复制网页文件夹。发布前重算清单；改写后恢复原字节仍使批次失效。实时来源哈希复用同一Worker实现，保持内容哈希算法一致。
- 变体键纳入来源、裁切、倍率、DPR、带相位网格、环境签名、Chromium及捕获/编码契约。发布入口先过硬件能力门禁，拒绝时不求值帧生产者；逐帧检查时间、顺序、尺寸、来源及当前代次，缺帧不补重复帧。完整编码、正式码流校验、几何写入、SHA、来源/环境/页面复核后，临时目录整体 rename 发布。
- 发布时计算视频和几何SHA；读入口只核清单和文件尺寸。损坏旧段允许在段写锁内重建。编码背压时取消会触发 abort，所有清理等待同一个退出屏障；生产者收尾失败或收尾期间取消均回滚本次已发布段。
- `withSegmentLock` 是发布入口的**必需注入契约**，没有默认进程内锁冒充跨实例锁；本轮探针/单测单实例直接执行回调。命名互斥体实现、跨实例争用与进程异常退出验证**尚未完成**。环境检查同样为必需回调，但生产信任范围、系统字体、存储分区、全协议站外请求监测仍待调度登记实现；探针只使用本机自造无外网夹具。
- 新缓存清单属于可重建派生数据，已登记 persistence exclusion；没有改变用户工程格式。`main.web_source` 增加 record.start/progress/completed/failed，使用正式日志写入/查询，无新日志通道。尚没有生产命中率、补录进度与回退分布的完整日志。

### 真机证据与数据

设备沿用本机 RTX4090 / 驱动610.47，Electron44.9.3 / Chromium152.0.7977.167。全部使用隔离资料目录与自造网页，未使用用户工程。快照专项证据 `.artifacts/web-time-cache/2026-10-31T18-03-53-406Z/evidence.json`，命令 `node scripts/probe-web-time-cache.cjs native/video-decoder/target/release/ffmpeg.exe --snapshots-only`，日志 `.tmp-t14-reliable-gpu-pass.log`。

48帧的黑白交替主体与红蓝8×4角落通过三平面逐像素校验（误差≤1），48个身份均不同；257×259故意错身份在整帧读回前拒绝（pixelsMs=0）；1440p/4K主动等待 `device.lost` 后确认发布资格失效；关闭页面亦撤销资格。

| 快照尺寸 | 帧数 | 首帧取帧ms | 后续取帧P50/P95 ms | 守护区P50/P95 ms | 整帧读回P50/P95 ms |
| --- | --- | --- | --- | --- | --- |
| 257×259 | 24 | 233.68 | 17.28 / 20.17 | 1.50 / 1.90 | 0.90 / 1.10 |
| 2560×1440 | 12 | 345.86 | 113.31 / 131.68 | 1.90 / 9.00 | 9.60 / 10.80 |
| 3840×2160 | 12 | 488.84 | 210.22 / 300.08 | 4.60 / 14.20 | 19.50 / 21.40 |

后续分位数分别为23/11/11个样本，不含各尺寸首帧；这里只量可靠录制取帧，不包含编码，也不是节目监视器呈现、拖动、冷页首播或导出性能。该专项加入身份/角落及设备失效检查，不能与以前 compositor 吞吐直接解释成同场景性能变化。

最新段发布专项：`node scripts/probe-web-time-cache.cjs native/video-decoder/target/release/ffmpeg.exe --publication-only` 退出0，日志 `.tmp-t14-publication-gpu-final.log`，证据 `.artifacts/web-time-cache/2026-10-31T18-20-48-103Z/evidence.json`，状态 `reliable-publication-passed`。

- 257×259输入、258×260编码，60fps网格连续3帧；强制CUDA硬解并裁回原尺寸，全部YUV平面与录制输入SHA逐字节相同，视频2536字节、几何92字节。
- 成功段发布5005ms，其中首次硬件门禁2732ms；包含开页、门禁、编码与发布校验，**不能除以3充作稳定导出每帧耗时**。
- 另一变体在第3帧修改来源，1410ms拒绝；最终目录只剩成功段，无临时族。通过正式 `queryLogEvents` 读回 start/progress/completed/failed，corruptedLines=0；失败警告为本专项故障注入的预期结果。
- 完成时 streams=[]、hardwareSessions=0、vramReservedBytes=0，随后服务与隔离Electron退出。没有测跨实例锁、多槽交叠、实际调度抢占或共享段解码，不能把这次结果扩写为这些结论。

### 审查与验证范围

可靠快照独立审查1轮：重要问题“后帧覆盖已交付像素缓冲”已修复并补测试。段发布独立审查3轮：损坏旧段永久阻挡重建、背压取消未传递、重复abort未等待同一次退出均已修复；同时修复生产者收尾异常/取消的回滚，第三轮未发现新增问题。主代理检查了实时来源哈希共用入口、reader交付/并发、页面重载/关闭/设备失效、段缺帧/错序、坏段重建和编码退出；未实施的调度和缓存消费者不计入已检查范围。

按 testing.md L2 的共享契约、文件I/O、取消/异步生命周期验证；硬件部分使用既有隔离专项，另外按用户本轮明确要求跑原生、持久兼容和助手能力门禁。没有升级全仓/L3或完整应用构建。

- 可靠快照显式8文件L2通过：4文件24测试、改动ESLint、Electron类型、依赖图、主进程导入、IPC440/7/40；`.tmp-t14-reliable-l2-pass.log`。
- 段发布最终显式10文件L2通过：6文件272测试（含249持久格式测试）、改动ESLint、渲染层/Electron类型、依赖图、主进程导入984文件、65格式基线；`.tmp-t14-publication-l2-pass.log` 首行保存完整文件与测试参数。
- 探针strict类型通过：`node node_modules/typescript/bin/tsc --noEmit --target ES2022 --module commonjs --moduleResolution node --lib ES2022,DOM --types node,electron,@webgpu/types --resolveJsonModule --skipLibCheck --esModuleInterop --strict scripts/lib/webTimeCacheProbe.ts electron/types/es-module-lexer.d.ts`；`.tmp-t14-publication-probe-types.log`。CJS语法、`git diff --check`通过。
- 失败记录保留：可靠快照第一次测试夹具的 OffscreenSharedTexture 类型断言不匹配，修正夹具后通过；GPU设备丢失检查最初未等 lost 事件，修正探针后通过；段发布最终L2先因故障注入夹具在finally直接throw触发lint，改为await拒绝后完整复跑通过。没有降低像素、完整性或释放断言。

### 19条与剩余工作

本轮推进条1的生产录制/发布服务、条2发布门禁、条3相位变体键/段契约、条7可靠帧、条13守护区与缺帧拒绝、条16批次清单，以及条17发布SHA/读取尺寸检查。以上仍需调度与消费接入才能成为完整产品功能。条13自动从段首重演、条17段族统一回收尚未实现。

条4共享解码、条5外来确认登记、条6确定性环境、条8显式精度、条9预览优先、条10保留会话抢占/导出顺手缓存、条11内核互斥、条12调度退槽、条14离散倍率迟滞、条18交叠比对、条19provenance兼容均未完成。条15保持此前占位局部实现/证据，未新增完整作者矩阵。03完整取帧流水线、屏幕倍率、剪点预开、冷页首播仍未完成；useWebCache未接，UI未改，导出文案沿用上文待Claude把关。

| 整体验收指标 | 本轮结果 |
| --- | --- |
| 播放/来回拖动流畅度 | 未测，生产缓存消费未接 |
| 命中率 | 未测，正式缓存查找未接 |
| 补录进度 | 未测，只有段发布进度事件，调度未接 |
| 回退原因分布 | 未测，仅隔离故障注入验证来源失效原因 |
| 导出网页段每帧耗时 | 未测，useWebCache未接 |
| 冷页首播丢帧 | 未测，冷页预热未收口 |

下一步按用户顺序：先完成补录登记/调度（信任与环境、能力门禁、命名互斥体、抢占保留、退槽、1440p优先及多槽交叠）；再接同变体共享段解码与回退/段族回收；显式精度传播；03遗留；导出useWebCache；最后补完整业务日志与表中整体验收。当前没有硬件路线阻塞，但尚不能交付可用的网页时间缓存。

本轮未更改依赖/锁文件，未删除或替换node_modules/FFmpeg联接点，未install/ci/uninstall；未操作D:/视频制作，未启动真实资料实例。外部写入仅本ticket/result.md；临时日志、媒体与探针产物留在忽略目录。

本轮最终追加门禁全部退出0：`node scripts/video-decoder-ffmpeg.cjs test` 为72通过、0失败、1忽略（既有显式reuse_measurement基准），`.tmp-t14-publication-native.log`；`npm run check:persistence-compat` 为65格式，`.tmp-t14-publication-persistence.log`；`npm run check:assistant-capabilities` 为结构检查、覆盖15测试、不变量31文件237测试，`.tmp-t14-publication-assistant.log`。本轮无Rust修改，不重建原生服务。最终隔离发布探针已退出，无该探针遗留进程。结果记录同步追加到主工作区的本ticket目录；代码与记录均留在任务分支本地提交，不push。

## 续作：跨实例段锁与失主发布隔离（2026-11-01）

摘要：从 `3a59f8a04` 继续，完成补录底座中的跨实例段写锁、失主临时族回收及持锁原子发布；本节对应单独的本地提交。
摘要：**整票未完成。** 当前仍没有生产补录队列或播放/导出缓存消费者；本节只落实条11的段写互斥部分，不把它算作跨实例前台活动协调已完成。
摘要：仅 `task/14-网页页面时间缓存` 本地提交；不切分支、不合并、不 push，未控制9334。

### 实现与边界

- 复用既有原生解码服务、Windows crate 和控制通道，未加依赖。按缓存根真实路径、变体和段号计算命名互斥体身份；同线程重复申请仍按业务租约拒绝，避免 Windows 可重入语义放过同实例并发。内核对象随持有进程退出释放，不建立选主或心跳文件。Windows API 依据：[Mutex Objects](https://learn.microsoft.com/en-gb/windows/win32/sync/mutex-objects)、[WaitForSingleObject](https://learn.microsoft.com/en-us/windows/win32/api/synchapi/nf-synchapi-waitforsingleobject)。
- 获取、段族 rename、回滚、失主 `.tmp-*` 枚举/清理都由持锁原生控制线程串行执行；Electron 不能先检查锁、再异步执行可能迟到的目录删除。只有当前 token 能提交或回滚；释放旧 token 不会影响新持有者。
- TypeScript 租约随原生进程退出失效。租约请求只发给当前 ready 进程，不隐式重启；获取回执迟到、超时或取消仍按原 token 清理。提交已执行但回执失败也请求同 token 回滚。
- 发布器继续使用既有 FrameEncoder、能力门禁、批次清单、可靠快照与统一日志；生产发布契约现在必须注入带 prepare/commit/rollback 的真实租约。探针已从单实例直通回调换成正式 WebCacheLocks。
- 暂停录制持有的临时族不会按年龄清理；只有再次拿到对应段锁才清失主目录。不同段临时族保持完整。缓存为可重建派生数据，不更改用户工程格式；内部租约没有新增 UI/Pi/MCP 业务操作或能力。

### 审查与实测

独立审查2轮：首轮发现“提交回执失败漏回滚”“Electron 迟到临时族清理可删除接管者目录”两项重要问题，均修复；第二轮无新增问题。主代理另修了租约请求自动重启的代次间隙。实际核查同段争用、同线程重入、取消/超时、原生异常退出、提交/回滚、坏段重建、失主清理及全部现有发布调用方；尚未存在的后台调度与播放消费者不算已验收。

- `node scripts/probe-web-time-cache.cjs native/video-decoder/target/release/ffmpeg.exe --locks-only` 退出0；证据 `.artifacts/web-time-cache/2026-10-31T18-35-44-428Z/evidence.json`，日志 `.tmp-t14-lock-probe-pass.log`。两个独立原生进程 PID62948/44004，观察100ms争用期间无重入；强制结束本专项持锁进程后，新实例接管、提交并完成后续核查共47.73ms。旧持有者得到 PROCESS_EXITED，接管者文件未被覆盖；回滚和按段失主目录清理通过。此时间是单次故障恢复专项，不是节目抢占P95。
- `--publication-only` 退出0；证据 `.artifacts/web-time-cache/2026-10-31T18-36-21-297Z/evidence.json`，日志 `.tmp-t14-lock-publication-gpu.log`。正式内核锁下发布257×259、60fps网格3帧，258×260编码；CUDA强制硬解裁回后YUV平面SHA与输入逐字节相同。来源改变拒绝发布，正式日志查询读回完成/失败事件；最终streams=[]、hardwareSessions=0、vramReservedBytes=0。
- 硬件沿用RTX4090/驱动610.47，Electron44.9.3/Chromium152.0.7977.167、随包FFmpeg n9.0.2-17-g2a571b6068。重建的是本分支原生程序；使用隔离Electron和自造夹具，没有运行或修改用户工程。

### 验证与剩余工作

本块按 testing.md L2 的跨进程同步、文件I/O、取消/异步生命周期执行；内核锁的进程退出结论升级真实双进程专项，发布链升级既有GPU/FFmpeg专项。未跑全仓/L3或完整应用构建。

- 显式12文件 `npm run verify:changed -- --level L2` 通过，3份直接消费者共30测试，ESLint、Electron类型、依赖图、主进程导入986文件；完整命令在 `.tmp-t14-lock-l2.log`。仅此命令进程设8GB Node堆。
- `node scripts/video-decoder-ffmpeg.cjs test`：74通过、0失败、1忽略（既有显式reuse_measurement基准），`.tmp-t14-lock-native-final.log`；原生release重建通过，`.tmp-t14-lock-native-build-final.log`。
- `npm run check:persistence-compat`：65格式通过，`.tmp-t14-lock-persistence.log`。探针strict类型、ESLint、CJS语法、`git diff --check`通过；`.tmp-t14-lock-probe-types.log`、`.tmp-t14-lock-probe-lint.log`。
- 失败记录保留：Rust首次编译使用了旧windows crate错误构造名，按当前crate API改为from_thread；取消测试不再钉死轮询次数；真实探针首次把正式PROCESS_EXITED误判为中文文案不符，改为核对正式失败码及文件内容后通过。未放松互斥、失主拒绝或像素断言。

19条状态只推进条11的段写锁与条17的失主临时族清理；其余沿上节。本块未完成信任/环境登记、跨实例前台活动协调、抢占保留、退槽、多槽交叠，也未进入共享段解码、精度传播、03遗留及useWebCache。播放/来回拖动流畅度、命中率、补录进度、回退分布、导出网页段每帧耗时、冷页首播丢帧均仍未测；不能以本节锁恢复和可靠发布数据代替。

未更改依赖或锁文件，未install/ci/uninstall，未删除或替换node_modules/FFmpeg联接点；未触碰D:/视频制作、9334或主工作区代码。外部写入仅本ticket/result.md。临时产物/日志均在忽略目录，不提交。
最终助手门禁退出0：`npm run check:assistant-capabilities` 为结构门禁、覆盖15测试、不变量31文件237测试通过，证据 `.tmp-t14-lock-assistant.log`。本节代码和记录纳入同一本地提交；提交号见git log。

## 续作：抢占保留与逐提交取消（2026-11-01）

摘要：接着本次首块提交 `94aa15878`，完成录制页面、编码器和能力实探的协作暂停/恢复底座，按实际提交点控制，不因抢占重开会话。
摘要：**整票仍未完成。** 这是条10的录制机制；生产活动监听、信任/环境登记、调度退槽及多槽交叠尚未接入，不能报告完整后台补录已可用。
摘要：本节与代码单独提交在任务分支，不切分支、不合并、不push；9334仍由Claude调度。

### 实现、自审与修复

- 新增 WebCacheSubmissions，多个抢占来源全部恢复后才继续提交；已提交任务可完成，调用方可等待drained。暂停保留页面、已领取纹理、编码会话、临时段和内核锁；resume之后立即再次hold也不漏交工作。
- 控制落在开窗/载入、viewport、ready、快照准备/初帧、seek、boxes、可靠快照、读回、帧代次复核、编码启动/写帧/结束及能力实探各阶段。超时从真正提交后计时，不把前台暂停时间当设备失效。
- 发布帧生产者现在接收正式租约信号，开页与取帧使用同一取消来源。排队帧可以及时取消等待，但内部串行尾链保持到实际完成，不能让后续seek越过在途取帧；取消尚未开始的队列项不会作废前一幅有效帧。
- 多段共享能力实探时，后来调用者能单独取消等待；发起段取消后，其他段等原实探清理完，再使用自己的控制信号重试。取消不写入硬件失败冷却，也不重叠启动重任务。
- 复用正式main.web_source日志，增加record.preempted/resumed并带暂停时长和提交统计。只有调度内部接口，没有新UI、Pi/MCP业务操作或持久格式。

独立审查3轮：第一轮发现开页/排队取消遗漏，以及把加载/能力实探整体包装导致后续步骤越过抢占，两类重要问题已修复；第二轮发现共享实探混用调用者取消状态，已修复；第三轮无新增问题。核查了首次开页、失败重载、可靠捕获、普通实时捕获共享路径、发布器、能力门禁、正式纹理桥交付及所有现有调用方；未实现的调度消费者不算检查通过。新增测试覆盖异步状态机、共享取消和资源所有权，属于testing.md第三节保留范围。

### 隔离真机与验证

本块按testing.md L2的取消/异步状态流及共享直接消费者验证；暂停期间是否保留GPU链路升级到既有真实GPU/FFmpeg专项。一个重任务，未启动完整业务实例或控制9334。探针由现有electronLaunch入口构建本次源码，独立资料目录；不是使用旧out产物。

- 最终命令：`node scripts/probe-web-time-cache.cjs native/video-decoder/target/release/ffmpeg.exe --preemption-only`，退出0，状态retained-recording-passed。证据 `.artifacts/web-time-cache/2026-10-31T18-56-35-722Z/evidence.json`，日志 `.tmp-t14-preempt-gpu-pass.log`，内含基准HEAD94aa15878与实际bundle SHA。
- 单次自造257×259网页、60fps相位网格、3帧，编码补齐258×260：已领取首帧后暂停301.20ms，新增提交0；drained等待0.225ms，临时族保持且帧仍有效，恢复后正常发布。该数值是空闲提交边界的单样本机制验证，**不是前台抢占P95或性能达标证据**。
- 最终码流强制CUDA硬解并裁回，三帧YUV平面SHA与可靠录制真值逐字节一致。来源变更拒绝发布、失败临时族清理、正式完成/失败/暂停/恢复日志查询均通过。最终streams=[]、hardwareSessions=0、vramReservedBytes=0，专项原生PID42768已随实例结束。
- 环境RTX4090/驱动610.47、Electron44.9.3/Chromium152.0.7977.167、随包FFmpeg n9.0.2-17-g2a571b6068。未操控或统计其他应用GPU负载，不据此宣称前台耗时增幅已达标。macOS与非NVIDIA设备未测，按既定裁定不启用网页缓存。
- 显式11文件L2全部通过：5个精确测试文件共26测试，ESLint、Electron类型、依赖图、主进程导入988文件。完整命令与输出在 `.tmp-t14-preempt-l2.log`；仅该命令进程设8GB Node堆。
- 探针strict独立类型、ESLint、CJS语法、git diff检查通过；日志 `.tmp-t14-preempt-probe-types.log`、`.tmp-t14-preempt-probe-lint.log`。类型命令沿上一节完整参数。
- `check:persistence-compat`再次通过65格式，`.tmp-t14-preempt-persistence.log`。本块无原生修改，复用本次首块74通过/0失败/1既有忽略及release构建证据，未重复重建。
- `check:assistant-capabilities`再次退出0：结构检查、覆盖15测试、不变量31文件237测试，`.tmp-t14-preempt-assistant.log`。
- 首轮重构检查曾因移动辅助函数遗漏闭合括号失败，修复后精确测试和最终L2全部通过；未降画质、正确性或性能门槛。较早GPU结果保留在18-52-41证据目录，最终结论使用18-56-35版本。

### 19条与03遗留的当前边界

| 裁定 | 当前状态 |
| --- | --- |
| 1、2 读回/编码路线与硬件门禁 | 已有正式段发布底座和本机实探；尚未接生产补录 |
| 3 相位网格 | 已有网格、变体键、段契约；尚未接消费者需求 |
| 4 共享段解码 | 未实现 |
| 5、6 信任与环境 | 未实现补录登记；站外请求、字体签名与存储环境复核待接 |
| 7 可靠帧 | 已有身份校验及发布作废；隔离实测通过 |
| 8 显式精度 | 未传播到渲染入口和消费者 |
| 9 预览优先 | 未实现生产调度 |
| 10 抢占与顺手写缓存 | 暂停续录底座完成；生产活动监听、显存回收和导出顺手写尚未接 |
| 11 跨实例协调 | 内核段锁及失主发布隔离完成；跨实例前台活动协调未接 |
| 12 退槽 | 能力失败已有临时冷却；调度降槽/重试未接 |
| 13 缺帧重演 | 守护区、向前取帧与缺帧拒绝已有；自动从段首重演未接 |
| 14 倍率迟滞 | 未实现 |
| 15 占位尺寸 | 沿此前局部实现及证据；完整作者Canvas/layers/GPU矩阵未验收 |
| 16 批次清单 | 已有全字节批次校验及发布前复核 |
| 17 段族管理 | 发布SHA、读取尺寸及失主临时族清理已有；统一容量回收未接 |
| 18 多槽交叠 | 未实现 |
| 19 provenance兼容 | 未实现 |

03五项：完整流水线600帧吞吐、屏幕实际倍率、硬剪点预开、冷页首播均未完成；作者占位尺寸保持此前局部实现，完整矩阵未验收。useWebCache及导出选项行未改；候选文案仍由Claude按前文把关。

| 整体真机指标 | 本次实际结果 |
| --- | --- |
| 播放/来回拖动流畅度、命中率 | 未测，生产读缓存未接 |
| 补录进度、回退原因分布 | 只有隔离3帧推进及来源失效拒绝；正式队列与统计未接 |
| 导出网页段每帧耗时 | 未测，useWebCache未接 |
| 冷页首播丢帧 | 未测，预热与正式冷解码未接 |
| 补录让出P95、前台耗时增幅 | 未测；上述单次暂停数据不替代门槛 |

本次在两块可独立验证/回滚的底座完成边界收尾；未完成原因是生产调度及消费整合尚未实施，不是硬件路线失败，不降低门槛。下一步仍按用户顺序：先完成信任/环境登记、前台及跨实例活动协调、补录队列/退槽/多槽交叠，再共享段解码与回退、显式精度、03其余遗留、useWebCache及整体真机矩阵。

未改依赖、锁文件或界面；未install/ci/uninstall；node_modules与FFmpeg联接点未删改；未触碰D:/视频制作。主工作区仅本ticket/result.md追加同节。日志/媒体/探针产物在忽略目录，未提交。

## 续作：信任作用域与环境登记（2026-11-01）

摘要：从 `19aa425ec` 继续，完成正式开页链路的后台来源登记、一次确认作用域、共用网页分区环境观察、字体字节签名及发布前后环境复核；本节与代码单独提交。
摘要：**整票仍未完成。** 登记机制已接正式网页服务，但生产补录队列、跨实例前台活动协调、退槽和多槽交叠尚未实施，播放/导出尚未使用网页时间缓存。
摘要：仅任务分支本地提交，不切分支、不合并、不 push；未操作9334，所有真机专项为隔离实例，自有重任务串行。

### 本块实现与边界

- `videoEditWebInputs` 沿既有 openWeb 请求传递原文档/代码的外来标记，主进程按既有 ContentTrustSession 的已批准状态登记，后台不调用会产生确认框的 check/assert。缺少来源上下文的旧调用仍可走实时路径，但不登记补录。
- “仅这一次”的**后台补录范围**固定为首次登记的宿主会话对象及该会话内各原网页文件夹的首次内容代次。文件夹用 realpath 识别；来源全字节批次监视持续到宿主结束，关页重开、同尺寸改写、恢复原字节都不能洗掉旧代次失效。宿主导航/渲染进程退出结束旧会话；同一 WebContents ID 的新会话允许本机或全局已允许内容重新登记，但不能继承旧的一次补录许可。实时前台原有确认语义未扩大。
- 正式热更新后重新判定登记资格；窗口关闭、通道关闭、取消登记和异步散列期间关闭不会留下后台许可。全局允许关闭后再按原一次作用域复核。一次许可的失效来源不会由后台再次弹窗或自动批准。
- 把实时页与录制槽原有分区入口收口到 WebSourceSession。该分区唯一的无过滤器 webRequest 监听覆盖所有协议，站外 HTTP/HTTPS/WebSocket/文件等请求记录为不可缓存原因，原请求照常执行；日志不存 URL、Cookie 或存储内容。data/本站 blob 资源仍允许。
- 页面执行前启用 CDP DOMStorage、IndexedDB、CacheStorage 观察，Cookie 由 session 事件观察；写入更换存储代次，代次进入环境签名。观察能力不可用/断线、有 Service Worker 或无法由这些事件证明稳定的存储（例如 OPFS）时回退实时。正常关页与倍率重建先释放观察器，避免把主动销毁误报为环境故障。
- 系统字体复用既有 `fonts/discovery` 目录发现，完整文件字节由现有 Worker 流式散列；目录监视负责提前失效，发布前重新枚举和全字节复核。Windows libuv 同时监听 LAST_ACCESS，真实字体读取会触发 change；仅排除不含 atime 的身份完全不变的访问事件，mtime/ctime/文件身份变化、改写后恢复、增删和监视错误均失效，最终字节复核保留。事件身份检查未结束时立即撤销 current。
- 环境签名包含字体、存储代次、分区、平台/架构、locale/timezone 和 Electron；原变体键仍包含 Chromium、DPR、采样网格与捕获/编码契约。发布器区分轻量当前检查和发布前完整复核，原子提交之后再检查，异步等待结束后统一重读所有状态，失效则走既有持锁回滚。
- 字体快照按需在登记的 environment() 建立，不在应用启动时扫描。**生产队列尚未消费该接口**；本节不宣称字体初始化/复核成本已经满足生产吞吐，也不宣称录制槽与正式需求的全部接线完成。注册源仍由原文档/代码上下文携带，未来缓存消费者必须使用这份原来源身份，不得用缓存视频路径重建信任。
- 新事件为 `web_source.registration.completed/failed/removed`，沿正式 main.web_source 日志；没有新界面、MCP/Pi工具、设置项、持久用户格式或依赖。

### 隔离真机证据

环境专项最终命令：`node scripts/probe-web-time-cache.cjs native/video-decoder/target/release/ffmpeg.exe --environment-only`，退出0；证据 `.artifacts/web-time-cache/2026-10-31T19-23-55-903Z/evidence.json`，日志 `.tmp-t14-registration-environment-logs.log`，状态 environment-registration-passed。

- 真实 Electron44.9.3 / Chromium152.0.7977.167，独立资料目录和自造257×259网页；未运行用户工程。
- 未确认来源拒绝登记，once 确认后登记成功；稳定环境完整复核通过。真实 localStorage、sessionStorage、Cookie、IndexedDB、CacheStorage 修改均改变存储代次，旧环境检查拒绝。
- localhost WebSocket 请求被无过滤器 webRequest 识别为站外依赖；该夹具不依赖外网服务器。宿主销毁后登记信号取消且 current=false。
- 首次系统字体快照耗时 **9852.16ms**，是完整目录枚举、监视与字节散列的单次初始化样本，不是每帧时间、补录吞吐或冷页首播数据。较早无日志回读版本分别为7958.28/8207.23ms，不作性能门槛结论。
- 通过正式 appendLogEvents 写队列屏障和 queryLogEvents 读回 registration.completed/removed，corruptedLines=0。站外原因与环境变动机制已验证，正式缓存 lookup 的回退分布尚未实现。

可靠发布/暂停复验：`node scripts/probe-web-time-cache.cjs native/video-decoder/target/release/ffmpeg.exe --preemption-only`，退出0；证据 `.artifacts/web-time-cache/2026-10-31T19-20-29-804Z/evidence.json`，日志 `.tmp-t14-registration-gpu-final.log`。

- RTX4090，随包FFmpeg n9.0.2-17-g2a571b6068；257×259、60fps网格3帧，编码补齐258×260。暂停 **300.56ms**，期间新增提交 **0**，drained **0.232ms**，临时族和已领取帧保持；恢复后正常发布。
- CUDA强制硬解并裁回后，3帧YUV平面与可靠录制真值SHA逐字节一致；来源变更拒绝发布并清理临时族。发布完成/失败/暂停/恢复日志正式查询通过，最终 streams=[]、hardwareSessions=0、vramReservedBytes=0；原生专项PID34460已退出。
- 这次仍是保留会话的单样本机制复验；发布专项使用已有注入环境回调，环境登记另由前述真实专项验证。**没有把两次分开的专项冒充生产补录整链集成，也没有把该drained样本当成抢占P95。** 本轮未重测1440p/4K画质，沿用既有证据；没有观察其他应用GPU活动。

### 审查、自审与验证

独立审查3轮：首轮3项重要问题（宿主恢复永久不能登记、热更新漏登记、倍率重建误判观察失效）全部修复；第二轮1项重要问题（异步字体检查后未重新检查存储/许可状态）修复并加回归；第三轮未发现新的重要问题。最后只在专项脚本补了正式日志回读断言，实际复跑通过。

实际排查范围：正式网页开页/热更新/关闭与通道释放、宿主导航和渲染恢复、提高/降低倍率、一次许可与全局开关切换、异步登记取消、真实存储/联网事件、字体读取事件与发布前后异步复核。上述发现已修复；精确测试和专项覆盖的其余路径未发现同类缺陷。尚未存在的生产队列、共享缓存解码和导出消费者不计入已审查/已验收范围。

按 testing.md L2 的跨层契约、外来内容边界、文件I/O和异步生命周期验证；真实CDP/session事件与GPU行为无法由单测证明，升级到已有隔离专项。原生、持久兼容与助手能力门禁按本轮用户明确要求运行，没有升级全仓L3或完整应用构建。

- 最终显式17文件 `npm run verify:changed -- --level L2 <本次文件...>` 退出0：8文件41测试、ESLint、渲染层/Electron类型、依赖图、主进程导入995文件、IPC440/7/40；完整文件与测试参数见 `.tmp-t14-registration-l2-final.log`，仅该命令设8GB Node堆。
- `node scripts/video-decoder-ffmpeg.cjs test`：74通过、0失败、1既有显式基准忽略；`.tmp-t14-registration-native.log`。没有原生源码/依赖变更，不重复release重建。
- `npm run check:persistence-compat`：65格式通过；`.tmp-t14-registration-persistence.log`。
- `npm run check:assistant-capabilities`：结构门禁、覆盖15测试、不变量31文件237测试通过；`.tmp-t14-registration-assistant.log`。
- 探针strict类型、独立ESLint、CJS语法与git diff检查通过；`.tmp-t14-registration-probe-types-final.log`、`.tmp-t14-registration-probe-lint.log`。类型命令沿上一节参数，新增入口包含 `scripts/lib/webTimeCacheEnvironmentProbe.ts`。
- 失败记录：首轮单测mock误遮蔽createMainLogger，改为mock真正的协议边界后通过；真实字体快照前两次因只读访问change而失效，依据libuv源码及本机stat证据区分atime后通过。未删测试、未降像素/一致性门槛。
- 官方依据：[Electron webRequest单监听与全协议匹配](https://www.electronjs.org/docs/latest/api/web-request)、[CDP Storage](https://chromedevtools.github.io/devtools-protocol/tot/Storage/)、[CDP DOMStorage](https://chromedevtools.github.io/devtools-protocol/tot/DOMStorage/)、[libuv Windows文件事件订阅](https://raw.githubusercontent.com/libuv/libuv/v1.x/src/win/fs-event.c)。

### 19条、03遗留与下一步

本轮推进条5的正式来源/一次确认作用域登记和条6的存储/站外请求/字体环境签名与失效；仍待生产补录、预热与缓存消费接线，不把整条端到端验收算完成。条1/2/3/7/10/11/13/16/17沿上一节已完成的底座及边界；条4共享段解码、8精度传播、9预览优先、12调度退槽、14倍率迟滞、18多槽交叠、19provenance兼容未完成。条15仍仅此前局部占位实现，完整作者矩阵未验收。

03五项中的完整流水线600帧、屏幕实际倍率、硬剪点预开、冷页首播仍未完成；作者占位尺寸完整矩阵未验收。useWebCache与导出选项行未改，文案继续由Claude把关。

| 整体真机指标 | 当前实际状态 |
| --- | --- |
| 播放/来回拖动流畅度、缓存命中率 | 未测；生产读缓存未接 |
| 补录进度、回退原因分布 | 未测正式队列；只有登记与隔离3帧发布/失效证据 |
| 导出网页段每帧耗时 | 未测；useWebCache未接 |
| 冷页首播丢帧 | 未测；冷页预热和正式冷解码未接 |
| 补录让出P95、前台耗时增幅 | 未测；单次暂停不替代性能矩阵 |

本轮闭环的是信任与环境登记这一块，其余尚未实施，不是硬件路线失败，也没有降低已定门槛。下一步严格沿原顺序：**生产补录调度**（复用watchProgramActivity事实、跨实例前台活动协调、≤1440p需求优先、退槽/重试、缺帧从段首重演、多槽交叠）；再共享段解码与回退/段族回收、显式精度传播、03其余遗留、useWebCache与整体真机矩阵。生产录制必须复用来源的原分区语义，不能仅把规范化批次路径当作新的分区入口。

未改依赖/锁文件/界面，未install/ci/uninstall，node_modules与FFmpeg联接点未删改；未触碰D:/视频制作或主工作区代码，外部只给本ticket/result.md追加同节。日志和专项产物在忽略目录，未纳入提交。

## 续作：前台活动协调与跨实例逐提交额度（2026-11-01）

摘要：从 `71ca0a49d` 继续，完成生产前台活动上报、跨实例 OS 锁协调及后台逐提交额度；本节代码单独在任务分支本地提交。
摘要：**整票仍未完成。** 本块接通生产前台事实，不把它称为生产补录队列：需求优先、调度退槽、多槽交叠、共享段解码及后续消费者尚待实施。
摘要：未切分支、未合并、未 push；未操作9334，重任务串行，实测使用隔离 Electron 与本专项创建的原生进程。

### 本块实现与实际边界

- 复用 `watchProgramActivity` 的节目播放、拖动、跳转、busy 事实，节目空闲3秒后释放；正式预渲染/规划任务存在时也让独立补录等待。所有正式网页开页及取帧在主进程追加瞬时前台作用域，覆盖不经过节目监视器的网页消费。没有从这些活动推断缓存精度许可，也没有新UI或助手工具。
- 前台按窗口/宿主生命周期持有，多个窗口和瞬时取帧全部结束才释放。原生服务重启时重放当前事实；协调失败继续实时渲染并重试，后台不能把协调失败当空闲。
- 采用 Rust 标准库 `File::lock_shared` / `try_lock`（本机 rustc1.99.0，接口1.89起稳定），Windows 对应 LockFileEx，无新增依赖。全局前台意向文件允许多个前台同时持共享锁；后台每一次提交拿独占额度并检查前台意向，工作结束即释放。进程退出由OS释放，文件不存活动状态、不写心跳、不选主；锁文件持有期间禁止删除/替换，避免文件身份改变绕锁。段发布仍使用已有命名互斥体。
- 跨实例额度不按作品根/用户资料目录分区，同一用户临时目录下的已接入实例共同协调。前台不会等待后台持有的额度；已经领取的后台提交完成，后续提交等待。等待期间不持提交额度，已保留页面/编码会话/临时段/段锁不因前台活动销毁。
- 原生调用使用当前进程代次与一次性token；取消或获取回复迟到时按同token释放，进程重启后旧许可失效且不向新进程释放旧token。
- 本块不宣称观察到了旧9334开发实例，也不观察其他应用GPU活动。原生额度目前接入正式可复用的提交入口并由发布专项使用；**正式补录队列仍未实例化该后台提交链**。
- 新失败事件 `web_source.activity.failed/close_failed` 与 `video_edit.web_cache.activity_failed` 沿既有日志；原生各次额度请求复用正式控制通道日志。未改持久用户格式、依赖、锁文件或画面精度策略。
- 官方选型依据：[Rust File 锁生命周期与 Windows 对应实现](https://doc.rust-lang.org/std/fs/struct.File.html)。现有段互斥解决独占发布；标准库共享文件锁直接满足多前台交叠与退出释放，无需手写进程选举。

### 本轮隔离真机证据

1. `node scripts/probe-web-time-cache.cjs native/video-decoder/target/release/ffmpeg.exe --activity-only` 退出0，状态 `cross-process-activity-passed`；证据 `.artifacts/web-time-cache/2026-10-31T19-35-57-763Z/evidence.json`，日志 `.tmp-t14-activity-probe.log`。
   - 三个自有原生PID69888/55884/52060；两个前台重叠共200ms，后台新增提交0。结束其中一个进程后仍不放行；另一个前台结束后15.58ms恢复一次提交。
   - 后台持额度进程异常退出后，另一进程成功领取额度；旧许可 current=false。测试进程均已退出。
   - 这是一次协调机制样本，**不是实际播放抢占P95或前台耗时增幅**。
2. `node scripts/probe-web-time-cache.cjs native/video-decoder/target/release/ffmpeg.exe --preemption-only` 退出0，状态 `retained-recording-passed`；证据 `.artifacts/web-time-cache/2026-10-31T19-39-12-752Z/evidence.json`，日志 `.tmp-t14-activity-gpu.log`。
   - 本次正式发布器与能力实探均实际使用新跨实例额度；257×259输入、258×260编码、60fps三帧。
   - 保留会话暂停301.23ms，新增提交0，空闲边界drained=0.330ms；临时族和可靠快照保持，恢复后发布。强制CUDA硬解并裁回后的三帧YUV平面与录制真值SHA逐字节相同。
   - 来源变更拒绝发布；正式日志查询读回完成/失败/暂停/恢复，最终streams=[]、hardwareSessions=0、vramReservedBytes=0。
   - 环境沿本机RTX4090/驱动610.47、Electron44.9.3/Chromium152.0.7977.167、随包FFmpeg n9.0.2-17-g2a571b6068。未重新测1440p/4K画质；本轮未做性能门槛替代或下调。

### 验证、自审与审查

- 本块按testing.md L2的跨进程契约、异步状态/取消及资源所有权判级；OS失主释放与共享额度不能由mock证明，升级既有隔离原生/GPU专项。使用工作树自己的native target，未删除或替换node_modules/FFmpeg联接点。
- `node scripts/video-decoder-ffmpeg.cjs test`：75通过、0失败、1既有显式基准忽略；`.tmp-t14-activity-native.log`。release构建成功，`.tmp-t14-activity-native-build.log`。
- 显式15个TS文件 `verify:changed -- --level L2` 通过：7文件78测试、ESLint、渲染/Electron类型、依赖图、main/preload997文件、IPC441/7/40。完整命令/清单见 `.tmp-t14-activity-l2-final.log`。
- 探针独立strict类型、ESLint、CJS语法通过；`.tmp-t14-activity-probe-types.log`、`.tmp-t14-activity-probe-lint.log`。`check:persistence-compat`65格式通过，`.tmp-t14-activity-persistence.log`。
- 独立审查2轮：首轮1项重要问题“失败冷却期间关闭最后剪辑漏发false，活动可能永久残留”已修复；模块级上报器串行发送最新事实，停止采样后也重试释放，迟到回复不覆盖新状态；第二轮无新增问题。新增两项状态机测试通过。
- 自审实际核查：多个宿主重叠、瞬时精确网页取帧、宿主导航/退出、原生重启、许可等待期间的本地再次抢占、取消与迟到回复、正式预渲染直接消费者、真实GPU发布调用链。发现的问题已修复，其余已测路径未发现同源缺陷；尚未实施的生产补录队列和缓存读者不计入通过范围。
- 失败与修复：首轮预渲染mock遗漏新平台方法；L2指出新增测试afterEach返回类型及不完整target夹具；探针strict指出闭包递增值的类型收窄。均修正后通过相应检查，没有删测或放宽断言。

19条中本块推进条10/11的生产前台活动协调与额度；条9/12/18的生产需求队列/退槽/多槽交叠仍待完成。其余状态沿上一节：共享段解码、精度传播、倍率迟滞、段族统一回收、provenance兼容、03其余遗留、useWebCache尚未完成。
整体真机指标仍未测：播放/来回拖动流畅度、正式缓存命中率、生产补录进度与回退原因分布、导出网页段每帧耗时、冷页首播丢帧。上述协调与3帧发布样本不能替代这些数据。

助手门禁最终退出0：结构检查、覆盖15测试、不变量31文件237测试通过，证据 .tmp-t14-activity-assistant.log。下一块继续生产需求队列、退槽/重试和多槽交叠；未触碰D:/视频制作、9334或主工作区代码，外部写入仅本ticket/result.md。

## 续作：单槽生产补录、临时退槽与需求更新（2026-11-01）

摘要：本次运行先提交 `5c9d97829`（前台活动与跨实例逐提交额度），再完成本节生产补录闭环，分别在 `task/14-网页页面时间缓存` 本地提交。未 push、未切分支、未合并。
摘要：**19条仍未全部落实。** 本节是单槽生产队列及1→0→1临时退槽，不是多槽调度完成；下一块仍须先做多槽相邻段交叠，再进入共享段解码。

### 实现与边界

- 正式主进程装配 `WebCacheScheduler`，复用来源登记、硬件实探、跨实例活动额度、段写互斥体及原子发布。需求由渲染 Worker 经既有帧通道的 `cacheWeb` 送到页面服务；与实际 `captureWeb` 分离，复用纹理时也能登记正确相位、更新暂停后的高档需求。没有推断允许读取缓存的精度权限，本块尚未读磁盘缓存。
- 先录不超过2560×1440的预览档；当前及相邻段优先，高档仅收到非latest需求才加入。已知时长、容量有余时从头向前扫录；未知时长只补请求附近段，不猜固定总时长。容量变化关闭无需求扫录，避免立即补回刚被淘汰的段。
- 单槽资源失败归还页面/reader/编码资源，30秒后由段首向前重建，不把会话资源不足永久记成设备不支持。前台抢占仍只阻止后续提交，保留在途会话及段锁；来源撤销/关闭则取消排队与在途任务，释放环境。**显存压力下释放保留会话、扩槽/逐级退槽、相邻槽交叠检查尚未实现。**
- 片段源时间、NTSC帧率、时间表倍率与子帧以有理数推导相位，不经浮点秒生成每帧新变体；1000帧0.5倍速回归只形成两种相位。前视画面在实际成为当前画面时登记自己的网格，不能沿用前一帧网格。
- 同一段新增元素几何需求时，持段锁重录并合并已有选择器；缺失任一帧的几何不能发布，未找到元素的null仍是完整结果。几何结构、firstFrame及帧数均读回校验，持久格式字段与版本不变。
- 主进程保留页面最新补录需求，内容热重载重新登记后重放；关闭页面/服务清除，不把重载窗口期的空登记当作已经完成补录。
- 真机发现1fps的g=1与NVENC预设帧间间隔冲突；按[FFmpeg官方NVENC实现](https://github.com/FFmpeg/FFmpeg/blob/master/libavcodec/nvenc.c)对单帧GOP使用g=0显式全帧内编码，实际码流仍通过原段校验。没有降低硬解、色度或画质门槛。
- 真机发现未open/重复dispose的GPU reader会注销不存在的https处理器、遮住原始失败；清理按实际拥有的协议登记执行且幂等。检查共享调用方包含web-replay播放器、能力实探、发布探针和生产调度，正常打开及失败释放回归通过。
- 日志复用 `main.web_source` 的 `scheduler.start/completed/throttled/failed` 与既有逐帧、发布、环境及原生控制日志。没有新增日志通道、UI、设置、模型调用或助手专用工具。缓存空间仍接现有manager，**段族统一计量/命中刷新/原子回收属于后续未完成项**。

### 隔离真机证据

- 命令：`node scripts/probe-web-time-cache.cjs native/video-decoder/target/release/ffmpeg.exe --scheduler-only`，退出0，`production-scheduler-passed`。
- 最终证据：`.artifacts/web-time-cache/2026-10-31T19-59-30-431Z/evidence.json`，日志 `.tmp-t14-scheduler-gpu.log`。每次按当前源码独立bundle正式模块，使用统一 `electronLaunch` 隔离资料与随机端口；没有连接9334。
- 正式开页→可信来源登记→需求登记→能力实探→可靠快照→HEVC444编码→段校验→原子发布跑通。输入257×259、编码258×260、1fps、声明2.1秒；首批两段共3帧，含初始化/实探/环境复核的补录完成时间31204.44ms。
- 初始两段强制 `hevc_cuvid`/CUDA硬解，裁回257×259后的全部YUV444平面与同一来源可靠快照真值逐字节一致；每帧div几何为[0,0,257,259]。
- 不追加渲染层需求，热改夹具内容后自动完成另外两段；热改至收尾30293.52ms，总计4段发布。正式日志读回四次completed，无损坏行。
- 关闭来源后登记撤销；原生streams=[]、hardwareSessions=0、vramReservedBytes=0。专项正常退出，自有产物路径对应的Electron/FFmpeg进程无遗留。
- 这两项耗时包含初始化与环境校验，是小夹具链路证据，**不是逐帧吞吐、播放流畅度或冷页首播指标**。本块未重测1440p/4K画质，也不借历史50dB代替本轮端到端播放验收。

### 验证与独立审查

- 按testing.md L2的共享契约、跨层IPC、调度/取消、文件I/O判级。正式GPU编码/硬解和热重载不能由mock证明，运行以上既有隔离专项；重任务全部串行。
- `npm run verify:changed -- --level L2 <显式19个本次TS文件> --test ...` 通过：9文件177测试，文件级ESLint、渲染/Electron双工程类型、依赖图、main/preload999文件、IPC442请求/7端口/40事件。精确清单和完整命令见 `.tmp-t14-scheduler-dry.log`、`.tmp-t14-scheduler-l2.log`。
- 探针独立strict类型、ESLint、CJS语法通过，见 `.tmp-t14-scheduler-probe-types.log`、`.tmp-t14-scheduler-probe-lint.log`；`check:persistence-compat`65格式通过，见 `.tmp-t14-scheduler-persistence.log`。
- `check:assistant-capabilities`退出0：结构检查、覆盖15测试、不变量31文件237测试通过，见 `.tmp-t14-scheduler-assistant.log`。没有助手运行时/提示词改动，不追加付费模型调用。
- 原生代码本节未改；复用本次运行第一块的75通过/0失败/1既有显式基准忽略及release构建证据，`.tmp-t14-activity-native.log`、`.tmp-t14-activity-native-build.log`。第一块跨三原生实例活动协调和GPU抢占保留专项亦见上一节。
- 独立审查3轮：首轮2项重要问题（前视相位串用、暂停复用纹理漏高档需求）均修复并通过渲染层回归；第二轮1项重要问题（热重载窗口丢需求）已修复并通过隔离真机；第三轮无新增问题。此前活动协调块2轮审查中的重要问题亦已修复。
- 自审实际范围：真实来源开关/热改、当前与前视复用、预览转暂停、NTSC/时间表采样、段几何补齐、取消迟到环境、失败从段首重演及GPU reader共享清理。修复上述问题后，已检查路径未发现其他同源缺陷；未实施的多槽、读缓存、精度和导出消费路径不在通过范围。
- 首次L2因测试多余分号失败，修复后完整L2通过；首次真机因低帧率GOP失败，原失败和修正后的硬解证据均保留，未放宽断言。

### 剩余与下一步

按原顺序继续：多槽资源探测/扩退槽与相邻段交叠一致性（条18，失败仅该页面退单槽顺序录）→ 同变体跨段共享解码、读缓存/回退及段族回收 → 根/嵌套入口显式精度和provenance传播 → 03其余遗留（含倍率迟滞、占位尺寸与预算等）→ 导出useWebCache及精确导出顺手入缓存 → 整体真机验收。不得把本轮单槽通过当作补录调度剩余全部完成。

| 必需真机指标 | 当前证据 |
| --- | --- |
| 播放/来回拖动流畅度 | 未测；生产读缓存未接入 |
| 正式缓存命中率 | 未测；没有读缓存消费路径 |
| 补录进度 | 已测：隔离小夹具首批2段，热改后累计4段，逐帧/完成日志读回 |
| 回退原因 | 已验证低帧率编码失败日志及修复；资源失败/源撤销由精确状态机测试覆盖，未做整体原因分布 |
| 导出网页段每帧耗时 | 未测；useWebCache未接 |
| 冷页首播丢帧 | 未测；正式冷解码/预热未接 |

未改依赖/锁文件，未执行install/ci/uninstall，node_modules和FFmpeg联接点未删改；未触碰D:/视频制作工程或主工作区代码；外部写入仅本ticket/result.md。同节同步任务分支result.md，专项产物与临时日志保持忽略，不进入提交。

## 续作：自适应多槽、交叠门禁与单页顺序回退（2026-11-01）

摘要：从 `1d532bfca` 继续，完成生产调度的单槽起步、成功试增槽、失败逐级退槽、相邻槽及跨组边界交叠校验，不一致仅该来源回到单页顺序录制。本节代码独立提交。
摘要：**整票仍未完成，19条没有全部验收。** 本轮闭环多槽交叠这一块；共享段解码、精度传播、03其余遗留、useWebCache和整体真机矩阵尚未接通。显存紧张时主动释放暂停会话也仍待接线。
摘要：仅任务分支本地提交，不切分支、不合并、不push。未连接9334、用户浏览器、网页账号或外部聊天服务；隔离Electron专项使用自造网页。

### 实现与实际边界

- 调度从一个槽开始，每次满槽成功后尝试增加一个槽，不设置固定并发容量上限；会话/页面/读回/编码失败取消同组其余槽，唤醒交叠等待者，全部清理后降低容量并冷却30秒。冷却后可以重试及扩槽，不把资源不足永久记成设备不支持。
- 多槽按相邻段组成录制组，每个槽拥有独立页面、GPU reader与编码器；仍经过原有跨实例逐提交额度，前台抢占只停止后续提交并保留在途资源。没有创建另一套上传/录制/编码路径或新的依赖。
- 每段取可靠首帧及下一段首帧作为边界证据，额外边界帧不写进本段视频；守护区校验后，用Node原生异步WebCrypto SHA-256对YUV444平面计算摘要。比较包含时间、物理尺寸及全部平面摘要，不用宽松像素阈值。只保留摘要及生命周期检查闭包，不额外保留整幅首帧图像。
- 所有槽完成捕获与码流校验后在发布前汇合；任一捕获/交叠失败取消整组，未通过的段不能成为ready。组间重录前一段作锚点，同时核对该调度代次已发布的首帧/边界证据，防止“每组内部相同、跨组不同”漏检。存在交叠门禁时不跳过生产者复用旧段；本轮以重新可靠录制建立证据。
- 跨实例先领取变体录制组锁，再领取各段发布锁；组锁沿既有命名互斥体，不新建选主或心跳。这样不同实例不会各持不同段锁再互等交叠屏障。具体跨实例发布/活动底座沿前轮，本轮未重新跑跨实例整组争用真机矩阵。
- 交叠不一致只标记当前来源批次的所有倍率/相位变体为单槽；把ready及实际发布证据中的所有段排入顺序重录，不因新增几何需求或容量失效清空ready而漏掉历史段。同一页面从零向前推进并连续录制各段；来源切换、需要更早帧或失败重试时重建页面并从零向前重演，不向后seek。独立来源不会被永久降成单槽。
- `recording.ts` 只承接槽资源所有权与交叠屏障；发布仍由 `publication.ts` 唯一入口负责，新增发布前门禁保留完整环境、设备、来源复核及原子段提交。无持久用户schema、IPC或UI改动；边界证据是该调度代次的内存状态，未宣称它跨应用重启持久存在。
- 新增日志沿 `main.web_source` 的 `scheduler.overlap_completed/overlap_failed`；start/completed记录实际槽数，throttled记录退槽容量。已用正式查询读回，无新日志通道。
- 按 `henji-application-capability` 核对：没有新增可查询用户数据、设置、Surface或业务操作，只改已有缓存调度内部执行与恢复；不新增Pi/MCP工具或能力声明。原信任登记及外来代码确认边界沿用，不由后台批准。
- 选型复用既有WebSourcePage/GpuFrameCapture/FrameEncoder/原生锁，摘要用标准库异步能力，无新增依赖。官方依据：[Node WebCrypto digest](https://github.com/nodejs/node/blob/main/doc/api/webcrypto.md)。

### 最终隔离真机证据

1. `node scripts/probe-web-time-cache.cjs native/video-decoder/target/release/ffmpeg.exe --scheduler-only`：`production-scheduler-passed`，证据 `.artifacts/web-time-cache/2026-10-31T20-19-23-576Z/evidence.json`，日志 `.tmp-t14-multislot-gpu-final.log`。
   - 257×259输入、258×260编码、1fps、2.1秒自造确定性页面；首段单槽后实际扩到两槽，两段交叠通过。首批含锚点重录共3次发布，耗时 **50946.092ms**；热重载后双槽再发布2段，耗时 **23941.187ms**，总计5次发布。
   - 首批两个最终段强制 `hevc_cuvid`/CUDA硬解，裁回后的3帧YUV444平面与可靠快照真值逐字节一致；逐帧div几何完整。正式查询读回两次overlap_completed（两槽）及全部完成事件。
2. `node scripts/probe-web-time-cache.cjs native/video-decoder/target/release/ffmpeg.exe --overlap-only`：`production-overlap-fallback-passed`，证据 `.artifacts/web-time-cache/2026-10-31T20-21-05-677Z/evidence.json`，日志 `.tmp-t14-multislot-fallback-final.log`。
   - 相同尺寸/网格，夹具故意按seek调用次数改变颜色。实际双槽在帧2交叠失败；失败组未发布，随后单页从零顺序重录两段。含最初成功首段，共3次发布，耗时 **46114.479ms**。
   - 最终两个段的全部3帧强制CUDA硬解平面与同页顺序真值逐字节一致；正式日志读回overlap_failed及全部完成事件。最终 streams=[]、hardwareSessions=0、vramReservedBytes=0，来源关闭后登记移除。

本机仍为RTX4090、Electron44.9.3/Chromium152.0.7977.167、随包FFmpeg n9.0.2-17-g2a571b6068；本轮没有修改或重测驱动画质路线，没有观察其他应用GPU活动。上述时间包含启动/实探/字体环境校验与发布，**不是播放流畅度、逐帧吞吐或冷页首播数据**。实际GPU只证明1→2槽与2→1一致性回退；3槽及跨组状态变化由定向状态机测试覆盖，未冒称真实GPU三槽容量/压力矩阵。未重测1440p/4K 50dB，沿前轮历史画质证据但不把它充当本轮整体验收。

### 验证与审查

按testing.md L2的异步调度、重试/取消、文件I/O及资源所有权判级。交叠像素和真实多会话行为无法由mock证明，升级现有隔离GPU/FFmpeg专项；原生、持久兼容、助手能力聚合按本轮用户明确要求运行，不升级全仓L3或完整应用构建。

独立审查3轮：首轮重要问题“跨组锚点未与已发布边界比较”及小问题“额外持有首帧bitmap”已修；第二轮重要遗漏“新增selector清空ready后，回退漏重录历史段”已修并增加五段回归；第三轮未发现新问题。自审和独立审查覆盖生产调度、发布器、段锁、活动/提交协调、来源登记、页面可靠快照、几何需求更新、跨组边界、取消及失败释放。已检查范围内未发现其他同源缺陷；尚未实现的读缓存/导出及显存压力释放不计入通过。

- 显式5个本次TS文件的 `npm run verify:changed -- --level L2 ... --test electron/main/services/web-source/pages.test.ts --test electron/main/services/web-source/submissions.test.ts` 退出0：4文件14测试、文件级ESLint、Electron类型、依赖图、main/preload1000文件检查通过。完整命令/输出：`.tmp-t14-multislot-l2-final.log`。未改渲染公共契约，不额外跑渲染层全工程类型。
- 探针独立strict类型及ESLint通过：`.tmp-t14-multislot-probe-types.log`、`.tmp-t14-multislot-probe-lint.log`。类型参数沿前节的ES2022/commonjs/DOM/node,electron,@webgpu/types/resolveJsonModule/strict及既有es-module-lexer声明。CJS语法、git diff检查通过。
- `node scripts/video-decoder-ffmpeg.cjs test` 退出0：75通过、0失败、1既有显式基准忽略；`.tmp-t14-multislot-native.log`。本轮原生代码未改，没有重复release构建。
- `npm run check:persistence-compat` 退出0，65格式通过；`.tmp-t14-multislot-persistence.log`。
- `npm run check:assistant-capabilities` 退出0：结构检查、15覆盖测试、不变量31文件237测试通过；`.tmp-t14-multislot-assistant.log`。未改助手运行时/提示词，不调用付费模型。
- 调试记录：早期L2在依赖图阶段主动中止，以恢复单重任务调度，未把中止结果算通过；最终上述完整L2及后续门禁串行重跑通过。早期两次GPU专项也通过，但首轮审查后的行为改动使其证据不再作为最终依据，已各自复跑为前述final日志。没有放松断言、删除测试或降低画质门槛。

### 19条、03遗留与下一步

本轮落实条18的生产多槽交叠及单页顺序回退，推进条12的扩退槽/重试和条10/11的多槽提交/组锁协作。条1/2/3/5/6/7/13/16等底座仍沿前轮边界；其余整体验收未完成。特别是条4共享段解码、条8显式精度与条19 provenance、条14倍率迟滞、条17段族统一回收，仍是后续工作，不标完成。

| 必需整体真机指标 | 本轮状态 |
| --- | --- |
| 播放/来回拖动流畅度、命中率 | 未测，生产读缓存未接 |
| 补录进度 | 已测首批3次发布、热改累计5次；不确定页面退单槽后共3次 |
| 回退原因 | 已实测交叠不一致；会话资源失败由定向测试覆盖，未做整体原因分布 |
| 导出网页段每帧耗时 | 未测，useWebCache未接 |
| 冷页首播丢帧 | 未测，正式冷解码/预热未接 |
| 让出P95、前台耗时增幅、完整流水线600帧 | 未测，不用小夹具或历史单次暂停数据替代 |

后续顺序保持：共享段解码/读取与回退、段族回收 → 根及嵌套入口显式精度/provenance → 03其余遗留（倍率、占位预算、预开/冷首播、600帧）→ useWebCache及精确导出顺手入缓存 → 整体真机指标；并补显存压力下释放暂停会话。导出行尚未改，候选文案仍按前文交Claude把关。未降低任何门槛、未改设计方向或依赖。

未执行install/ci/uninstall，node_modules与FFmpeg联接点未删改；未操作D:/视频制作工程、9334或主工作区代码。外部写入仅本ticket/result.md，本节同步到任务分支同名文件；临时执行脚本已移除，日志及专项产物保持忽略，不进入提交。
## 续作：同变体共享硬解会话与单帧尾段恢复（2026-11-01）

摘要：从 `dbf29b207` 继续，先完成条4的原生共享段解码底座并独立提交。**整票未完成；本节不是正式读缓存/回退与段族回收全部完成。** 后续仍按既定顺序接消费端、精度传播、03遗留、useWebCache、压力释放与整体验收。

- 既有原生控制通道新增 `set_decoder_segment`：同一 HEVC 硬解会话只更换解封装输入，核对时间基、编码配置、色彩标记和 extradata、首包关键帧；保留 AVCodecContext、硬件设备、共享纹理池。段局部时间从零开始；拒绝缺失或不兼容段时保留原会话可读。取消、连续计划忙碌和停止后的排队响应沿同一会话规则处理，没有新IPC或渲染层权限推断。
- 切段同时刷新全关键帧、帧内与即时输出状态，防止单帧尾段污染后续含P帧段的定位。FFmpeg按SPS实际DPB分配NVDEC表面，CUDA444额外仅保留候选/前瞻两帧；显存计量采用实际硬件池尺寸，无可读值时沿用估算。正式探针报告13张表面（此前固定预算20张），本夹具预留7,200,960字节。
- 复用正式解码器、纹理桥和FFmpeg，不加依赖、不手写码流解析。[FFmpeg NVDEC HEVC参考帧池](https://raw.githubusercontent.com/FFmpeg/FFmpeg/master/libavcodec/nvdec_hevc.c)、[NVDEC表面分配](https://raw.githubusercontent.com/FFmpeg/FFmpeg/master/libavcodec/nvdec.c)、[解码排空/flush契约](https://raw.githubusercontent.com/FFmpeg/FFmpeg/master/libavcodec/avcodec.h)为核查依据。

### 隔离真机与验证

- 最终命令：`node scripts/probe-web-time-cache.cjs native/video-decoder/target/release/ffmpeg.exe --shared-segments-only`，退出0、`shared-segment-decode-passed`。证据 `.artifacts/web-time-cache/2026-10-31T20-37-22-848Z/evidence.json`，日志 `.tmp-t14-shared-gpu-logs.log`。
- 正式FrameEncoder生成257×259、编码258×260的60fps与30000/1001fps独立段，各组普通段加1帧尾段。先独立解码建立实际Chromium纹理真值，再从单帧尾段打开共享会话，五次换段并前后定位；两组共32次取帧的PNG及PTS与独立真值逐字节一致，任意切段时原生流数均为1。另验证4次缺失/不兼容段拒绝后原帧仍可读。
- 小夹具含Canvas2D/PNG读回的平均/P95：60fps组8.052/11.778ms，29.97fps组8.195/10.530ms。**这些不是节目播放、拖动或导出耗时指标。** 最终streams=[]、hardwareSessions=0、vramReservedBytes=0；正式日志查询完整读回10次切段完成事件，无损坏行。
- L2依据：跨进程契约、取消/异步会话、文件I/O与资源所有权；共享硬件会话及像素交付不能由mock证明，升级现有隔离GPU/FFmpeg专项。
- `verify:changed -- --level L2 electron/main/services/video-decoder/client.ts electron/main/services/video-decoder/client.test.ts electron/main/services/video-decoder/protocol.ts --test electron/main/services/video-decoder/texture-bridge.test.ts`通过：2文件48测试、ESLint、Electron类型。证据 `.tmp-t14-shared-l2.log`。
- 原生test：75通过/0失败/1既有显式基准忽略；release构建通过，日志 `.tmp-t14-shared-native-final.log`、`.tmp-t14-shared-native-build-final.log`。探针独立strict类型、ESLint、CJS语法及diff检查通过，日志 `.tmp-t14-shared-probe-types-final.log`、`.tmp-t14-shared-probe-lint-final.log`。
- `check:persistence-compat`65格式通过；`check:assistant-capabilities`结构门禁、覆盖15测试、不变量31文件237测试通过；`.tmp-t14-shared-persistence.log`、`.tmp-t14-shared-assistant.log`。未改持久用户格式或助手能力，不运行付费模型。
- 独立审查2轮：首轮1项重要问题“单帧尾段的全关键帧状态跨段残留”已修复并加真实纹理回归；第二轮无新问题。实际自审范围：原生开会话、段输入替换、前后定位、忙碌/取消/停止、显存预算、正式共享纹理交付。尚未实现的缓存读取消费者和回收不计入审查通过。
- 调试记录：探针strict类型发现日志afterTimestamp应为ISO字符串，已修复，并增加正式日志完成计数断言后重跑GPU专项。未降低任何门槛。

### 尚未完成

正式读取与实时回退、跨来源共享/生命周期、段族统一回收仍待接入；之后是精度/provenance传播、03五项遗留、useWebCache与导出顺手入缓存、显存压力释放及整体真机矩阵。播放/来回拖动流畅度、正式命中率、回退原因分布、导出网页段每帧耗时、冷页首播丢帧均未测；补录进度仍沿前轮证据。本节没有界面变更或需要Claude把关的新文案。

仅任务分支本地提交，不push、不切分支、不合并；未连接9334、用户浏览器/账号或外部聊天服务，未碰D:/视频制作工程。未执行install/ci/uninstall，未删改node_modules/FFmpeg联接点；外部写入仅本ticket/result.md。

## 续作：正式缓存读取、实时回退与段族回收（2026-11-01）

摘要：继本轮本地提交 `d5e199bdf` 的共享段硬解底座，完成主进程读取/回退与统一段族回收这一块；**整票未完成**。正式节目消费方尚未传入缓存精度许可，所以默认仍实时精确读取，不把探针成功算成节目已启用。
本节没有改变设计方向、依赖或45dB/0.995画质门槛，没有界面变化。后续首先完成根/嵌套入口的精度与provenance传播，再按原顺序处理03、useWebCache、压力释放及整体真机。

### 实现与边界

- `WebSourcePages.capture` 经正式 `WebCacheReader` 读取；只有显式 `precision: web-cache` 且时间落在给定相位网格上才允许缓存。缺省exact；latest只决定已获许可请求的预览档位，不充当许可。读前核对来源、信任登记、环境与GPU代次，读时仅核成员尺寸/结构，不重算SHA；缺段、几何不足或坏码流回退实时并重新请求补录。
- 同一窗口、同一变体的不同页面来源/段串行共用一个原生解码会话；切段和同路径重录根据发布manifest中的视频身份切换输入。仍保留窗口归属边界，跨窗口全局复用未实现/未验收。空闲3秒释放，窗口关闭、取消、服务退出均结束相应读取；这不等于显存压力释放整块完成。
- 帧沿正式纹理桥与preload交付为网页来源的streamId/route/时间；主进程核对段内PTS，过期帧归还原生槽位。真实奇数尺寸测试发现Electron共享纹理的可见区域与显示尺寸不同：导入虽裁去编码补边，显示尺寸仍等于codedSize。正式preload通过WebCodecs创建同资源帧视图，设定显示尺寸并关闭原帧；消费方交回的新帧仍在主线程关闭，不做CPU像素搬运。
- 依据：[Electron共享纹理结构](https://www.electronjs.org/docs/latest/api/structures/shared-texture-import-texture-info)、[Electron源码CreateVideoFrame](https://raw.githubusercontent.com/electron/electron/v42.0.0/shell/common/api/electron_api_shared_texture.cc)、[WebCodecs帧构造与资源引用](https://www.w3.org/TR/webcodecs/#videoframe-constructors)。复用既有原生协议、FrameEncoder、纹理桥和统一媒体缓存管理器，没有新增依赖。
- `WebCacheSegments` 在统一管理器初始化时登记段族；容量、LRU、文件数均按族计，发布者、读取者和回收者共用同一命名互斥体。回收先在持锁原生线程将目录整体撤出可读名字，再删成员；扫描后被访问/替换的族跳过，正在写/读的族不等待。临时族逐族回收，避免一次清理多个族却只统计一个。没有引用者集合或另设缓存容量。
- 环境快照失效后重新准备；准备过程去重，失败后冷却重试。坏帧才撤掉段族，取消、资源不足不删仍有效缓存。当前范围的取消、缓存成员缺失、同路径替换、环境变化、空闲/窗口关闭和原生退出已检查；完整压力矩阵、跨窗口共享与所有节目消费者尚未验证。

### 隔离真机证据

最终命令：`node scripts/probe-web-time-cache.cjs native/video-decoder/target/release/ffmpeg.exe --reader-only`；退出0，`production-cache-reader-passed`。证据 `.artifacts/web-time-cache/2026-10-31T20-51-45-261Z/evidence.json`，日志 `.tmp-t14-reader-gpu-final.log`。使用本分支源码隔离打包及独立userData，不连接9334。

- 自造257×259网页、258×260编码、1fps/2.1秒；先走正式能力实探与补录，含锚点重录共3次发布，42306.531ms。
- 0→1→2→0四次正式缓存读取，始终只有1个原生会话；PNG红/蓝/红/红身份、257×259显示尺寸、网页stream/route及逐帧div几何均通过。默认exact请求绕过缓存；回收第二段的整个目录后，再读time2成功实时回退。
- 四次含Canvas2D/PNG消费与IPC的墙钟耗时分别262.359、70.786、72.115、77.565ms；正式命中事件内部耗时按上述顺序207.862、55.647、58.202、62.856ms。5次显式缓存请求中4次命中、1次故意回收后的miss；**这是夹具计数，不是节目命中率、播放/拖动流畅度、导出耗时或冷页首播丢帧。**
- 正式日志查询读回4次hit及缺段/几何回退原因，无损坏行。最终streams=[]、hardwareSessions=0、vramReservedBytes=0；小夹具峰值预留7,200,960字节。未重测1440p/4K画质，不用历史50dB代替整体验收。

### 验证、审查与余项

L2依据是公共帧契约、preload交付、跨层文件I/O、取消/恢复与资源所有权；真实GPU裁剪/共享及原生整族操作无法由mock证明，因此运行既有隔离专项。用户指定的原生、持久兼容和助手门禁串行执行，不升级全仓L3/完整应用构建。

- 显式23个本次TS文件的 `npm run verify:changed -- --level L2 ...`，另显式加入pages、pages.registration、client、media-cache直接消费者测试，退出0：13文件92测试、文件级ESLint、渲染/Electron类型、依赖图、main/preload 1004文件、IPC对账通过。完整命令与输出：`.tmp-t14-reader-l2-complete.log`。
- 原生专项76通过/0失败/1既有显式基准忽略；release构建通过：`.tmp-t14-reader-native.log`、`.tmp-t14-reader-native-build.log`。
- 探针独立strict类型与ESLint通过：`.tmp-t14-reader-probe-types-final.log`、`.tmp-t14-reader-probe-lint-final.log`；CJS语法与diff检查通过。
- `check:persistence-compat`65格式通过，`check:assistant-capabilities`结构门禁、覆盖15测试、不变量31文件237测试通过：`.tmp-t14-reader-persistence.log`、`.tmp-t14-reader-assistant.log`。没有改助手行为，不调用付费模型。
- 独立审查3轮：首轮重要问题“同批次环境失效后永不重建”已修并验证；第二轮检查恢复及显示尺寸/帧释放增量，无新问题；第三轮仅检查临时族逐项回收计量，无重要问题。自审另修同路径重录身份、空闲释放的排队竞态和交付前触碰LRU。检查范围为正式读取及其页面/纹理桥/preload调用方、发布锁和统一容量回收；未把后续渲染消费者或压力场景算作审查通过。
- 失败记录：最初真机发现显示尺寸沿用编码尺寸，按上述根因修复后专项通过；测试替身漏填seeked/decodeMs及探针日志context类型不明确已补齐，重跑对应检查通过。首次渲染类型检查撞Node默认4GB堆，最终命令仅设置进程级 `NODE_OPTIONS=--max-old-space-size=8192` 后完整通过；没有改依赖、跳过门禁或下调断言。

本轮条4的跨段会话及条17段族管理已有上述生产实现与证据，窗口间仍各自持有会话；条8仅完成底层请求契约，根/嵌套调用尚未传播，不标完成。条19 provenance、条14倍率迟滞、03其余遗留、useWebCache及精确导出顺手入缓存、显存压力释放仍未实施/验收。其余裁定的历史证据沿前节，不在本节重复宣称全票完成。

| 必需整体真机指标 | 当前状态 |
| --- | --- |
| 播放/来回拖动流畅度、整体命中率 | 未测；仅上面的正式读取小夹具4/5 |
| 补录进度 | 本夹具3次发布，42306.531ms；非整体吞吐 |
| 回退原因 | 实测整段回收后缺段回退；完整原因分布未测 |
| 导出网页段每帧耗时 | 未测；useWebCache未接 |
| 冷页首播丢帧 | 未测；冷页预开/播放验收未接 |
| 压力释放、600帧/完整流水线 | 未测 |

本轮在共享硬解底座和读缓存/回收两次可独立验证的提交处收尾；其余尚未实施，不是硬件路线失败，不降低已定门槛。下一步先核齐共享会话的跨窗口作用域，再完成根/嵌套渲染及派生缓存的显式精度/provenance，之后依次03遗留、useWebCache、压力释放与整体真机。没有新增需Claude把关的界面文案，导出行仍沿前文候选待后续落地。

仅在 `task/14-网页页面时间缓存` 本地提交，不push、不切分支、不合并；未触碰9334、已登录浏览器、外部聊天或D:/视频制作工程。没有install/ci/uninstall，未删除node_modules/FFmpeg联接点；本节分别追加到本分支及外部ticket的result.md，保留各自已有内容，临时日志和专项产物不提交。

## 续作：跨窗口共享会话与在用段租约（2026-11-01）

从 `980fec1ad` 继续。本节完成同变体跨窗口共享读取及由真机验收发现的在用段回收缺陷；整票未完成，节目根/嵌套入口的精度与来源传播仍在下一块。没有改变路线、依赖、画质门槛或界面。

### 实现与根因

- 解码会话按变体全局复用，由主进程持有，不绑定首个窗口。每次读取携带正式目标、页面stream/route和用户票据，原生票据全局递增；不同窗口使用相同用户票据不会串帧。独占解码器的IPC所有权校验保留，窗口关闭/导航只取消本次交付，迟到send失败不关闭别的窗口正在使用的共享会话。
- 切段是共享状态变更：用户取消只停止交付，切段必须得到确定结果才记录当前段；切段失败或超时即关闭会话并清理身份，下次重开。覆盖切段取消后读回旧段及取消与超时重叠。
- 真机发现FFmpeg保持段文件打开，而单帧结束便释放内核锁，回收在Windows失败（os error 5）。现复用现有命名互斥体，以段租约覆盖解封装器打开文件的整个生命周期：切走、关闭、原生退出才释放；回收在占用时跳过。新增选择器导致当前段几何不足时，先关闭该段并释放租约，避免持续前台读取阻塞补录。
- 实际排查范围：共享reader、普通/共享纹理桥调用方、取消/导航/关闭/迟到交付、切段失败、同路径重录、段族回收与缺几何重录、服务退出、空闲释放。没有把渲染消费者、跨进程GPU共享或显存压力释放算作本块完成；跨实例仍用既有内核锁协调磁盘段，不跨进程共享GPU会话。

### 真机与门禁

L2升级依据：跨窗口异步状态、公共纹理桥及文件资源所有权；GPU实际交付和Windows文件占用不能由mock证明，运行隔离真实专项。一次一个重任务，不访问9334。

- `node scripts/probe-web-time-cache.cjs native/video-decoder/target/release/ffmpeg.exe --reader-only` 退出0，`production-cache-reader-passed`。证据 `.artifacts/web-time-cache/2026-10-31T21-25-03-638Z/evidence.json`；日志 `.tmp-t14-cross-gpu-final.log`。本分支源码单独打包、独立userData与两个隐藏宿主窗口。
- 257×259夹具，原生258×260：0→1→2→0读回一致；双窗口同票据并发红/蓝帧一致；首窗口关闭后另一窗口继续读，始终同一个原生stream。占用段拒绝回收，切走后整族回收成功，再读该段实时回退；缺省exact绕过缓存。
- 预热实际命中后开始测量（本次预热1次）；测量9次缓存请求8次命中，1次故意回收后缺段回退。四次串行取帧含IPC/Canvas2D/PNG耗时33.660、19.465、42.621、39.148ms。补录3次发布，33560.089ms。最终streams=[]、hardwareSessions=0、vramReservedBytes=0，峰值预留7,200,960字节。正式日志读回无损坏行。
- 显式6个本次生产/测试TS文件的 `verify:changed -- --level L2`，额外pages、pages.registration、locks精确测试通过：6文件34测试、ESLint、Electron类型、依赖图、主进程导入门禁。日志 `.tmp-t14-cross-lease-l2.log`。
- 探针两文件独立strict类型（ES2022/commonjs/DOM/node,electron,@webgpu/types及既有es-module-lexer声明）、ESLint通过：`.tmp-t14-cross-probe-types.log`、`.tmp-t14-cross-probe-lint.log`。diff检查通过。
- 原生专项76通过、0失败、1既有基准忽略；`.tmp-t14-cross-native.log`。未改原生实现，不重复release构建。
- `check:persistence-compat`65格式通过；`check:assistant-capabilities`结构门禁、15覆盖测试、31文件237不变量测试通过；`.tmp-t14-cross-persistence.log`、`.tmp-t14-cross-assistant.log`。未改助手行为，无付费模型调用。
- 独立审查：跨窗口3轮，重要问题“切段取消/超时状态不确定”“导航迟到send失败关闭共享会话”均修复，末轮无新问题；真机发现段锁问题后另做段租约2轮，重要问题“缺几何仍占锁阻塞补录”已修，末轮无新问题。均补入上述回归范围。
- 失败记录：早期探针把环境尚未就绪的实时回退当作缓存像素比较；改为由正式hit日志确认预热。双来源重复提交补录需求使发布计数变化，探针只提交一份需求；不改变生产调度。另修真机暴露的在用文件租约根因。最终所有专项重新通过，没有降低断言或门槛。

### 剩余与下一步

条4跨窗口部分已完成；条8/19渲染入口精度、actual provenance及派生缓存过滤尚未完成，下一步先做这一块。其后顺序仍为03五项遗留、useWebCache及精确导出顺手写缓存、显存压力释放、整体真机。19条不标全完成。

播放/来回拖动流畅度、节目整体命中率、导出网页段每帧耗时、冷页首播丢帧、600帧完整流水线与前台让出P95均未测；本节的小夹具8/9和耗时不能代替这些数据。回退原因仅实测not-ready及故意回收后的missing-segment-or-geometry，未做整体分布。无新增界面文案需Claude把关。

仅任务分支本地提交，不push、不切分支、不合并；未操作已登录浏览器/网页账号/外部聊天服务、9334或D:/视频制作工程。未执行install/ci/uninstall，未删改node_modules和FFmpeg联接点。本节同步追加到本分支及外部ticket/result.md；日志和专项产物保持忽略。

## 续作：取帧边界的显式精度与实际来源（2026-11-01）

继本轮本地提交 `db65ceeed`，完成精度/provenance这一块的**底层取帧边界阶段**；根/嵌套渲染与派生缓存的整条传播尚未完成，条8/19不标完成。生产节目入口仍缺省exact，尚未开启网页缓存消费；没有界面变化或新增依赖。

### 已实施与验证边界

- `WebSourceCaptureResult.provenance`标记实际交付来源：缓存命中为`web-cache`，实时读取（包括获准缓存后的回退）为`live`；不以请求许可冒充实际来源。缺省兼容为live，无画面的dropped回执不要求来源。
- `VideoEditWebInputs`接收显式precision并传到正式captureWeb；缺省exact。时间相同的exact与web-cache请求不共用在途或已完成读取；缓存网格/相位及预览档进入读取身份，松手转高档不会误用低档缓存结果。已有exact前视复用和补录需求更新保持原行为。
- `VideoEditCodePicture`承载网页实际来源，选择器包装保留来源。截止时间回退按许可筛选上一幅：exact不沿用web-cache；允许缓存的请求仍可沿用，并保持来源。来源与时间/尺寸approximate分开。
- 自审与独立审查覆盖主进程reader/pages、IPC/端口原样回执、WebInputs读取/前视/在途复用/超时回退/纹理池和选择器包装。独立审查1轮无新增重要问题。根/嵌套合成、滤镜相邻帧及预渲染文件尚未改动，不计入来源传播完成；既有渲染器132项直接消费者回归通过，只证明本次边界没有回归。

### 验证与真实数据

L2依据：公共帧回执、双端直接消费者、异步在途状态与复用身份。显式7个本次生产/测试TS文件，另指定pages.registration、pages及renderer精确测试：`verify:changed -- --level L2 ...`退出0，5文件155测试、ESLint、渲染/Electron类型、依赖图、main/preload导入及IPC对账全部通过。日志 `.tmp-t14-provenance-l2.log`。新增三项测试分别覆盖许可与实际来源、精确截止时间回退、相位/档位及并发精度隔离。

- 真实命令 `node scripts/probe-web-time-cache.cjs native/video-decoder/target/release/ffmpeg.exe --reader-only` 退出0，证据 `.artifacts/web-time-cache/2026-10-31T21-37-04-641Z/evidence.json`；日志 `.tmp-t14-provenance-gpu.log`。新增断言确认缓存命中、默认exact、故意回收后实时回退三种结果的实际来源，复跑上一节所有双窗口与段租约检查。
- 同一257×259夹具：补录3次发布，44703.464ms；预热1次；测量请求9次/命中8次/故意缺段回退1次。0→1→2→0含IPC/Canvas2D/PNG墙钟67.170、31.123、63.553、60.578ms；同票据并发、关闭首窗口、单原生会话与整族回收均通过。最终streams=[]、hardwareSessions=0、vramReservedBytes=0，峰值预留7,200,960字节；正式日志无损坏行。
- 探针独立strict类型及ESLint通过：`.tmp-t14-provenance-probe-types.log`、`.tmp-t14-provenance-probe-lint.log`；diff检查通过。
- 本阶段没有改原生实现、依赖、持久格式或助手能力；复用本轮前一节的有效证据：原生76通过/1既有忽略、65格式兼容门禁、助手15覆盖测试及237不变量测试。没有以缓存结果替代新改动的L2/真实来源专项。
- 这里的每帧耗时和8/9仍是专项夹具数据，不能代替节目播放/来回拖动流畅度、整体命中率或导出耗时。冷页首播丢帧、600帧完整流水线、前台让出P95及压力释放仍未测；没有重新宣称1440p/4K画质验收。

### 明确下一步

1. `videoEditRenderer.ts`根render入口、NestedFrameContext、代码输入与滤镜相邻帧共享显式许可；持久在内存的lastPicture按许可和实际来源隔离，最终结果及嵌套画面传播实际来源。不能只给WebInputs传一个开关就上屏启用。
2. `videoEditWorker.ts`/`videoEditRenderTransport.ts`的普通渲染、快速预渲染上屏和回执一并传播；节目监视器明确放行，其余离屏消费者保持exact。现有`precision`诊断字段是GPU浮点精度，不可拿来混用网页来源许可。
3. `renderCacheStore.ts`、`videoEditRenderCache.ts`记录实际来源，并在精确读取、跳转常驻帧和预渲染快路中过滤网页缓存来源；旧条目缺provenance按live兼容。完成该传播块后才接03五项遗留，再依次useWebCache/精确导出顺手入缓存、显存压力释放、整体真机指标。

本轮在“跨窗口与段租约”及“取帧精度/来源边界”两个可独立验证的提交处收尾；完整19条仍未落实完。未降低设计或验证门槛。无新增需Claude把关的界面文案。任务分支本地提交、不push、不切分支、不合并；未用用户已登录浏览器/账号/外部聊天、9334或D:/视频制作工程，未执行install/ci/uninstall或删改联接点。外部写入仍仅本ticket/result.md，两个位置均追加保留历史。

## 续作（接手 Codex）：根/嵌套渲染与派生缓存的精度传播（2026-11-01）

接手 Codex 停下时留下的 13 个未提交文件：思路正确（显式精度参数逐层传递、实际来源随结果回传、派生预渲染按来源分文件），保留并做完；修正了节目监视器把暂停帧当精确消费方的判断，并按两轮独立审查补齐上屏来源记录。整票仍未完成；本节只交付精度/provenance 传播这一块。

### 实现与边界

- 渲染器 `render` 根入口新增 `precision`（缺省 exact），经 NestedFrameContext 传到嵌套序列、代码视频输入、滤镜相邻帧与网页输入；结果带实际 `provenance`，嵌套画面、代码输入与滤镜相邻帧任一来自网页缓存即标 web-cache。代码输入复用上一幅、预渲染窗口、跳转常驻关键帧、顺播排程、导出整帧窗口及起播预热都按精度过滤实际来源为网页缓存的画面；缺 provenance 的旧条目按 live 照常复用（条19）。
- Worker 普通路与队列外缓存快路都透传精度并回传来源；`readRgb`/`history` 一律强制 exact。顺播上屏通知按“画面来源+网页来源”去重。
- 节目监视器：播放、拖动、暂停放行 web-cache；选帧/封面（收集输出）与讲解录制用 exact。屏幕上画面的实际来源只认 Worker 上屏通知（后台补画的暂停帧没有回执）；进入选帧时屏幕是缓存来源且无在途请求就按精确来源重画，等待循环要求来源不是网页缓存。起播预热携带同一精度，不再因精度不一致丢弃重建。
- 预渲染：自动预渲染放行 web-cache、`render_video_edit_preview`（手动）保持 exact；提交按实际来源分文件（来源进入主进程缓存键），精确重渲染不会覆盖仍被播放持有的网页缓存派生文件；渲染层索引按窗口指纹+档案+来源。渲染条按节目语义显示 ready（含网页缓存派生预览），助手字段说明补写“手动渲染只认并只产出精确预览”。预渲染缓存在持久登记表中属可重建排除项，不升格式版本。
- 其余离屏消费者（跟踪、试渲染、预设预览、导出、多机位、源监视器、悬停缩略图等）全部走缺省 exact，已逐一 grep 核对调用点。

### 真实 GPU 专项与验证

- `node scripts/probe-video-edit-cache-precision.cjs`（本节修了夹具编码参数 `-g 2 -bf 0`、Worker 产物文件名匹配与纯色判别；它此前从未跑通）：退出0，证据 `.artifacts/web-cache-precision/2026-10-31T22-34-48-582Z/evidence.json`，日志 `.tmp-t14-takeover-precision-gpu.log`。RTX4090/驱动32.0.16.1047、Electron44.9.3/Chromium152.0.7977.167，本分支 `electron:bundle` 新产物，隔离 userData，未连 9334。正式 Worker+原生解码：web-cache 请求读网页缓存派生文件（红，provenance web-cache，含暂停拖动请求）；exact 请求跳过它现场合成（黑，live）；换成 live 派生文件及缺来源旧条目后 exact 正常复用（绿，renderCached）。每次读取约 2s 是隐藏窗口双 rAF 节流，不是性能数据。
- L2（异步状态、跨层回执契约、文件 I/O 原子提交）：显式15个本次文件 `npm run verify:changed -- --level L2 ...`，加9份直接消费者测试，退出0：9文件精确测试、ESLint、渲染/Electron 增量类型、界面静态门禁、依赖图、主进程传递导入。日志 `.tmp-t14-takeover-blockA-l2.log`；末轮小修后 VideoEditPreview 精确测试与 ESLint 复跑通过（`.tmp-t14-takeover-unit4.log`）。
- 独立审查2轮（全新上下文子代理，只给 diff、目标与 architecture/persistence 规则）：首轮重要2条——①后台补画的帧来源没记到节目画面，选帧可能截到缓存像素；②起播预热按 exact 建排程、播放按 web-cache 请求，每次起播丢弃重建——均已修；小问题（精度切换竞态、预热输入未带精度、readyEntry 缺省放行有损）均已修。第二轮确认已修并提出讲解录制期间预热仍重建的小问题，已改为统一实际请求精度。未发现原有问题。

### 余项

整票仍按原顺序：03 其余遗留（屏幕倍率离散迟滞、硬剪点预开、冷页首播、完整流水线）→ useWebCache（需先吸收 main 的持久格式版本再升版本）→ 显存压力释放 → 整体真机指标。播放/拖动流畅度、命中率、导出每帧耗时、冷页首播丢帧仍未测。

## 续作（接手 Codex）：合并 main、屏幕显示档位与硬剪点预开（2026-11-01）

- **合并 main**（`396ad8e73`）：吸收 main 74 个提交（持久格式已到剪辑内容 52、录制 55、导出预设 4，渲染器构造改为选项对象），为导出选项升版本做准备。冲突只在渲染器新增参数：`observeElements` 在前、网页缓存精度在后，各调用点与测试同步。双工程 tsc 与精度相关 8 份测试通过后提交。
- **屏幕实际倍率（03 遗留 / 条14）**：节目监视器用 ResizeObserver 的 device-pixel-content-box 取画面在屏幕上的物理像素，按相对序列尺寸选离散档位 1/0.75/0.5/0.25；只在越过相邻档约一成时换档（放大容忍约 5% 欠采样，缩小要再小约一成），首次与强制档位结束后不带迟滞。网页倍率取回放分辨率与显示档位的较小者（相乘会重复缩小）；导出、离屏、预渲染与悬停缩略图没有预览宽度，不受影响。选帧/封面与讲解录制强制档位 1，上屏按请求时的档位记录，选帧只收录按档位 1 请求的画面；合成里没有网页时不切档、不白重画。
- **硬剪点预开与冷页首播（03 遗留）**：顶层正向播放时，3 秒内将要出现的网页输入若与前一帧同源画面不连续（新片段、同源跳转、往回跳、前一帧画在预渲染文件里），提前开页面并预取第一幅，读取键与剪点帧一致，剪点帧直接复用；连续拆分、时间表同一段内（含停住、高倍快放）沿用原页面。只开本会话已确认过的来源（后台不弹确认），预取不计入任何一帧的必需额度；页面满额时只让最久没用的空闲页面让位，打开失败 3 秒内不重试。只读剪辑参数与已登记声明，不执行作者代码。视频与网页的“即将出现”每帧只扫描一次。
- 验证（L2：异步调度、生命周期、跨 Worker 契约）：显式9个本次文件 `verify:changed -- --level L2`，含6份直接消费者测试，退出0（精确测试、ESLint、渲染层增量类型、界面静态门禁、依赖图、主进程导入）；日志 `.tmp-t14-takeover-blockBC-l2.log`。新增测试：档位迟滞、渲染器显示档位只作用于预览且取较小值、节目档位切换重画与封面强制档位 1、跳转网页预开并在剪点复用、连续拆分不多开、时间表段内不预开且跳转前一帧开好。
- 独立审查3轮：首轮重要4条（选帧可取到低档画面、连续拆分仍多开页面、预开不受总页面上限、档位与回放比例相乘欠采样）全部修复；第二轮发现删掉旧判断后时间表网页每帧预开（重要），已改为按前一帧同源可见画面判断接续；第三轮无重要问题，提出的高倍快放与段内接续小问题已顺手修正。未修：清单只看片段参数与效果参数，网页若只来自代码素材声明默认值会被当成“没有网页”（原有清单范围，最坏是档位停在 1）。
- **未完成**：真实 Electron 的冷页首播丢帧对比（预热开/关、首3秒丢帧率下降≥30%）、屏幕档位的真机像素检查、完整取帧流水线 600 帧（1080p/4K 平均间隔≤10ms）均未测，放在整体真机验收；作者占位尺寸沿前文局部证据。

## 续作（接手 Codex）：导出“使用网页缓存”（2026-11-01）

- 导出设置 schema 新增可选 `useWebCache`（缺省 false）。界面导出面板“常规”区在“使用预览文件”下加一行开关，助手 `export_video_edit`/导出预设实体与界面共用同一 schema 与执行器（不另加工具，说明文字同步）。开启时导出渲染以 web-cache 精度请求网页画面：主进程按同内容、同尺寸、同采样网格、元素位置齐全才读缓存，缺失部分实时渲染并顺带登记补录需求；关闭时按精确渲染，连预渲染文件里用了网页缓存的部分也不复用（渲染器按精度过滤，见前节）。缺省值在设置解析、内置预设、“已修改”比对、批量导出、重试恢复各路径一致，旧文件按精确导出，行为不变。
- 导出阶段耗时日志 `video_edit.export.performance` 增加 `webCacheFrames/webCacheMs`（按网页画面来源计，与预览/现场合成两类相交）。
- 持久格式（只新增可选字段，最低可读版本不变）：剪辑内容 52→53、录制 55→56、导出预设 4→5、上次导出设置 2→3，逐版本迁移、黄金样本（生成器给导出记录与预设写入 `useWebCache: true`）、基线与发布承诺已更新；`check:persistence-compat` 66 格式通过。持久测试覆盖旧样本升级后缺省 false、新样本读回 true（含上次导出设置）。
- **待 Claude 把关的界面文案**（唯一新增界面行）：标签“使用网页缓存”；悬停“网页画面取自已录好的缓存，加快导出；与实时画面可能有细微差异，缺失部分实时渲染。”原候选“网页画面经过有损压缩”与已定的 4:4:4 无损编码（50 dB）不符，故改写；若坚持原候选请直接替换 `VideoEditExportFields.tsx` 该行 info。
- 验证：L2 显式14文件与7份直接消费者测试，退出0（精确测试、ESLint、双工程增量类型、界面静态门禁、登记格式与黄金样本基线）；日志 `.tmp-t14-takeover-blockE-l2.log`。`check:assistant-capabilities` 通过（`.tmp-t14-takeover-assistantE.log`）。新增测试：导出缺省精确、开启后整段按 web-cache 精度渲染；助手批量导出回读 useWebCache。
- 独立审查1轮（持久格式属高风险路径）：无重要问题；两条小问题（上次导出设置缺关键字段回读断言、网页缓存帧计数口径与预览计数相交）均已处理。
- 未完成：条10“导出精确取到的网格帧顺手写进缓存”未实施（精确导出的实时网页帧不是可靠快照路径产物，接入需要把导出取帧改走可靠快照与段发布，留作后续）；导出网页段每帧耗时真机数据未测。

## 续作（接手 Codex）：显存紧张时释放被抢占的补录会话（2026-11-01）

- 补录被本进程前台（播放、拖动、精确观察、导出）抢占时仍只停新提交、保留页面/读回器/编码会话以便续录；新增：抢占期间每 2 秒查原生解码服务的 DXGI 本机显存预算（`gpuLocalMemory.budgetBytes - currentUsageBytes`，预算随全系统占用收缩），余量不足 1 GiB 视为紧张，中止本录制组。组的既有清理关闭页面、读回器、编码器并删除临时目录、释放两级段锁与保留槽；该段按原优先级重新排队，不退槽、不冷却，前台结束前不再领取槽位，之后向前重演。查询带组信号与 2 秒超时，失败或非 Windows 按不紧张处理。
- 日志：`web_source.record.released`（info，含预算与占用字节）；主动中止的段改记 `web_source.record.cancelled`（info，含原因），不再与真实失败共用 `web_source.record.failed`。
- 验证：L2 显式4文件与4份直接消费者测试通过（精确测试、ESLint、Electron 增量类型）；日志 `.tmp-t14-takeover-blockF-l2.log`。新增调度测试：抢占中显存紧张时释放、段重排队不退槽、前台结束后重录该段。
- 独立审查1轮：无重要问题；小问题“显存查询无取消/超时会拖住组收尾”“释放被记成录制失败”已修。未修并如实记录：只看本进程前台，另一实例在前台时（本实例卡在跨实例额度等待）不查显存；单槽路径重建后从第 0 帧向前重演到段首（保留槽既有设计）；多槽组失败时已发布的段会整组重录（原有问题）。
- 未测：真实显存紧张场景（未人为制造显存压力），1 GiB 阈值尚无本机实测分布。

## 续作（接手 Codex）：整体真机验收（部分）与收尾（2026-11-01）

新增 `node scripts/probe-web-time-cache.cjs <ffmpeg> --acceptance-only=<宽>x<高>x<帧数>`（`scripts/lib/webTimeCacheAcceptanceProbe.ts`）：隔离 Electron、自造确定性网页（渐变、细线、随时刻变化的中文字），用正式 WebSourcePages/调度/读取链按序列 30fps 逐帧取实时画面（逐帧等待与两帧流水），登记补录并等全部段录完，再按播放语义（latest）读缓存，统计每帧耗时、命中、回退原因、补录进度与显存预算。**范围是主进程取帧到纹理交付，不含渲染层合成、物理上屏，也不是节目监视器播放流畅度。** 一次一个尺寸，守 180 秒单探针时限。RTX4090、Electron44.9.3/Chromium152、随包 FFmpeg，提交 `ddb91b383`；GPU 非独占（另有约 10% 占用）。

| 实测 | 1920×1080，300 帧 | 3840×2160，150 帧（缓存取预览档 2560×1440） |
| --- | --- | --- |
| 实时逐帧等待 均值/P50/P95 | 12.65 / 12.54 / 14.39 ms | 12.56 / 12.53 / 13.82 ms |
| 实时两帧流水 平均间隔（03 流水线指标） | **9.71 ms**，身份/来源 300/300 live | **8.75 ms**，150/150 |
| 网页缓存逐帧 均值/P50/P95，首帧 | 22.01 / 20.67 / 28.35 ms，首帧 176 ms | 31.86 / 31.22 / 39.19 ms，首帧 203 ms |
| 命中率 / 回退原因 | 300/300 命中，0 miss | 150/150 命中（此前一次同尺寸运行补录失败 1 段，读取全部 not-ready 回退实时；复跑未复现，原因未取到） |
| 补录进度（含多槽交叠锚点重录） | 99.1 s 发布 9 次，有效约 5.4 帧/秒 | 73.1 s 发布 5 次，约 4.1 帧/秒 |
| 显存预算（DXGI，原生服务） | budget 24.5 GB、自身占用 10 MB | 同量级 |

证据：`.artifacts/web-time-cache/2026-11-01T00-44-07-330Z/evidence.json`、`.artifacts/web-time-cache/2026-11-01T00-48-59-003Z/evidence.json`（另含失败的一次 `…00-47-09-049Z`），日志 `.tmp-t14-takeover-acceptance-1080.log`、`.tmp-t14-takeover-acceptance-4k.log`。

**结论（如实）**：两帧流水的实时取帧在 1080p/4K 都达到 03 的“平均间隔≤10ms”，但只测了 300/150 帧（设计要求约 600 帧，600 帧 1080p 整轮超过 180 秒时限，需拆开测）。**在这个轻量夹具上读网页缓存比实时取帧更慢**（1080p 22 ms 对 12.7 ms，4K 预览档 32 ms 对 12.6 ms）：实时路径交付的是 GPU 快照纹理，缓存路径要 HEVC 4:4:4 硬解再经 CUDA/D3D11 交付。缓存的收益只会出现在页面自身绘制/脚本很重、实时取帧远慢于此的场景，本轮没有重页面数据，**不能宣称“缓存补齐后与普通视频一样流畅”**。补录有效吞吐约 4–5 帧/秒，远低于早期裸读回编码吞吐（1440p 19.5 帧/秒），可靠快照、守护区与交叠锚点占了大头。

### 本次接手的整体状态

- 本轮提交（任务分支，未 push、未合并 main）：`e9e281472` 精度/来源传播 → `396ad8e73` 合并 main → `c61ad48f8` 屏幕显示档位与硬剪点预开 → `39a73916a` 导出“使用网页缓存” → `ddb91b383` 显存紧张释放 → 本节验收专项。
- 19 条：8（显式精度）、19（旧预渲染兼容）本轮完成传播与过滤；14（倍率离散迟滞）、10 的导出放行与显存紧张释放、条4/17 沿前轮；导出“精确网格帧顺手入缓存”（条10 后半）未做。其余条目沿前文各节证据。
- ticket03 五项：完整流水线（两帧流水间隔已达标，600 帧与 8K 未测）、屏幕实际倍率（已实现，未做真机像素检查）、作者占位尺寸（沿前文局部证据）、硬剪点预开（已实现，单测覆盖）、冷页首播（预开/预取已实现，**预热开关对比与首 3 秒丢帧率未测**）。

### 下一步（按优先级）

1. 重页面基准：用真实重网页（或《元宝搜索》网页素材只读副本）测实时与缓存每帧耗时；若缓存仍不占优，需要“实时足够快就不读缓存”的按来源判定（类似预渲染的 realtime 判定），这是设计方向问题，交 Claude 裁定。
2. 节目监视器端到端：播放/来回拖动丢帧与倒拖首幅、冷页首播预热开/关首 3 秒丢帧率、导出整帧耗时（渲染层合成），需要能挂网页代码素材的隔离 Reality 场景。
3. 补录吞吐：定位可靠快照路径每帧耗时（守护区回读、4:4:4 转换、交叠锚点重录）。
4. 600 帧拆分测量、8K 单列；导出精确网格帧顺手写缓存；查清 4K 偶发补录失败原因（本轮已让专项输出失败详情）。
5. Claude 把关导出行文案（见上一节）；Mac 未验证。

## 续作（Codex）：读路径剖析、自适应择优与重页面（2026-11-01）
摘要：段锁持有期复用清单/几何、只刷新一次 LRU；节目上屏已按页面实测择优，导出悬停文案按最终裁定替换。
摘要：轻页缓存 1080p 22.01→12.32 ms、4K预览档31.86→15.22 ms；4K自适应最终11.80 ms（150/150实时），重页实时291.48→缓存10.46 ms。
摘要：整票仍在继续；原生4K强制缓存尚未不慢于实时，600帧、节目上屏/冷页/整帧导出/真实显存压力、4K旧失败归因与精确导出顺手入缓存待后续。

- 接手的5个未提交文件方向正确，保留并完成。原读取每帧 readFile/stat/utimes；现在清单和几何跟随内核段锁持有，只取得段锁时读取，切段/失败/空闲释放后重新读取。共享解码、取消、几何缺失、内容/环境/设备失效路径沿原有约束。
- 新增内部 cachePolicy='adaptive'，只由节目预览渲染上下文传入并传播嵌套输入；精确请求不读缓存，导出/自动预渲染不传此策略。按页面stream、内容、scale、latest、网格、boxes学习，不跨内容或尺寸混用；初始实时4帧，足够快（≤序列半帧预算）直接实时并持续滑动更新。实时变慢才采样缓存；均值用0.25 EWMA与5%迟滞，慢路径每120请求以5帧小组重测另一条路径，首幅预热不计均值。日志web_source.cache.selection记录原因和两路均值。
- 隔离专项仍沿scripts/probe-web-time-cache.cjs，增加分阶段计时、真正只读复用缓存、重页面夹具与日志分页，未使用9334、用户浏览器/账号或用户工程。无依赖变更。重页面为144卡片/1728滤镜柱条，每次seek确定性修改几何、文字与滤镜，不用空转延时制造负载。
- 1080p300帧：实时12.27，缓存12.32/P50 11.27/P95 16.40ms，首幅182.76ms；300/300命中。证据.artifacts/web-time-cache/2026-11-01T04-13-47-976Z/evidence.json；此次复用仍触发重录，后已修探针只读模式。
- 4K150帧（缓存2560×1440）：实时12.42，缓存15.22/P50 14.63/P95 23.20ms，150/150命中；证据…/2026-11-01T04-16-17-827Z/evidence.json。原生decodeMs均值13.87ms，sharedTexture导入0.076、发送0.576、绘制0.181ms；文件操作已按段计，剩余主要在硬解。1080p原生decodeMs 8.46ms。两种随包FFmpeg硬解入口对同1440p段600帧，native hevc+CUDA 6.449s、hevc_cuvid 6.776s，未证明换入口有收益，未改原生路线。
- 4K自适应最终复验（排除足够快页面的冷缓存试探）：实时12.63、强制缓存15.14、自适应11.80/P50按证据文件；自适应150/150实时，reason=live-fast-enough。证据…/2026-11-01T04-28-50-508Z/evidence.json，日志.tmp-t14-adaptive-4k-final.log。前一版9次缓存试探使均值14.75ms，已纠正，不作为最终通过数据。
- 重页1080p90帧：实时均值291.48/P50 277.89/P95 353.89；缓存10.46/P50 7.72/P95 13.78ms（首幅196.96ms，90/90缓存）；自适应20.23/P50 7.55ms，4帧实时采样+86帧缓存。补录93.79s、发布3次（有效2段），失败0；证据…/2026-11-01T04-22-37-038Z/evidence.json。该轮早于“连续5帧反向探测”修正，但90帧未触发120请求周期；初始择优路径相同。仅为主进程取帧至Canvas2D消费，非节目合成/物理上屏或整帧导出结论。
- 环境RTX4090/驱动610.47、Electron44.9.3/Chromium152、随包FFmpeg9；系统其他GPU活动仍存在（采样19%），不是独占显卡基准。性能探针由源码当次esbuild构建隔离入口，未借用旧out运行。
- L2依据：文件I/O、异步状态、跨层请求契约。160项直接消费者测试（reader/readTiming/pages/WebInputs/Renderer）通过；增量后readTiming/pages/pages.registration 5项通过。双工程按指定8GiB tsc通过，探针strict独立类型通过；文件级ESLint/CJS语法/git diff --check通过；check:dependency-graph与check:main-imports通过。日志见.tmp-t14-adaptive-unit.log、.tmp-t14-adaptive-final-unit.log、.tmp-t14-reader-*-types*.log、.tmp-t14-reader-*-imports.log、.tmp-t14-reader-dependencies.log。
- 独立审查2轮：首轮重要1项“周期单帧探测受解码器3秒空闲释放污染”已修为连续5帧并排除首幅；第二轮增量未发现新增问题。实际排查段锁/清单缓存、跨段、跨窗口、取消、设备代次、精确与导出调用边界；未把这些局部通过当整票验收。
- 导出行唯一界面变动：悬停改为“网页画面取自已录好的缓存，导出更快；缓存缺失的部分实时渲染。”无需外部Claude复核，该文案已由review.md裁定。


## 续作（Claude 接手，11-01 15:40）：精确导出顺手写缓存——导出卡死已修，实探卡住待查

摘要：Codex 额度用尽时第 5 步“精确导出取到的帧写进缓存”已写完未提交（exportWriter 等 17 个文件）；接手后补跑真实专项发现导出逐帧卡死，已修。
摘要：卡死根因是导出写入器在取帧路径上同步等待硬件链路实探；实探在导出进行中一直不返回，导出 Worker 的 render 45 秒超时。
摘要：实探本身为何在导出期间不返回仍未查清（见下），本节交回 Codex。

- 修：`exportWriter.open` 不再等实探——能力未知时后台发起 `capability.check()`、本幅照常实时取帧；没开成的会话不记住，下一段首帧再试。新增单测（实探未完成时本幅实时、实探通过后下一段写入）。
- 修：`probeWebCacheHardware` 每一步硬件操作单独限时 30 秒（排队暂停不计入，沿用编码步骤的既有做法），等交付也限时；卡住时按 probe-failed 冷却 30 秒重试，不让在途屏障永远挡住录制与导出写入。
- 专项 `scripts/probe-web-time-export.cjs`：补上片段工厂需要的源码检查结果、清理步骤不再掩盖真实错误、失败时转存 main.web_source 日志；改为两遍导出——第一遍后最多等 120 秒实探结论，再导第二遍检查写缓存。`PROBE_NO_CACHE=1` 可关掉写缓存对照。
- 现象（仍未解决）：两遍导出各 60 帧都完成且全为实时帧；但 `web_source.capability.start` 在同一代次（generation 0）0.8 秒内出现两次，之后 120 秒既无 completed 也无 failed——即使每步已限时 30 秒。说明两次实探同时在跑（疑似主进程里有两个能力门实例：打包后模块重复，或调度器与写入器各自取到不同实例），且卡在限时步骤之外（目录创建、GpuFrameCapture 构造或 VideoFrameBridge 同名路由 `web-cache-capability` 冲突）。
- 证据：`.artifacts/web-time-export/2026-11-01T07-31-*`；日志在 Claude 会话 scratchpad。验证：web-source 18 个测试文件、exportWriter 2 项、双工程 tsc 通过。
- 交回 Codex：查清两次实探与卡住位置，让专项第二遍出现 `web_source.export_cache.completed`；之后再做 600 帧、节目上屏/冷页、整帧导出、真实显存紧张与 4K 偶发补录失败归因，最后合 main。

## 续作（Claude 接手，11-01 19:40）：实探修好、写缓存跑通、合入 main

摘要：Codex 修好硬件实探启动（c387b116b，reader 在 DOM 就绪后再建）；接手后补完默认 DPI 下纹理多一像素的边界、修好一处会让应用 preload 整个失效的打包问题，并合入 main。
摘要：精确导出两遍各 60 帧：第一遍实时 P50 7.6 ms、后台实探约 1.4 秒通过；第二遍写缓存 P50 14.9 ms，web_source.export_cache.completed。节目上屏（自造页面，预开）三轮：冷启动丢 3/90、之后 0/90，剪点后首个有效帧冷 358 ms、热约 167 ms。
摘要：未测：约 600 帧整轮、真实显存紧张（专项 --memory-pressure-only 的合成场景里补录调度没启动，未查）、4K 偶发补录失败归因、重页面节目上屏。

- 根因修复：取帧 preload 引入应用 preload 的模块后打包拆出共享文件，沙箱 preload 加载不了，应用 preload 整个失败（window.henjiNative 消失）。取帧 preload 改为自己构造帧视图；electron.vite.config 加守卫，preload 拆出共享文件即构建失败。
- 合入 main：网页快照脚本同时带 ticket 18 的文字几何采样与本票的身份区（文字先采样、画面提交后复核同步，身份区原像素随结果返回）；要文字几何的请求不走缓存读取与导出写缓存（缓存帧不带文字）；读取键在要文字时区分预览档与所选文字。
- 持久格式按 main 再升：剪辑 59（最低可读 58）、录制 62（最低可读 61）；导出预设 5、上次导出设置 3 与 main 不冲突。样本、基线与发布快照按 main 生成。
- 验证：双工程 tsc；web-source、web-replay、preload、网页输入、渲染器、渲染会话、持久格式、导出 53 个测试文件；check:assistant-capabilities、输出契约、网页文字几何；electron:bundle 后导出专项通过。
