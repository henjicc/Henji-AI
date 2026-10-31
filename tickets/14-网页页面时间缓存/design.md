摘要：网页按页面时间录为约 2 秒的独立 MP4/HEVC 闭合 GOP 分段；复用内容指纹、原生硬件解码与作品缓存管理，剪辑代码变化不删除网页缓存。
摘要：补录由可抢占的 GPU 调度协调，优先保证播放、拖动和导出；缺段继续执行 ticket 03 的非阻塞取帧，五项遗留分别闭环。
摘要：本文件为待 Claude 与审查员批准的技术设计；本轮只写本文，未实现、未做性能验收、未连接 9334，原生纹理编码与精度边界需批准。

# 14 · 网页页面时间缓存

## 1. 基线、范围与现状

- 设计基线：`D:/VibeCode/Henji-AI-t14`，分支 `task/14-网页页面时间缓存`，HEAD `a05191f9d`；检查时与本机 `main` 相同，工作区干净。未执行 pull/rebase，也未断言已经核对远端最新提交。
- 依据：[本 ticket 计划](plan.md)、[ticket 03 结果](../03-网页取帧不阻塞与倍率跟随/result.md)、[以后再做第 6、7、12 项](../../../Henji-AI-t14/docs/task/代码效果与渲染改进/以后再做.md)。本文的数值验收阈值是拟定交付标准，不是已测结果。
- 本轮只读代码、规则和官方资料，仅用 `nvidia-smi --query-gpu=name,driver_version,memory.total --format=csv,noheader` 查询到 RTX 4090、驱动 610.47、24564 MiB；未编码、未解码、未运行 Electron 或 CPU/GPU 负载探针。没有读取 `D:/视频制作`，没有操作 9334，没有写入联接点 `node_modules`。
- 既有网页契约是 `henjiWeb.ready / seek(seconds) / duration / boxes`；当前 `WebSourceInfo` 没有页面帧率。不能把序列帧号、网页请求票据或纹理捕获时间戳当成页面帧号。
- ticket 03 已有：根帧共享截止时间、播放和拖动超预算回退、暂停精确等待、同帧异时刻分槽、取消与迟到释放、内容变化通知、倍率调整、较高 DPR 首次重建。仍缺完整多帧出画流水线、屏幕实际尺寸参与倍率、作者物理占位尺寸、剪点预热、冷页首播优化。
- 缓存属于网页输入层，不缓存最终合成，也不实现 ticket 15 的代码输出缓存。代码片段、滤镜输入、嵌套序列与观察入口共用同一网页输入策略。

## 2. 分层与编码选型

| 层 | 决定与边界 |
| --- | --- |
| 纯契约 | 在 `src/core/videoEdit/` 定义页面采样网格、分段描述、内容身份、画面来源精度；只依赖纯类型与计算。 |
| 主进程领域服务 | 在 `electron/main/services/web-source/` 增加时间缓存协调服务，拥有索引、补录队列、内容代次、段租约、发布与回收；不在主线程散列全量大文件或转换像素。 |
| 页面进程 | 复用 `WebSourcePage`，每个录制槽独立离屏页面/分区，执行 seek 和快照。缓存补录不借用节目正在使用的页面，不修改其时间。 |
| 编码进程 | Windows 首选现有原生视频服务二进制的独立编码工作进程；新增职责明确的 encode 模块，复用 FFmpeg 共享库、D3D11 设备及协议设施。与实时解码进程分开，取消后台编码不杀播放解码器。 |
| 消费方 | `VideoEditWebInputs.picture` 统一决定缓存或实时来源；渲染 Worker 经既有帧通道访问主进程，命中后经 `openDecoder / frameAt / schedule` 取得原生帧。 |
| 管理与调用 | 使用现有媒体缓存设置、占用、清理入口；补录是内部派生任务，不新增一组“开页/编码/提交文件”MCP 工具。导出选项只扩展现有导出 schema 和执行入口。 |

