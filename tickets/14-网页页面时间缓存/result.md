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