编码选型决定：使用成熟 FFmpeg 的 `hevc_nvenc`，通过 libavcodec/libavformat 编码和封装，不自研编码器、不手工拼 MP4。现有 `videoEditExportEncoderConfig.ts` 使用 WebCodecs/Mediabunny，可以请求硬件偏好，但不能指定 NVENC 厂商，也没有原生 GOP 全部参数；不把 `prefer-hardware` 当成 NVENC 的证明。[WebCodecs 规范](https://www.w3.org/TR/webcodecs/)提供的是编解码抽象和硬件偏好。

现有网页重演 `FrameEncoder` 走 CPU 字节管道和 H.264；现有剪辑导出走 WebCodecs。两者都不是可直接接收网页共享 D3D11 纹理的 NVENC 服务。8K RGBA 一帧 132,710,400 字节，60fps 约 7.96 GB/s，仅把整帧读回 CPU 再上传就有额外带宽和内存成本。因此本设计选择新增原生纹理输入适配，代价是原生协议、资源生命周期和构建产物需要验证；这是批准前的主要技术决定。

Windows 编码数据流：离屏共享纹理 → 宿主验证捕获帧身份 → 将纹理句柄复制到编码进程 → 同 adapter 打开纹理、GPU 裁去守护区并复制到编码器持有的表面 → FFmpeg `AV_PIX_FMT_D3D11` → NVENC → MP4 临时文件。控制通道只传句柄、同步/释放信息和元数据，不传整幅 RGBA。Chromium 纹理在原生端完成读取/复制后才 release；编码表面在编码器消费后才复用。对设备 adapter、共享句柄类型、帧完成信号逐项探测，不凭 `paint` 回调到达推断其他 GPU 队列已完成。[FFmpeg NVENC 实现](https://raw.githubusercontent.com/FFmpeg/FFmpeg/master/libavcodec/nvenc.c)支持 D3D11 硬件帧输入；本仓库尚无反向输入桥，接通后的成本和同步正确性仍待实机证明。

本 ticket 的首发性能承诺限定 Windows/NVIDIA；设备不支持所需 HEVC 档案或原生桥不可用时，该档不补录，网页仍走实时路径。不能自动把 8K 缩成 4K 并登记成原档命中，不能后台静默切 CPU 高负载编码。其他厂商、macOS 保持现有网页行为；扩展 QSV/AMF/VideoToolbox 属于后续同契约后端，不在本设计里宣称已经具备。是否把这些后端列入本 ticket，由 Claude 确定。

## 3. 时间网格、分段格式与编码

### 3.1 页面时间域

- 每份缓存有采样率有理数 `F = numerator / denominator`。当前页面未声明 fps，因此初始采用请求方已解析的序列/输出有理帧率，称为“页面缓存采样率”；同一网页可以有多个 F 变体。不得把它宣传为探测到的页面原生帧率，也不新增作者必填字段。29.97/59.94 按 30000/1001、60000/1001 保存。
- 绝对页面采样点 `t(n) = n × denominator / numerator`，n 为非负整数。段长帧数 `N = max(1, round(2F))`；段 k 覆盖帧 `[kN, (k+1)N)`，约两秒。59.94fps 的 120 帧是 2.002 秒，不能一边用 120 帧、一边用精确两秒计算段号。
- 每段是可单独打开的 MP4：本地 PTS 从 0 开始，time_base 为 `denominator/numerator`，清单保存绝对起始帧与实际帧数。末段截到页面 duration，未知 duration 只录已请求段和相邻段，不创建无限队列。页面显式请求 duration 端点时遵循现有实时语义，不拿最后一帧伪装端点。
- 连续/倒放/变速/时间重映射只改变请求的页面秒数。精确消费要求落在缓存采样网格上，只容忍数值运算舍入误差；任意小数秒、时间重映射的非网格采样和运动模糊子帧回退实时。播放/拖动可以用不晚于请求的最近网格帧，误差小于 1/F，必须传播时间近似标记。

### 3.2 编码配置

| 项目 | 决定 |
| --- | --- |
| 容器 | 独立 `.mp4`，无音轨；每段有自身解码配置和尾部索引，段间不依赖。暂不做 HLS/DASH，也不拼成一个不断增长的长文件。 |
| 编码 | HEVC Main、8-bit、4:2:0，Windows 用 `hevc_nvenc`；与当前网页 `rgba8unorm` 输入匹配。10-bit 不会恢复网页已经没有的精度，本 ticket 不把它当作画质承诺。 |
| 起始质量 | `preset=p5, tune=hq, rc=vbr, cq=16, b=0`，关闭 lookahead、B 帧；这是首个实机候选，不是“所有网页视觉无损”的保证。高饱和彩字、细线和渐变必须通过画质门槛；不通过时调整同一档案并重测，不静默降低验收。 |
| 随机访问 | 文件约 2 秒；段内 IDR 间距约 0.5 秒，`g=max(1, round(F/2)), bf=0, forced-idr=1, flags=+cgop`，禁用非预期场景切换。每段新建编码上下文，首帧强制 IDR，跨段没有参考帧；比单个两秒 GOP 少解约四倍前置帧，代价是文件增大。 |
| 校验 | 验证首 NAL 为 IDR、参数集存在、无跨段引用、帧数和 PTS 连续；仅 `pict_type=I` 不足以证明闭合 GOP。使用随包 FFmpeg 的实际参数/输出验证，不照搬网上其他版本参数。 |
| 色彩 | 明确从网页显示 RGB 到 BT.709 YUV limited 的转换并写入正确 VUI/container 标记；保持当前捕获的显示外观，不把 sRGB 数值直接贴上不相容标签。解码后经现有色彩转换回合成空间；使用色卡测量 RGB→YUV→RGB，避免误复用网页重演的 BT.601 标记。 |
| 尺寸 | 有效尺寸保持 `codeWebPixelSize`；4:2:0 需要偶数编码尺寸时只向右/下 padding，清单记录有效矩形，读回裁掉 padding，不裁掉页面内容。 |
| 透明与 HDR | 当前网页快照输出为 opaque RGBA8；HEVC 档不承载 alpha/HDR。若现有/后续分支确实交付透明或高精度页面，必须记录不兼容并实时取帧，不丢 alpha、不降精度冒充命中。 |

[FFmpeg HEVC NVENC 参数](https://raw.githubusercontent.com/FFmpeg/FFmpeg/master/libavcodec/nvenc_hevc.c)与 [NVENC 编程指南](https://docs.nvidia.com/video-technologies/video-codec-sdk/13.0/nvenc-video-encoder-api-prog-guide/index.html)是参数、设备能力和纹理输入依据。配置里的低延迟取舍用于减少后台在途工作；不以“NVENC 是独立单元”推断没有显存、复制、栅格或合成争用。

原生 RGB→NV12 首选系统 D3D11 Video Processor，显式设置输入/输出色彩空间并探测格式转换支持，使用 [VideoProcessorBlt](https://learn.microsoft.com/en-us/windows/win32/api/d3d11/nf-d3d11-id3d11videocontext-videoprocessorblt)、[输入色彩设置](https://learn.microsoft.com/en-us/windows/win32/api/d3d11_1/nf-d3d11_1-id3d11videocontext1-videoprocessorsetstreamcolorspace1)与[输出色彩设置](https://learn.microsoft.com/en-us/windows/win32/api/d3d11_1/nf-d3d11_1-id3d11videocontext1-videoprocessorsetoutputcolorspace1)。只把已转换的 NV12 表面交给 NVENC；不依赖其 RGB 隐式转换再补 BT.709 标签。该格式对在目标 adapter 不支持或色卡往返不通过时，该编码后端不可用，保留实时路径；不临时手写另一套色彩算法。

### 3.3 8K

- 1920×1080 全视口 scale=4 为 7680×4320；scale=3 为 5760×3240。选择 HEVC，不把 H.264 当作可移植的 8K 路径。
- 8K60 对应约 1.991G luma samples/s，编码 level 至少覆盖这一吞吐（通常 HEVC Level 6.1；tier 另受实际码率约束）。不只按宽高探测，必须以实际 fps、像素格式、profile、码率及硬解能力做短段往返。
- 能力缓存按 GPU adapter、驱动、FFmpeg 构建和编码配置区分；显卡型号查询不等于成功编码。段独立开解码器后的真实硬解、首帧、段尾和倒拖均要通过。
- 一幅 8K RGBA 约 126.6 MiB，NV12 约 47.5 MiB；四幅 RGBA 已约 506.3 MiB。录制槽计入浏览器输出、复制中纹理、编码输入表面、DPB 与共享句柄，不能只统计 JS 持有纹理。8K 从一个录制槽、两幅在途开始，自适应增加需有净收益和资源余量；不按 CPU 核数直接开页面。
- 缓存保存声明所需的最高取景倍率；屏幕预览更低倍率可从同 region 的高档缓存下采样。不同 DPR 可能改变页面 canvas 栅格，降采样不等同于低 DPR 重新执行，因此精确来源匹配另检查栅格环境。

## 4. 缓存键、元数据与失效

### 4.1 两层身份

语义键 `sourceKey = SHA256(canonical([contentHash, viewportCss, regionCss, rasterScale, pageDeviceScale, F]))`。viewport 是排版视口，region 是实际取景，不能只存输出宽高。`pageDeviceScale` 是页内实际 devicePixelRatio；03 的页面可能保留已达到的较高 DPR，因此它不能被请求 scale 隐式代替。后台每档以固定 DPR 开页，实时精确消费者的 DPR 不一致时不能声称像素相同。

物理变体键增加 `captureContractVersion、Chromium/capture 环境签名、codecProfile、编码尺寸/有效矩形、色彩契约、encoderProfile`；段键再增加 `startFrame、frameCount`。实际位流/hash、帧数、bytes、环境签名均落清单。格式/栅格契约确实改变时建立新变体；不把整个应用版本、Git commit 或工程 revision 塞进键。

绝不进入语义键：片段 ID、代码文本/版本、spans、花字、转场、镜头变换、时间线位置、序列 revision、预渲染 windowKey。只改变这些内容且请求同一页面时间/取景，必须复用旧段。页面内容、视口、取景、采样率或所需清晰度变化是新内容/变体，旧段可留待清理；“只在网页内容变时失效”指不被无关剪辑修改误伤，并不允许错误规格共用。

路径负责解析来源、监视和信任上下文，不作为跨作品可执行授权；同内容在当前作品缓存域可复用。只有符合页面绝对 seek 契约、资源内容稳定的页面才能持久命中：依赖实时网络、时钟、随机数、会话存储或可变外部字体而未被内容快照覆盖时，内容指纹不足以证明相同。此类来源保留实时路径，记录不可稳定缓存原因；不新增执行权限或审批。通过宿主已有请求/资源信息识别可变依赖；无法证明封闭时不宣称持久缓存可靠。

### 4.2 内容一致性

- 复用 `WebSourceContent` 和 `videoEditWebContentIdentity` 维护内容事实，不增加渲染层自己的第二套文件散列。
- 当前 `site.ts` 按文件 size/mtime 缓存 hash；实现阶段要在观察到写入时作对应 hash 失效，首次持久复用及补录批次使用稳定文件清单复核。保留 mtime 的同长度覆盖不能复用旧 hash。流式散列移到 Worker/后台 I/O，完成后在主进程比较代次。
- 文件变化先标记来源 dirty 并中止新持久命中，300ms 去抖后的真实 hash 决定是否换代。触碰文件但字节未变恢复原键；新内容取消旧补录、精确等待和旧读提交。迟到结果只有同 content generation 才能发布。
- 批次开始持有稳定资源快照，由现有站点文件枚举/读取服务建立内部只读快照并核对 hash；补录页面从该快照供给，避免录出新旧文件混合的一段。快照在缓存域，不能放进网页根引发自我失效。发布前复核来源仍对应原代次，变化则丢弃本次结果。
- 内容暂时读不出/监视失败时，既有上一幅只可作近似预览；不把旧 hash 当成新补录与精确导出有效性的证明。恢复后重查当前身份，未完成段重排，不重放已完成业务写入。

### 4.3 清单与发布

每段使用固定 schema 的 JSON 清单及同键 MP4，包含：格式版本、sourceKey/variantKey、内容 hash、CSS 视口/取景、rasterScale/DPR、采样率分子分母、绝对起始帧/帧数、有效/编码尺寸、codec/profile/色彩/压缩品质、duration、媒体 SHA256/bytes、捕获环境、选择器元数据索引。清单的全部路径以缓存服务解析，不由作者提交任意成品文件替代。

状态为 `missing → queued → recording → validating → ready`；抢占回到 queued，取消结束，失败带原因等待下一次有效需求/恢复事件，不无限立即重试。发布顺序是关闭/flush 编码器 → 完整性验证 → 原子 adopt MP4 → 原子写 ready 清单。读者只认完整清单且媒体匹配的段；崩溃在任一步留下的半段/孤儿都视为 miss。使用段租约防止两个实例重复发布，旧代次无权覆盖新段。

## 5. 调度、让出与多进程

### 5.1 需求及补录顺序

- 从正式网页输入请求登记页面时间需求，并关联所在作品/序列的可见使用者；不扫描执行任意作者代码去猜全部时间映射。可静态解析的后续片段只提供预热提示，不成为内容真相。
- 空闲先补当前/最近请求缺段与前后邻段，再补已知引用范围，再按页面时间顺序补有限 duration。没有已知 duration 时只扩展实际需要的范围。
- 每个录制槽固定一个来源/规格，隐藏推进到区间首，再逐采样点 seek/取帧；接着分配相邻段，避免每两秒都从 0 重推。多槽领取互不重叠的连续区间，分区和页面时间独立，发布仍按绝对段索引。
- 100 秒隐藏推进约 1 秒是旧页面记录，不是通用上界；阶段日志分别记录开页、ready、快进、paint、纹理交接、编码和写盘。页面自己的远跳慢时降低并发/连续领段，不增加 seek 超时掩盖。
- 自适应从单槽起，比较增加一个槽后的有效帧吞吐、GPU 排队、显存和前台延迟，收益不足即缩回；实际资源能力决定同时运行数，待办数量和来源数量不设任意硬上限。

### 5.2 共用资源仲裁

把现有 `videoEditRenderCache.ts::watchProgramActivity` 的活动事实接到主进程统一资源协调器，预渲染和网页补录不能各自判断“我的界面空闲”。活动优先级：交互播放/拖动/精确观察最高；前台导出和用户主动预渲染高于自动补录；自动最终预渲染与网页补录共用后台资源额度。

- 交互开始立即撤销后台的提交许可，不等一个两秒段录完；停止新的 seek、paint、纹理复制和编码入队，最多排空当前不可中断的原生调用/GPU 提交。释放页面和编码表面，未完成段丢弃后重录，已完成段保留。重 JS 卡住时销毁专属后台页面，不杀节目页。
- 导出期间暂停自动补录；命中段可解码，缺段由导出自己的精确实时取帧完成，不边导出边拉起另一路自动录制。前台导出保持既有交互让出策略，不能被新增后台队列倒置优先级。
- 自动最终预渲染若确实依赖缺失网页段，可把同一后台许可交给该段补录后继续；不在占着 GPU 许可时等待另一个拿不到许可的任务。对 off-grid 请求、不可缓存页或补录失败，最终预渲染走实时精确取帧。两类后台任务按有效进度轮转，不能让整页补齐阻塞全部预渲染。
- 首版复用现有约 10 秒交互空闲窗口和恢复迟滞；播放/拖动/跳转/导出期间不靠 `requestIdleCallback` 判断 GPU 空闲。暂停画面取精确帧尚未完成也算前台活动。
- 额度覆盖栅格、显存、复制、NVENC 与 NVDEC；补录降为 0 后才算让出，单独降低 CPU 进程优先级不算实现。

### 5.3 开发版与其他实例

同一用户、同一 GPU adapter 的 Henji 实例通过本机资源协调通道共享活动租约；使用操作系统命名管道/本地 socket 与进程所有权，不占 CDP 或固定 TCP 端口，不改权限模型。段写租约按缓存根/段键区分，GPU 活动租约跨作品根生效。协调者退出后各实例先停后台提交，重新选主并核对存活 PID；过期心跳不足以证明仍存活的进程已释放 GPU。

新版开发版播放也发前台活动租约，后台补录立即让出。遇到未接入协调器的旧 Henji 实例，不能声称已经感知其播放状态；保守暂停自动补录并记日志，不连接、控制或终止旧实例。OS/GPU 利用率只作为压力信号，不能替代可靠活动租约。本轮及后续验收均不对 9334 做状态切换；跨实例让出用两个隔离测试实例证明。

## 6. 缓存读回、精度及缺段

命中顺序为：同身份已驻留的输入帧 → 匹配段的原生解码帧 → 实时网页。下一段提前开原生解码会话，倒拖只需从段内最近 IDR 解码；关闭/换源/内容变动/设备丢失按原有帧通道归还所有迟到帧。两个消费时刻可以读取同一 MP4，但各自的解码调度和票据独立；不能让同一个 seek 状态互相倒跳。

读回路径：`VideoEditWebInputs` → 帧通道 PAL/preload → `VideoDecoderService` → FFmpeg HEVC/D3D11VA → 共享 NV12/BGRA 帧 → 既有合成器色彩转换和纹理。不会新增 `<video>` 或 Worker `fetch(裸路径)` 的旁路。缓存服务给主进程/原生解码器真实文件路径；若其他展示消费方需要 URL，仅在对应边界用现有媒体 URL 转换。

缓存帧保留与实时网页一致的 `web` 信息：CSS 视口、region、实际 rasterScale、真实采样页面时间、duration、请求的 boxes。`boxes` 独立于视频编码存逐帧元数据，键包含来源变体、页面帧和 selector；新增 selector 不使视频失效，后台可补元数据。需要的几何不完整时精确消费者回退同刻实时取整套画面/几何，不拿另一时刻或另一 DPR 的 boxes 拼接；`null` 只表示该帧确实不存在该元素，不能表示尚未测量。

| 消费情境 | 行为与精度 |
| --- | --- |
| 播放、拖动 | 缓存查找和解码与实时回退共用根帧截止时间；到期使用同来源/规格上一幅，尚无画面用透明占位。latest 仅保留最新未开始目标。冷段查磁盘不能耗掉预算后再给实时路径另起完整预算。 |
| 暂停、松手补帧 | 同网格、足清晰度且元数据齐全可直接显示缓存；压缩精度有损但时间准确。非网格/低档回退实时指定时刻，取消立即结束等待。 |
| 精确观察/像素验收 | 指定实时模式，绕过网页有损缓存；不能以压缩后相似度冒充原画面真值。 |
| 内容变化 | 当前请求换 generation；旧帧仅短暂近似展示，不得写入 ready 或伪装新内容。 |
| 段损坏、丢失、被清理、硬解失败 | 记录具体 miss 原因，回退实时；损坏段退出索引后可补录。硬解不支持不在前台循环重试该档案。 |

画面来源携带两类独立事实：时间/清晰度近似，以及压缩精度来源。前者继续触发 03 的 `approximate` 排除，不能进入“已精确完成”的最终帧缓存；同网格高档 HEVC 帧不因“有损”永久被当成未完成。后者进入最终预渲染与内存帧缓存的 provenance，精确导出/观察可以拒绝它。命中缓存不跳过外来代码的既有信任决策；尤其缺段自动补录属于执行，不能以后台任务为由代替用户确认。

## 7. 导出可选缓存

- 增加现有导出设置的可选字段 `useWebCache`，缺省 false；同一 schema 进入 UI、导出队列和正式应用能力，不增加同义专用工具。UI 实现阶段沿现有导出选项布局与 henji-ui-surface 规范处理。
- 开启后只接受：当前内容、足够的取景分辨率、匹配页面采样点、完整 boxes 和已验证色彩档案；缺段实时补足。不会为了导出把页面时间 round 到近邻帧。音轨与最终合成仍走既有管线。
- 说明只保留精度决策必要信息：“使用网页缓存加快导出；画面经过有损压缩，缺失部分实时渲染。”所谓视觉无损是验收目标；4:2:0 彩字损失、量化、编码后的再次编码都可能改变像素，提高码率不等于无损。
- `useWebCache=false` 时，除了网页输入，内存最终帧/最终预渲染也必须拒绝含网页缓存来源的画面。`usePreviews=true` 仍可复用符合其契约且未含网页缓存的预渲染；旧预渲染缺 provenance 时不能推断满足“实时网页”。两项均 false 才是绕过两类有损缓存的逐帧实时导出。
- 最终渲染键/元数据记录是否允许网页缓存和实际来源品质，防止缓存模式产物污染实时模式。源码缓存 key 本身不受导出开关影响。
- 新字段若进入已有导出预设/项目持久 schema，则对应登记格式升版本、逐版本迁移、黄金样本；只新增可选字段不提高最低可读版本，旧数据按 false。具体版本在实施时从 `formats.ts` 的当时基线递增，不在本设计硬钉会与并行任务冲突的版本号。

## 8. ticket 03 五项遗留的收口

| 遗留 | 决定 | 闭环证据 |
| --- | --- | --- |
| 完整取帧流水线 | 保留 seek 顺序，但允许帧 n 的纹理交接/编码与 n+1 的页面推进/快照重叠。帧身份来自与画面同次 GPU 绘制的画面外守护区；复用网页重演的 captureToken 思路和现有帧通道，不靠到达顺序或未经校准的 timestamp 常数。守护区承载 generation+frameIndex+校验，GPU 只读回小块身份；可见区不带编号。若 Chromium 合帧，缺的帧重新精确 seek/捕获，整段帧数补齐才发布；不复制上一帧补洞。 | 人为合帧、乱序、丢帧、reload/resize/取消时均不对错号，捕获画面中的可读页时钟与清单逐帧一致。1080p/4K 单独测 steady-state 吞吐，目标接近历史 6.5–7ms/帧；同时记录延迟，不拿多进程总吞吐替代单页流水线目标。 |
| 按屏幕实际尺寸定倍率 | 从节目监视器实际内容矩形（含 fit/letterbox、zoom、pan）、DPR 和预览分辨率档派生输出像素需求，传入既有 outputScale；当前渲染尺寸已含预览除数时不再除第二次。以真实页面→屏幕变换和代码已声明的 rasterScale 上界计算，不改作者参数。导出独立按输出尺寸计算，不受窗口大小影响。任意代码变换无法安全推导时用声明上界，不臆测降采样。 | 两种窗口/DPI、完整/半/四分之一、推近与 fit，对照实际纹理尺寸、canvas 文字和细线；首次高 DPR 重建被预热，降档与已达到倍率升回不反复重开。 |
| 作者占位宽高 1×1 | 根因在 `blankWebPicture` 的实际 1×1 纹理一路作为 AuthorGpuImage / Canvas 图像传给作者；只改 displayWidth 或 info.web 不够。采用按本次有效取景尺寸分配/复用透明占位纹理，必要时创建同尺寸 Canvas 桥图像，让 GPU textureDimensions、作者 width/height、Canvas intrinsic size 一致。占位计入正式显存预算并受帧 pin 保护。 | GPU 作者读 textureDimensions、Canvas drawImage 默认尺寸和 cover/contain、layers/嵌套、缺图后到真图的几何保持一致；8K 占位纳入显存压力验收。 |
| 同源硬剪点预开第二页 | 对正式时间映射可知的下一片段，在剪点前预热独立时间槽；有缓存优先预开下一段解码器，无缓存开第二页并定位段首。提示以来源+取景+DPR+目标时间标识，切点原子接管，第一页面不往回 seek；同帧双时刻沿用既有分槽。动态作者时间无法提前推导时只利用实际前视请求，不保证猜中。 | 同源远跳硬剪点前后，日志显示两个独立时间状态；剪点首帧正确、没有把正在播放的页面推进到下一段；缓存/实时两种情况分别测。 |
| 冷页面首播丢帧高 | 来源进入当前/下一可见片段时预备 ready、字体、快照上下文和首帧；命中时预开解码器。后台录制与交互预热为不同任务类别，预热不被 10 秒后台门槛阻挡；用户立即播放不等待全部预热，仍遵守截止时间。 | 空缓存+冷页、已有磁盘缓存+冷解码器、热页/热解码器分开测，记录首幅有效画面延迟及前 3 秒丢帧。缓存关闭时也应改善，不能仅用热缓存掩盖冷页遗留。 |

流水线守护区优先放输出纹理外侧新增行，编码/合成统一裁掉，不影响 CSS viewport 和 region。7680×4320 有余量；若有效纹理已经占满设备最大宽高、没有守护区空间，保留当前受控串行快照作为正确性回退，并明确记录原因。时间戳仅作诊断：Electron 文档定义的是捕获起点以来时间，不是页面 seek 时间。[OffscreenSharedTexture 文档](https://www.electronjs.org/docs/latest/api/structures/offscreen-shared-texture)。共享纹理交接与资源释放沿 [sharedTexture 官方 API](https://www.electronjs.org/docs/latest/api/shared-texture)；不更改 Electron 隔离选项。

## 9. 存储、容量、天数与恢复

- 位置固定为现有作品缓存根下 `render/web-source/`：中文为 `<作品根>/.痕迹AI缓存/render/web-source/`，英文为 `<作品根>/.Henji AI Cache/render/web-source/`。这里的作品根是 `MediaCacheManager` 解析的全局作品目录，不是网页根，也不是每个工程旁新增的缓存目录。
- 复用 `ContentDiskCache.prepareTemporary/adopt/locate` 和 `MediaCacheManager`。段清单、视频、几何元数据、录制资源快照都计入跨分类总量；不另设一套网页缓存容量/天数设置。缓存归入 render 分类，因此现有统计和清理能覆盖。
- 现有设置默认保留 30 天，可选 7/30/90/不限天数；自动容量按已有规则取磁盘可用加已占缓存的 10%，最多 50GiB、最低 10GiB。复用这些当前行为，不把它们增加成网页输入大小/时长的硬拒绝规则。当前设置数值限制不是本 ticket 新增的安全权限。
- 录制/解码期间整个段族租约进入 `manager.protect`；保护视频和所有伴随元数据，读完释放。命中刷新整族使用时间，启动枚举不能把所有段都刷新成“刚使用”。自动清理先过期再 LRU，沿现有超量清到预算 80% 的规则；一个族不完整就失效，启动/查询时清理孤儿。
- 不给长视频设置“最多几分钟”，按段流式处理。容量不足以保留整页时保留热点并暂停全页扫录，不能陷入录一段、删一段、立即补同一段的循环；需求变化或容量释放再继续。真实磁盘写满记录 ENOSPC，丢弃未发布段，预览实时回退。
- 记录来源/作品引用者集合，多个文档共享同段；关闭文档仅释放活跃租约，不立即删段。删除文档由既有文档清理入口移除引用，最后使用者消失后可回收；不按某一序列的 windowKey 删除仍被其他文档使用的网页缓存。
- 派生缓存登记到 `formats.ts` 的可重建排除项；格式不兼容可失效重建，不要求迁移缓存视频。用户工程、网页原件、设置不得借缓存回收删除。程序退出取消后台工作并等待资源关闭，重启只认 ready 段；持久缓存路径不写进可移植作品内容、不随工程包导出。

## 10. 应用能力与日志

应用能力分级为“能力增量”：导出增加一个可选设置，后台增加派生长任务与磁盘副作用。复用媒体缓存实体/设置、导出 schema、任务生命周期和正式领域服务；不新增独立导航页面、不复制 MCP 工具 schema。容量/天数通过现有通用属性写入，缓存清理通过现有正式清理入口；新增内部段协议在能力声明中标 internal，不能暴露为用户业务工具。UI、Pi、外部 MCP 提交的同一导出参数必须进入同一个执行器。

所有诊断走现有 `createMainLogger('main.web_source')` 和前端日志入口：

- `web_source.cache.record.start/completed/failed`：来源稳定标识、变体、段范围、实际编码器、帧数/bytes、各阶段耗时。
- `web_source.cache.lookup.summary`：命中/缺段/过期/精度不匹配/几何缺失/损坏/不支持硬解计数；逐帧明细仅 debug/trace。
- `web_source.cache.record.preempted/resumed`：前台活动原因、后台在途数、从撤销许可到最后一笔 GPU 提交完成的时间、暂停期间误提交数。
- `web_source.cache.content.invalidated`、`web_source.cache.recovered`、`web_source.cache.evicted`：代次与状态转移；不输出网页正文、cookie、token 或密钥。

补录进度以已完成帧/已知需求帧与段数统计；未知 duration 不显示虚假百分比。正式界面不呈现内部键、revision、Worker/管线计数；诊断从现有日志查询入口读回。

## 11. 实施验收决定

### 11.1 环境与命令边界

本设计为 L0，只核查文档路径/引用与现状；未执行构建、测试或独立代码审查。批准后的实现为 L2：跨层帧契约、取消/抢占、缓存 I/O、原生资源生命周期。精确测试覆盖变更模块和直接消费者；双工程类型检查、IPC 对账、主进程导入、依赖图、受影响持久格式门禁按实际改动选择。原生编码新增后运行对应 cargo/FFmpeg 精确测试；不默认跑全仓测试。

实机升级条件是关键结论依赖真实 Electron 共享纹理、NVENC/D3D11VA、GPU 资源争用与呈现，纯单测不能证明。源码通过相关检查后，在安全边界用 `electron:bundle` 准备当前 worktree 产物；原生模块同步构建。不用完整安装包代替必要测量，也不把裸 Vite 当桌面验收。

使用 `scripts/lib/electronLaunch.cjs` 的隔离启动路径，独立 `HENJI_ISOLATED_APP_DATA`、独立作品根、自动分配且明确排除 9334 的调试端口；性能使用正式渲染构建。仅 `--user-data-dir` 不足以隔离本应用数据库/日志。不得启动会加载真实资料的默认正式实例作测试。所有夹具来自仓内/测试生成内容，不从 `D:/视频制作` 复制；如必须验证用户片子，另由 Claude 提供获准的隔离副本。

`npm run bench:video-edit` 已有正式构建/隔离资料/两轮稳定性检查；其默认夹具不是网页缓存验收。实施时扩展相关场景和受控网页夹具后再使用，不能拿默认录屏+标题条结果交差。复用 `uiInspectionSceneVideoEditWebSource.cjs` 增加相关场景，不新造另一套桌面验收器。

所有 GPU 负载实验一次一项，每项不超过 180 秒并有进程树超时清理，耗时超过一分钟放后台。并行录制能力测试在同一个受控实验内开 1/2 槽，不与另一个测试同时跑；跨实例争用场景也由一个验收器管理两个隔离实例。9334 保持原状，旧开发实例存在/其他 GPU 活动导致不可控干扰时暂停性能验收并注明条件，绝不替用户关闭它。

### 11.2 可判定验收矩阵

| 验证范围 | 输入、方法与通过条件 |
| --- | --- |
| 页面时间和分段 | 24/30/60 与 30000/1001、60000/1001 中选择能覆盖整数/有理网格的精确用例；段首/尾、末段、端点、反向和非网格时间。验证独立解码无前段依赖、N 帧与 PTS 一一对应、无错帧/重复补洞；非网格精确请求实际走实时。 |
| 8K 原生往返 | scale 1/3/4 取景，至少一段 8K60；测开编码器、编码吞吐、硬解后尺寸/PTS/色彩、峰值 GPU/RAM。日志证明实际 hevc_nvenc 与 D3D11VA，不能以“配置要求硬件”代替硬件证据。 |
| 缓存后播放与倒拖 | 同设备/同合成，比较“网页缓存输入”与“将同段 MP4 作为普通视频输入”的 20–30 秒场景；关闭最终预渲染及不相关后台任务。预热一遍、正式两遍，核心耗时相差≤5% 才作为稳定基线。网页缓存路径 P95 耗时不高于普通视频 10%，丢帧率差≤1 个百分点；倒拖 P95 首幅有效画面≤100ms 且不高于普通视频 10%，过时帧覆盖为 0。 |
| 缺段非阻塞 | 删除/损坏目标段，冷解码器与慢 seek 并存，连续拖动、松手、再拖；网页输入等待不超根帧预算，近似帧不写精确最终缓存，松手目标最终正确，取消/迟到不污染新请求。与 03 的 151–188ms 历史记录另列，历史值不是本轮基线。 |
| 冷页与剪点 | 空磁盘缓存、页面进程冷启动、远跳硬剪点；关闭与开启预热各两轮，首 3 秒丢帧率相对下降至少 30%，且首幅有效画面延迟不退步。分别测纯实时与已有缓存冷解码，记录未改善的重页面而非用平均值掩盖。 |
| 单页流水线 | 页面自身每帧 seek 约 1–2ms 的确定夹具，1080p 与 4K 连续约 600 帧；报告吞吐间隔 p50/p90、单帧延迟 p50/p95、合帧/补帧次数。目标平均间隔≤10ms，向历史 6.5–7ms 靠近；身份正确率 100%，不达标不能称完整流水线性能已收口。8K 单列，不套用 1080p 阈值。 |
| 让出与恢复 | 补录中分别开始播放、拖动、精确观察、导出、主动预渲染；再用第二隔离实例重复播放。活动后不再派发后台任务，P95 完成让出≤100ms；不可抢占 GPU 尾部单列。前台耗时相对完全关闭补录增加≤5%，暂停期间后台提交数为 0；恢复不重录 ready 段。 |
| 导出 | 同网页 20–30 秒片段，实时/缓存各两轮，先排除最终预渲染。缓存后网页输入耗时 P50 至少降低 50%，总导出时间下降；报告整帧耗时与实际命中比例，不保证旧计划估计的整片三分之一。关闭 useWebCache 后，即使之前已有有损最终缓存也读取实时网页。 |
| 画质 | 固定字体、canvas、细线、饱和彩字、灰阶渐变、阴影/边缘，1×、推近及 8K 实际输出各取关键帧。逐帧时间/几何一致；SSIM≥0.995、PSNR≥45dB 作为候选档门槛，再目视文字边缘与彩字色边；任一可见瑕疵不能靠整图平均指标豁免。无损真值由同环境实时取帧取得，不从待测缓存生成。 |
| 失效与恢复 | 修改片子代码/文字/spans/移动剪点后同页面请求仍命中；改 HTML/CSS/JS/图片/字体后旧代次不能提交。覆盖保留 size/mtime 的覆盖、保存中间态、文件夹替换、监视失败、两实例抢同段、encode 中崩溃、半发布、disk full、段族被回收。 |
| 占位与倍率 | GPU/Canvas/layers 三类作者输入在缺图→真图时尺寸稳定；小窗口、DPI、预览档、zoom/fit 与导出互不串用缩放。占位、倒拖和双时刻并存时无非法纹理复用、无超过实际资源的持续录制。 |

性能结论同时记录 commit、实际 Electron/Chromium/FFmpeg、GPU/驱动、分辨率/F、缓存状态、页面复杂度、是否诊断、样本次数和 GPU 其他活动。GPU 提交完成、渲染结果回执与物理显示器上屏分开命名；不得把合成完成延迟写成实测物理上屏延迟。未获准的真实片子与未提供的硬件平台保持“未验证”。

实施交付须同时列出五项遗留的实测完成状态；某项未达门槛不能因缓存路径通过而一并勾掉。代码达到提交边界后按 L2 与原生/IPC 高风险要求做干净上下文独立审查，依计划再交 Claude 与 /code-review；这不代表本文已经获得其批准。

## 12. 代码位置与资料

以下路径相对 `D:/VibeCode/Henji-AI-t14`；“新增”均为实施建议，当前尚不存在。

| 位置 | 现状/实施落点 |
| --- | --- |
| `electron/main/services/web-source/page.ts`：`snapshotPaintScript / capture / takeSnapshot / deliver` | 页面时钟、绘制屏障与共享纹理；接入帧身份、可重叠捕获和录制消费者。 |
| `electron/main/services/web-source/pages.ts`、`content.ts`、`site.ts` | 页面归属、内容监视与 hash；稳定批次快照、dirty/代次复核在这一领域收口。 |
| `electron/main/services/web-source/time-cache.ts`（新增） | 段索引、补录协调、段租约与元数据发布；职责过大时按存储/调度拆分，不放进 page 类。 |
| `src/features/videoEdit/application/videoEditWebContent.ts`：`videoEditWebContentIdentity` | 既有渲染侧内容身份；不是一个名为 videoEditWebContentIdentity.ts 的文件。 |
| `src/features/videoEdit/engine/videoEditWebInputs.ts` | 网页会话、latest、deadline、回退、缓存选择、元数据与原生解码接入。 |
| `src/features/videoEdit/engine/videoEditGpuCompositor.ts`：`blankWebPicture`、`videoEditCodePicture.ts`、`videoEditAuthorCanvasBounds.ts` | 1×1 占位、显示尺寸与作者输入尺寸的根因及直接消费者。 |
| `src/features/videoEdit/engine/videoEditRenderer.ts`、`videoEditNativeFrames.ts`、`videoEditRenderTransport.ts` | 根/嵌套预算、前视、原生帧接收、模式和来源精度传播。 |
| `src/platform/contracts/videoFrameTypes.ts`、`electron/preload/video-frames-api.ts`、`electron/main/ipc/video-frames.ts` | 现有帧端口协议；增加缓存查找/请求与 provenance，不另开图像传输通道。 |
| `native/video-decoder/src/decode/codec.rs`、`platform/windows/d3d11va.rs`、`platform/windows/shared_texture.rs`、`main.rs` | 原生硬解、共享纹理、现有协议；新增 encode 职责和反向纹理输入，并独立启动编码进程。 |
| `electron/main/services/web-replay/player/encoder.ts`、`gpuCapture.ts`；`packages/web-replay-probe/src/replay/captureToken.ts` | 现有 NVENC CPU 管道和捕获 token 参考；复用可共享内核，不复制整套录制器。 |
| `src/features/videoEdit/application/videoEditRenderCache.ts`、`src/core/videoEdit/renderCache.ts` | 自动预渲染、watchProgramActivity、最终窗口指纹；共用活动协调，避免误失效和后台争用。 |
| `src/features/videoEdit/application/videoEditExport.ts`、`videoEditExportPreviews.ts`；`src/core/videoEdit/exportPresets.ts` | 导出模式与最终预览复用；useWebCache 和精度来源策略。 |
| `src/core/application-control/domains/videoEdit/videoEditExportCapabilities.ts` | 现有导出能力共用 settings schema；按正式入口回读验证。 |
| `electron/main/services/media/media-cache.ts`、`content-disk-cache.ts`、`src/core/media/mediaCache.ts` | 缓存根、跨类容量与天数、保护/清理、原子落盘；段族适配。 |
| `electron/main/services/video/render-cache.ts`、`render-cache-runtime.ts`、`src/core/persistence/formats.ts` | 成品预渲染存储/文档清理参考，缓存排除与导出预设持久格式登记。 |
| `scripts/bench-video-edit.cjs`、`scripts/lib/electronLaunch.cjs`、`scripts/lib/uiInspectionSceneVideoEditWebSource.cjs` | 正式构建、隔离资料与网页真实性场景；扩展对应验收，不使用 9334。 |

其他官方依据：[FFmpeg 编解码文档](https://ffmpeg.org/ffmpeg-codecs.html)、[Remotion 并发定义与过量并发风险](https://www.remotion.dev/docs/terminology/concurrency)。已比较现有 WebCodecs、网页重演 FFmpeg 管道、FFmpeg 原生纹理输入；选择原生适配以控制 GOP、硬件编码与 8K 数据搬运。未引入 rrweb DOM 时间线或第二套 Chrome，因为这两者改变页面执行/捕获体系且不复用当前原生帧链。

原生模块沿现有 FFmpeg GPL 共享构建与源码分发义务；复用已有许可生成/打包校验，不新增商业编码 SDK 运行依赖。HEVC 专利许可与现有发行风险一起列明，不以本机驱动可用推断已获分发许可。VGPU MCP 本会话未提供，官方站点读取失败；本文不新增或假定 VGPU API，纹理捕获依据 Electron/Chromium 和 FFmpeg 官方资料，具体 GPU 实现仍须在实施时按项目规则查证。

## 13. Claude 与审查员批准项

1. 批准原生 FFmpeg/NVENC 共享纹理输入路线及本 ticket 首发 Windows/NVIDIA 边界；若要求本期覆盖其他厂商/macOS，需同时扩大编码后端与硬件验收范围。不能用 WebCodecs 的硬件偏好假冒指定 NVENC。
2. 批准约两秒独立段、段内约半秒 IDR、高质量 8-bit 4:2:0 档案，以及暂停允许有损缓存、观察/实时导出绕过缓存的精度划分；画质门槛不过则该档案不能交付。
3. 批准一个可选 `useWebCache` 导出字段、跨实例 GPU 协调和五项遗留的上述实施边界；完整流程批准前不修改源码、不提交、不合并、不 push。

## 14. Claude 裁定（10-31）
1. 批准原生 FFmpeg/NVENC 共享纹理输入路线，首发 Windows/NVIDIA；其他设备与 macOS 保持现有实时网页行为（目标平台只有 Windows x64 与 macOS arm64，VideoToolbox 后端以后按同一契约补）。不用 WebCodecs 的硬件偏好冒充 NVENC。
2. 批准约 2 秒独立段、段内约半秒 IDR、暂停可用有损缓存、精确观察与实时导出绕过缓存的精度划分。**色度采样：编码与本机硬件解码都支持时用 HEVC 4:4:4（网页界面文字与细线多，4:2:0 会糊彩字边），不支持时退 4:2:0**；画质门槛不过的档案不交付。
3. 批准可选导出字段 `useWebCache`（缺省 false）、跨实例 GPU 协调与 ticket 03 五项遗留的收口边界。

## 15. 设计审查后的裁定（10-31，优先于前文与第 14 节）
见同目录 review.md：路线改为“WebGPU 读回 + 现有 FFmpeg 管道”先行、色度先探针、网格带相位、段共用解码会话、主进程侧外来内容确认、只缓存可靠帧、渲染入口显式精度参数等 19 条。实现前先按此改写正文。
