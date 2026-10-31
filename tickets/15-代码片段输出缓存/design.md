摘要：缓存代码生成片段的完整作者输出，位置在作者层栈完成后、片段外部效果与序列合成前；保留现有层内复用和序列预渲染。
摘要：按完整依赖与时间/frameKey 寻址，GPU 保存独立不可变纹理、RAM 保存原格式无损像素；按字节预算与租借回收，修改无关片段不清缓存。
摘要：本票不做磁盘、透明分块或跨 Worker 像素共享；设计待 Claude 与审查员批准，实现还须等待 ticket 11 合并，并遵循 ticket 09 最终精度裁定。

# Ticket 15 技术设计

## 1. 范围与基线

- 依据：[本票计划](./plan.md)、[总计划第 3 项](../../../Henji-AI-t15/docs/task/代码效果与渲染改进/以后再做.md)、[ticket 11 计划](../11-效果合并/plan.md)、[ticket 09 最终裁定，第 10 节](../09-按内容自动高精度/design.md)。后者明确“精度不进内容指纹”，优先于 ticket 09 早期计划中的表述。
- 代码基线：`D:\VibeCode\Henji-AI-t15`，分支 `task/15-代码片段输出缓存`，HEAD `a05191f9df31df62f647fb3d6b49c25549ca6f22`；读取时与本地 main 相同。未拉取远端、切换分支或修改源码；实现前须重新核对 ticket 11 合并后的执行器。
- 本票缓存 `kind=code` 的生成片段，覆盖 Canvas、layers、WebGL、WebGPU 作者入口。附加代码滤镜、普通视频解码、结构化图形和网页源头各自沿用已有机制，不新增第二套效果链缓存。代码滤镜仍在生成片段缓存之后执行；需要它自身输出缓存时另立范围。
- 验收中的“改一个片段只重算它自己”指无依赖关系的其他代码生成器不再执行绘制、栅格和作者层效果；最终合成、被改片段的下游效果以及真实依赖它的嵌套输入仍须重算。命中以条目仍在容量内、会话存活、质量与尺寸相同为前提。
- 本轮是 L0 设计交付，只核查路径、契约与引用；没有运行 CPU/GPU 基准，不给出性能已达标结论。没有操作端口 9334、`D:\视频制作` 或 node_modules。

## 2. 现有实现的事实

| 位置 | 当前行为及本票接点 |
|---|---|
| [videoEditCodeSources.ts](../../../Henji-AI-t15/src/features/videoEdit/engine/videoEditCodeSources.ts)，`prepare`、`releaseUnused`、`replaceContent` | 静态生成器有 `staticPictures`；动态目标键为 `code:dynamic:${clip.id}`。`releaseUnused` 清掉不在当前工作集的目标，`replaceContent` 清空片段输出；不能保存动态历史帧。静态键已含字体、资产修订、覆盖值和部分效果环境。 |
| [videoEditCodeGpu.ts](../../../Henji-AI-t15/src/features/videoEdit/engine/videoEditCodeGpu.ts)，`authorGenerator`、`surface`、`spillGeneratorTarget` | 作者运行在合成器同一 GPUDevice，目标纹理被后续帧复用。当前 spill 是当前合成所需的临时 ImageBitmap，16f 不走此出口；不是无损历史缓存。 |
| [videoEditAuthorRuntime.ts](../../../Henji-AI-t15/src/features/videoEdit/engine/videoEditAuthorRuntime.ts)，`layerCacheSignature`、`renderFrame` | 层 `cacheKey` 结合 bounds、clip、资产身份与文字栅格条件复用录制和静止层；`pose`、`effects(t)` 仍求值。它解决层内部重画，不覆盖片段历史输出。 |
| [videoEditAuthorPrograms.ts](../../../Henji-AI-t15/src/features/videoEdit/engine/videoEditAuthorPrograms.ts)，`retain`、`observe` | 离开活跃集合的作者实例会释放；元素观察当前取实例的最近一帧。缓存不能依赖实例永存，也不能命中旧像素却返回另一帧的元素。 |
| [videoEditRenderer.ts](../../../Henji-AI-t15/src/features/videoEdit/engine/videoEditRenderer.ts)，`updateDocument`、`replaceContent`、`invalidateFontResources` | 普通文档更新保留顶层 compositor，但重建嵌套和代码输入子会话；字体变化重置作者资源。新增输出缓存须由根会话持有，不能挂在这些短命子会话上。 |
| [videoEditGpuCompositor.ts](../../../Henji-AI-t15/src/features/videoEdit/engine/videoEditGpuCompositor.ts)，`fork`、`code` | fork 共用 GPUDevice，各自持有 CodeGpu；只在 CodeGpu 内各建一个缓存会重复分配预算，并随子会话重建丢失。 |
| [videoEditAuthorFingerprint.ts](../../../Henji-AI-t15/src/features/videoEdit/engine/videoEditAuthorFingerprint.ts)、[videoEditCodeFingerprint.ts](../../../Henji-AI-t15/src/features/videoEdit/engine/videoEditCodeFingerprint.ts) | 已有 frameKey、Canvas 录制指纹及保守回退；音频依赖、未知网页、序列输入等存在回退条件。指纹失败不是“画面不变”。 |
| [renderCache.ts](../../../Henji-AI-t15/src/core/videoEdit/renderCache.ts)、[videoEditRenderCache.ts](../../../Henji-AI-t15/src/features/videoEdit/application/videoEditRenderCache.ts) | 序列缓存按窗口完整依赖及片段帧指纹寻址，产物是编码后的合成画面；不能代替带透明度和浮点值的作者输出。 |

## 3. 缓存层与资源所有权

正式链路：

```text
求本帧片段参数、时间与输入身份 → 查代码输出缓存
  命中 GPU：借用不可变纹理
  命中 RAM：上传同格式纹理，再借用
  未命中：准备实际输入 → 作者 draw/layers/native GPU
          → 作者层效果、位姿、曝光、层栈完成 → 保存完整输出
→ 片段外部效果/蒙版/变换 → 轨道、转场、嵌套与序列合成 → 最终呈现
```

- 缓存单位是 `VideoEditCodePicture` 所代表的作者画布输出：包括作者内部层效果、元素覆盖、作者层位姿与运动曝光；不包括片段外部效果链、片段位置/缩放/淡入淡出和其他轨道。外部变化仅在确实改变作者可见输入、渲染尺寸或质量时改变该输出键。
- 不把作者层栈作为另一套可持久保留的缓存单元。它的目标、录制、mip、scratch 与实例生命周期紧耦合，已有复用继续负责未命中的绘制路径。
- 所有 fork 通过根 compositor 注入同一个输出缓存 owner；owner 绑定根会话与 device generation。生成结果可由不同子 CodeGpu 借用；子会话释放只解除自己的租借，不销毁公共输出。
- 第一版把成功完成的目标以 `copyTextureToTexture` 复制成缓存专有纹理。工作目标仍由现有 surface 池复用，避免把 `code:dynamic` 的可覆写纹理直接塞进缓存。热命中无复制、无读回；冷未命中增加一次 GPU 内复制，其代价纳入验收。暂不改作者 target 的所有权协议。
- 缓存记录保留实际 width/height、displayWidth/displayHeight、textureFormat、预乘约定、opaqueBackground、carriesLight 与对应观察快照。`carriesLight` 按条目恢复，不能从上一帧运行时读取。
- 借用纹理只能作为输入。滤镜和合成输出必须用独立目标，不能对缓存纹理就地写入。缓存租借至少持续到相关编码命令全部提交；GPU 完成屏障用于退役资源与预算结算，不在每个热命中处等待整条队列。
- 缓存命中前仍完成当前内容的信任判断；不能借另一个已信任实例的相同内容缓存绕过外来代码首次执行确认。不开新权限入口。

## 4. 键：内容身份与资源格式分开

`contentKey = H(engine, codeIdentity, parameters, temporalIdentity, dependencies, authorGeometry, renderContract)`。

`storageKey = (rootSession, deviceGeneration, contentKey, actualTextureFormat)`。根会话内另有受同一预算约束的 `contentKey → storageKey` 索引；索引不能脱离条目无限增长。

| 分量 | 纳入的事实与求值规则 |
|---|---|
| 引擎 | 复用 `VIDEO_EDIT_RENDER_ENGINE_VERSION`；[renderEngineVersion.mjs](../../../Henji-AI-t15/scripts/vite/renderEngineVersion.mjs) 已沿渲染、编译与缓存代码闭包自动生成。新缓存实现必须进入该闭包，不新建手工版本常量。 |
| 源码与库 | 实际解析后的多文件内容、入口、resolvedImports、作者 API/语言版本、递归组件 pin 哈希、实际选择的作者库版本。复用 [sources.ts](../../../Henji-AI-t15/src/core/videoEdit/codeMaterial/sources.ts) 的内容身份，不用版本 ID、文件路径、模块对象地址或临时 blob URL 代替内容。默认库实现随引擎闭包覆盖。 |
| dataFiles | 默认计入全部源码；有合法 frameKey 时沿用 `authorFrameCodeIdentity` 的既有约定，仅排除作者声明且非入口的 dataFiles，其画面变化由 frameKey 承担。无 frameKey、声明失败或未知依赖时恢复完整源码键，不把失败摘要当声明键。 |
| 参数 | 使用正式默认值、参数动画及派生值求值后的作者输入；字典稳定排序，数组保留顺序。场景对象含父子引用，使用正式场景指纹，不直接 JSON.stringify 循环对象。普通参数变化即失效；不要求作者 frameKey 替宿主覆盖所有参数。 |
| 时间 | 默认保存完整作者可见时序：精确源时间、clip.time、clip.duration、frameDuration、曝光范围/快门/相位、audioTime。复用 [clipSpeed.ts](../../../Henji-AI-t15/src/core/videoEdit/clipSpeed.ts) 的有理数映射与正式帧上下文，不能四舍五入成整数源帧、只取 sequence frame 或只用微秒种子代替完整时间。 |
| frameKey | 复用纯函数校验及指纹规则。合法声明可替代时间中逐帧变化的部分，使相同画面跨时间命中；尺寸、参数、资产、覆盖、曝光设置和作者效果依赖仍由宿主包在外层。作者必须把时间、随机、曝光与数据对画面的影响表达完整，不能“常量 frameKey + 随时间随机画面”。 |
| 尺寸/倍率 | 作者逻辑画幅、实际纹理像素尺寸、display size、renderScale/divisor；frameKey 的 width/height 与 info 必须对应该作者入口实际所见，不能拿全分辨率预渲染指纹直接命中降采样原生 GPU 输出。 |
| 质量/颜色 | 实际 EffectQuality、运动曝光开关与采样设置、颜色/预乘语义。interactive 与 final 只在正式规则证明等价时复用，默认分开；导出编码码率不影响作者输出。 |
| 精度 | 内容键含决定精度的全部输入及引擎版本；存储键与 payload 明确标记 rgba8unorm/rgba16float。复用已完成条目的实际格式，不在查缓存时重演作者 layers 以预测格式，也不把整个序列的最终合成格式塞进作者键。 |
| 字体 | 已完成加载的 `documentFontRevision()` 及当前根字体代次。第一版字体变化保守使全部代码输出失效，包含模块顶层文字测量；不伪称已有按字体的完整依赖追踪。 |
| 图片/视频/网页 | 图片内容身份、sourceRevision、尺寸；视频精确取帧请求与源修订/取样契约；网页内容修订、页面时间、viewport、region、scale，以及作者可读 web 元数据。未知内容、未稳定的实时页面不能以 URL 或 GPUTexture 身份充当确定依赖。 |
| 嵌套/音频/场景 | 嵌套画面的递归内容身份与取样时间；音频分析内容修订、求值位置；片子数据及派生输入走已有记录范围规则。不能证明局部读取范围时散列该片段实际引用的整份数据。依赖缺失/未就绪时不发布缓存。 |
| 作者效果/覆盖 | 当前实际引用的风格、效果定义、LUT 内容修订和元素覆盖求值结果。无法静态确定 `effects(t)` 引用集合时保守计入完整作者效果环境；不得执行第二次绘制来“测一下键”。 |

- 快速路径先用依赖身份查缓存，再启动解码、网页取帧、音频分析与嵌套渲染。依赖身份未准备好时允许等待元数据或回退正式准备；禁止先无条件渲染全部输入再声称热命中消除了重算。
- frameKey 路径复用 `fingerprintAuthorFrameKey` 对作者层效果、位姿模糊/尺度和曝光的补充依赖；不能只散列作者返回值。该求值因读取真实素材或网页布局而失败时，用完整源码、参数、精确时间及输入身份键；这些依赖也不完整时跳过缓存。它与原有窗口指纹的保守回退保持同一语义。
- 输入身份必须覆盖输出实际采用的样本。近似帧、未完成的精修、缺输入替代图、效果失败帧不得登记为精确命中；必要时记录为未命中，沿现有调度获取正式结果。
- 无 frameKey 的作者默认用精确时间键，支持回访同一帧。已有 recording 指纹可以在它已经就绪且渲染契约一致时作为额外等价证据，不在每次交互查找中强制运行 Canvas 录制。不能把 `mode=static` 当作可忽略时间、帧率、尺寸、曝光等依赖的万能证明。
- 字典规范化与 frameKey 校验复用现有实现；必要时提取共享纯函数，不各写两份哈希规则。大型源码/场景按不可变对象缓存摘要，逐帧只组合短摘要。

## 5. 与帧指纹、预渲染和局部修改的关系

| 机制 | 负责什么 | 本票关系 |
|---|---|---|
| 作者层 cacheKey/录制 | 同实例内少栅格、少上传 | 输出未命中时继续生效，不扩成第二个历史帧缓存。 |
| ticket 01/02 的帧指纹 | 判断窗口画面是否变化，复用序列渲染与导出文件 | 共用作者依赖与 frameKey 契约；不是像素容器。无效指纹按原规则回退，不代表新缓存命中。 |
| 本票输出缓存 | 同一活跃根会话里复用每个生成片段的无损画面 | 供实时合成和同一预渲染会话的窗口重建使用，保留透明度及超白。 |
| 序列预渲染 | 复用完成的窗口最终画面 | 上层命中时不必访问本票；上层未命中时从片段缓存取未改输出再合成。窗口失效不级联清除代码输出。 |

- 改 A 的源码/参数，A 的内容键改变；独立 B/C 的键不含 `document.revision`、整个 clips 列表或 A 的版本，所以仍命中。A 被 B 用作输入时，B 的依赖改变，B 正确失效；共用字体/库/作者效果定义变化可以使多片段共同失效。
- 同项目 `updateDocument`、`updateParameters`、预渲染 `replaceContent` 只取消旧任务与替换业务快照，不清根输出缓存。子会话重建后仍能访问根 owner。关闭项目、根会话结束、设备丢失或引擎更换才整体释放。
- 移动片段而作者源时间和局部时间不变，缓存仍可用；改变裁切、速度、倒放、帧率或 duration，按完整时序键判断。单改片段外部位置、透明度和外部效果复用作者输出，然后重新合成。
- 撤销回到旧参数/源码可以复用未淘汰条目。旧条目由容量回收，不因版本曾经失活马上删除。
- GPUTexture 不跨 Worker/设备传递。预览、后台预渲染和独立导出 Worker 各持有自己的条目，不能承诺预览暖过的帧自动让另一个 Worker 命中；本票共用算法与预算协调，不传像素。跨关闭/重启的复用继续由序列磁盘缓存负责。

## 6. 拖动、暂停与观察信息

1. 请求经过现有“只呈现最新请求”调度，求值本帧键。GPU 热命中直接借用；RAM 命中上传原格式；未命中才走正式作者路径。持续播放与反向拖动用同一入口，不按播放状态清缓存。
2. 命中的片段仍参加当帧合成。它跳过作者 draw、Canvas 栅格、作者层效果及输出上传；不承诺跳过最终 compositor，也不拿相邻帧冒充目标帧。
3. 暂停重复请求同一精确帧可命中；拖动从降分辨率切回完整画质使用不同键，完整画质首次缺失须正常渲染。旧请求晚到不能覆盖新帧或更新新帧的元素观察。
4. 缓存保存元素观察的不可变快照，不保存闭包、DOM/Canvas 对象或运行时实例引用。观察身份含源码完整版本、实际时间、片段实例/覆盖与可编辑数据绑定，和可跨时间/跨版本等价的像素身份分开。
5. 相同精确请求命中时返回对应快照，再绑定当前 sequenceId/revision/frame。frameKey 相等但观察身份不同，允许先显示缓存像素；选择/编辑/观察请求必须取得当前身份的观察结果。无法在现有观察入口独立求得时，只为该片段走一次正式求值，不返回旧 sourceSpan、数据行或包围盒；其他片段仍命中。诊断须区分像素命中与观察补算。

## 7. 显存、内存与回收

### 容量决定

- 默认新增历史输出预算：GPU **256 MiB**，RAM **512 MiB**。这是输出缓存总预算，不是项目大小、片段数量或必要工作集硬上限，不新增用户设置。
- 在现有渲染会话管理层分配预算额度：同一工作台页面 `activeTransports` 下本票所有活跃根会话的额度总和不超过上述值；有前台时前台池占 3/4，后台预渲染/导出共享剩余 1/4，同类活跃会话均分，无前台时后台可用全额。同根 fork 共用额度。实现接点为 [videoEditRenderSession.ts](../../../Henji-AI-t15/src/features/videoEdit/engine/videoEditRenderSession.ts) 与 [videoEditRenderTransport.ts](../../../Henji-AI-t15/src/features/videoEdit/engine/videoEditRenderTransport.ts)，通过现有 Worker 消息通道传递，不加 IPC 或磁盘状态。独立应用窗口/进程各自有额度，汇总占用为其总和；本票不把页面内额度宣称为操作系统级全局上限。
- 额度收缩先回收未租借资源，已提交使用的资源退休后确认归还，宿主收到归还后才重新分配，不能先把同一份额度授给另一个 Worker。无法取得额度的冷帧正常渲染，只不保留历史副本。
- 原有解码帧、作者层画布、效果 scratch 与当前帧工作目标继续单独计量；诊断同时报告输出缓存新增量与整个渲染工作集。不得把 256 MiB 写成“应用总显存上限”。设备/驱动实际占用不能由纹理逻辑字节精确推出。
- GPU 条目按 `width × height × bytesPerPixel` 计费，复用 [videoEditGpuFrame.ts](../../../Henji-AI-t15/src/features/videoEdit/engine/videoEditGpuFrame.ts) 的 4/8 字节规则；本票缓存只有单 mip、单采样。RAM 计紧凑像素、元数据/键的可计量存储；读回 staging 及复制期间双份数据也预留预算，不遗漏在途资源。

| 单帧全画幅 | rgba8unorm | rgba16float |
|---|---:|---:|
| 1920×1080 | 7.91 MiB | 15.82 MiB |
| 3840×2160 | 31.64 MiB | 63.28 MiB |

256 MiB 仅计像素最多约容纳 32/16 张 1080p 或 8/4 张 4K；三个并行 4K 16f 片段一帧约 189.84 MiB，容量不能被解读成无限来回命中。元数据和在途预留使实际可保留量更低。

### 选型与回收决定

- 复用 [LeasedLruCache](../../../Henji-AI-t15/src/core/imageEdit/v3/leasedLruCache.ts) 的按字节计费、租借及延迟销毁语义。它是无图像领域依赖的纯容器；若需适配动态额度与入场预留，将同一实现移到共享 core 路径并迁移现有调用方，不复制类，不顺便改修图业务。
- 已比较项目 [VideoEditFrameCache](../../../Henji-AI-t15/src/features/videoEdit/engine/videoEditFrameCache.ts) 与 [lru-cache 官方接口](https://isaacs.github.io/node-lru-cache/)：前者依赖解码帧时间区间且允许 pinned 工作集越预算，后者提供 maxSize/dispose 但仍需补 GPU 租借和在途额度。采用已有 LeasedLruCache，领域层只处理 GPU/RAM 迁移与额度，不安装依赖。
- 保留 LRU；当前显示和正在提交的条目持有租借，淘汰未租借且最久未用的条目。不按 TTL、固定帧数或“离开当前画面”立即删除。单条大于可用额度时跳过缓存，完成当前渲染。
- 先预留副本字节，再分配/复制；发布失败、set 未保留、取消、设备丢失都由明确唯一 owner 回收。`LeasedLruCache.set()` 现有 false 返回可能来自拒收或入场即淘汰，实施时须明确所有权返回语义，避免重复 destroy 或泄漏；同键并发未命中合并为一个生产任务。
- 缓存副本退役到实际释放之前仍记账。每帧结束和取消路径统一释放租借；根 dispose 先停止入场，等待已发任务结算，释放条目与 staging，最后核对本票账目归零。

### RAM 层

- RAM 只存 **原始无损像素**：8 位按字节存，16f 保存原有 half-float 位模式，不经 ImageBitmap、Canvas、PNG、VideoFrame 编码或反预乘；恢复用同格式纹理上传，保留超白、负值和零 alpha 光。显示抖动留在正式最终呈现处。
- GPU 为热层，RAM 为回访层。第一版仅对已发生至少一次像素命中的条目，在前台空闲时安排降级；不把每个连续播放冷帧都读回。一次只执行一个降级任务，读回前先预约 RAM/staging 和源纹理租借；没有额度或前台重新繁忙时不再启动新任务，直接按 LRU 丢弃可淘汰条目。
- 已提交的读回允许收尾，但不能阻塞最新帧。`copyTextureToBuffer` 按 256 字节行对齐；映射完成去掉行填充，随后释放 staging。紧凑副本与 mapped buffer 同时存在的峰值一并计费。
- RAM 命中需要一次上传，GPU 热命中没有上传。晋升时 GPU/RAM 双份存储各计其预算；成功后可释放 RAM 像素，不能在上传完成前失去唯一完整副本。
- RAM 回存失败只使该条目不可缓存，沿现有日志报告；正式渲染失败、作者异常和设备丢失不能被缓存层吞掉。失败帧不发布，不用旧条目掩盖。

## 8. 确定性与异步提交

- 作者前提沿现有契约：给定完整输入，任意取帧顺序得到同一输出。不能依赖上次 draw 是否执行、累计计数、未清空的 GPU 反馈目标或墙钟。输出缓存跳过 draw 是该契约允许的行为，不新增 AST 白名单或隔离线程。
- [videoEditAuthorDeterminism.ts](../../../Henji-AI-t15/src/features/videoEdit/engine/videoEditAuthorDeterminism.ts) 已在同步作者入口按入口名/层 ID 与微秒时间用 FNV-1a + mulberry32 固定 Math.random 序列，临时替换 Date.now/performance.now；导入阶段串行并使用固定 module 种子。本票复用它，不用缓存命中次数、文档修订或 Worker ID 改随机种子。
- 现有包装只覆盖异步入口第一次 await 之前，不覆盖 new Date、crypto 随机、网络/外部可变状态、作者自己的随机发生器和 GPU 跨帧反馈。它不是“任意 JS 都确定”的保证。异步作者应在 await 前取得所需随机值/稳定输入，或使用已有确定性作者库；不能把全局 Math.random 替换持续到 await 完成为止，污染并发宿主代码。
- frameKey 是作者声明，不是运行时自动证明。声明漏掉随机或曝光会导致错误复用；本票保留声明失败诊断、对未知宿主依赖回退精确键或不缓存，不承诺检测所有未声明副作用，也不执行两次作者代码来在线判定确定性。
- 缓存状态为未命中、生成/复制中、可用、退役。只有完整渲染成功、复制已排入同一 GPU 队列、当前内容代次仍有效且原有 `beforeCommit/assertCurrent` 通过，才登记可用。队列顺序保证同设备后续采样读到该副本；不必每次等 GPU 完成才开始合成。
- 每个在途任务捕获内容键、根代次和请求取消状态。文档更新取消旧任务后，其晚到结果不得写入新键、呈现新请求或发布观察信息；未发布副本直接回收。设备丢失清空 GPU 与 RAM 条目、索引和在途任务，恢复走新 generation，不把失败前的缓存当作已验证结果。

## 9. ticket 11、ticket 09 与磁盘边界

### Ticket 11

- 实现启动条件是 ticket 11 已合并且本设计获 Claude 与审查员批准。实现只包围正式 `authorGenerator` 输出入口；不复制效果执行器、不保留合并前的效果分支。
- 作者层缓存已包含正式层效果结果；片段外部效果不在缓存内。ticket 11 合并后的定义、参数默认值、质量策略和库实现通过引擎版本及依赖进入键。
- 核对合并后的 [videoEditAuthorEffects.ts](../../../Henji-AI-t15/src/features/videoEdit/engine/videoEditAuthorEffects.ts)、[videoEditBuiltinEffectsGpu.ts](../../../Henji-AI-t15/src/features/videoEdit/engine/videoEditBuiltinEffectsGpu.ts)、[videoEditRenderPrecision.ts](../../../Henji-AI-t15/src/features/videoEdit/engine/videoEditRenderPrecision.ts)：入参格式、target 所有权、scratch 回收、异步提交边界。输出缓存只能借用输入，效果执行器不得改写它。
- 元素观察快照和 carriesLight 都在执行器成功后发布；取消和降级共享原有错误/提交屏障。ticket 11 只需维持这些输出语义，不为本票另加效果分类。

### Ticket 09

- 按最终裁定保留现有内容驱动精度、8 位路径、零 alpha 光和最终抖动。作者层栈可在同一帧首个触发层提升到 16f；缓存只收其最终实际格式，命中直接恢复该格式，不要求两阶段执行作者回调。
- `contentKey → actualFormat` 是已渲染结果的索引，format 进入资源键；精度算法更改由引擎版本失效。不向 core 帧指纹/持久格式添加精度字段，也不让 core 导入 engine 判定。
- 8→16→8、质量变化、尺寸变化可以同时保留不同合法条目；不同格式不可重解释。序列其他片段使最终 compositor 提升，不强制重算本来只需 8 位的作者输出。
- 高精度 RAM 回存是原始 copy/map/write 通道；既有 `spillGeneratorTarget` 的 8 位 ImageBitmap 路径不作为本票历史层。缓存中 RGB>1、RGB<0、alpha=0 且 RGB 非零均保留。

### 磁盘

- **本票不做磁盘层**，不新增持久格式、索引、保存屏障或工程迁移；不改变现有序列渲染文件。实现收益首先限定在活动会话的重复取帧和局部编辑。
- **本票不做透明分块**：额外扫描/压缩的收益尚无测量，且 alpha=0 不代表 RGB 无贡献。后续做稀疏存储必须保留完整画幅、位置、格式和颜色契约，仅所有通道确实为零的块才可直接省略；零 alpha 光不可删。
- 跨 Worker/重启共享和磁盘无损格式作为后续独立设计，须有命中率、回存带宽与缓存容量证据后再定。

## 10. 验收与实施范围

本节是批准后实现的验收决定，不代表本轮已经执行。

| 验收 | 可判定结果 |
|---|---|
| 同帧回访 | 预热 A/B/C 的同一帧后暂停重复、前后拖动再回访；可用条目的作者 draw、栅格、作者效果调用增量为 0。分别记录 GPU 命中、RAM 命中与观察补算。 |
| 局部编辑 | 同帧修改 A 源码/参数，B/C 生成器不执行；改外部片段变换只重新合成；A 被 B 引用时 B 必须重算。覆盖普通 update、参数手势、撤销、replaceContent 和嵌套子会话重建。 |
| 键正确性 | 修改字体、同路径资产修订、库 pin、帧率、裁切/倒放、曝光、尺寸、质量、元素覆盖各触发正确失效；无关项目元数据不触发。frameKey 非法、未知依赖不能产生假命中。 |
| 所有权与容量 | 小预算强制淘汰；当前租借不被覆写/销毁；相同键并发不重复生成；读回、晋升、预算收缩、取消和设备丢失无泄漏；GPU/RAM/在途总账不越各自额度，结束归零。 |
| 像素 | 同一设备、质量、尺寸、输入下，直接渲染、GPU 热命中、RAM 恢复三条路径的作者纹理逐字节一致；16f 比较原始 half 位模式并保留超白/零 alpha 光；最终编码前画面相同。额外覆盖透明文字、发光、8↔16、Canvas/layers/native GPU、运动曝光。 |
| 真实交互 | 使用隔离资料目录和测试夹具的正式 Electron，记录拖动/暂停请求到实际呈现的 p50/p95、作者 CPU/GPU 时间、缓存命中率、readback/upload/copy 次数、缓存及全工作集峰值。不能用纯 mock 或裸 Vite 证明流畅性。 |

- 典型规模：1080p、30fps、三个重叠代码片段，120 帧往返；容量边界：4K、三个全幅 16f 片段，用明确小于/大于预算的访问序列验证命中与淘汰。冷、GPU 热、RAM 热分列；重复次数只用于同次运行估计波动，不能把 120 帧全部命中设为有限容量缓存的要求。
- 同一运行对比关闭缓存的正式路径与开启路径，先预热编译，再对相同帧序列测量。热命中应减少作者工作且请求到呈现 p95 改善；若有可重复冷路径退化或 RAM 回存抢占前台，停止扩大范围，带数据交 Claude 裁定，不凭平均命中率掩盖交互回退。不在计时区间做像素读回。
- 实现按 L2：共享生成入口、跨消费者资源所有权和异步取消。精确测试覆盖上述状态/数据完整性风险；运行受影响工程类型检查，动 core 则按规则检查两套工程；执行 `npm run test:gpu -- <相关 gpu 测试>` 与 `npm run verify:changed -- --level L2 <本次文件...>`，先 dry-run，不扫脏工作区、不默认全量。
- Electron 交互结论需要正式容器验证，复用 `test:reality`；运行时代码更新后按需 `electron:bundle`，不升级完整 build。构建/GPU 实测一次一个，超过一分钟后台执行；必须使用独立于端口 9334 的隔离实例，不能触碰其 out 或真实资料目录。现有 `bench:video-edit` 可补充阶段耗时，不能替代拖动/暂停呈现证据。
- 预期实现文件：`videoEditCodeSources.ts`（键、命中与输入准备顺序），`videoEditCodeGpu.ts`（输出复制与借用），`videoEditGpuCompositor.ts`/`videoEditRenderer.ts`（根 owner 生命周期），`videoEditRenderSession.ts`/`videoEditRenderTransport.ts`/`videoEditWorker.ts`（预算额度），共享 LRU 与作者指纹纯函数；新增一个领域输出缓存模块承载条目、迁移、额度和生命周期。不改 React UI、项目 schema、预渲染磁盘格式或助手能力目录。
- 诊断复用现有 renderStages、codeResources、准备计时与 `createLogger`：统计 GPU/RAM hit、miss 原因、淘汰、保留/在途/退休字节和观察补算；迁移 start/completed/failed 走现有日志，高频汇总用 debug/trace。不得把键、格式代次或计数加到正式界面。
- 实现提交前按 L2 规则由干净上下文审查，重点检查完整键、可变纹理别名、局部失效、观察一致性与取消/回收；本轮没有实现 diff，不代替 Claude 与审查员的设计批准。

## 11. 需要 Claude 裁定

1. 批准范围：生成片段作者输出 + GPU/RAM 两层，附加代码滤镜、跨 Worker 共享、磁盘与透明分块不在本票；frameKey 跨时间复用遇观察信息不匹配时允许该片段单独补算。
2. 批准初始总预算 GPU 256 MiB / RAM 512 MiB、前台 3/4 配额与空闲降级策略。数值是设计起点，尚无本票真机依据；实现后的取舍按实测命中与交互数据裁定，不加用户开关。
3. Claude 与审查员均批准，且 ticket 11 合并后才实现。ticket 09 已裁定的“精度不进内容指纹、实际格式进资源键、保留 carriesLight”不重新引入相反方案。

## 12. 外部资料与适用边界

- [WebGPU 规范：纹理拷贝](https://www.w3.org/TR/webgpu/#texel-copies)、[buffer 映射](https://www.w3.org/TR/webgpu/#buffer-mapping)、[纹理销毁](https://www.w3.org/TR/webgpu/#texture-destruction)：支持同格式 GPU 拷贝、按布局读回与明确资源寿命的设计。队列排序与映射等待不等价于每帧同步整条队列。
- [VGPU 官方性能模型](https://github.com/vercel-labs/vgpu/blob/main/docs/topics/performance-model.docs.md)：绑定缓存按资源身份，bundle 不是像素缓存，替换被采样资源可能使 bundle 失效；本票不把 VGPU 的绑定/管线缓存当作者输出缓存。
- [VGPU 官方 context 文档](https://github.com/vercel-labs/vgpu/blob/main/docs/topics/concepts-context.docs.md)：复用 context 与长期资源。当前会话未加载 vgpu MCP，vgpu.sh 文档入口读取失败，已回退官方仓库文档及本地包 README；不基于网上新版示例改变本项目 VGPU API。
- [lru-cache 官方文档](https://isaacs.github.io/node-lru-cache/)：按大小限制与释放回调的成熟实现对照；本票采用项目现有租借缓存，不新增依赖或安装操作。

## 13. Claude 裁定（10-31）
1. 批准范围：生成片段作者输出 + GPU/RAM 两层；附加代码滤镜、跨 Worker 共享、磁盘与透明分块不在本票；frameKey 跨时间复用遇观察信息不匹配时该片段单独补算。
2. 批准初始预算 GPU 256 MiB / RAM 512 MiB、前台 3/4 配额与空闲降级；实现后按真机命中与交互数据调整，不加用户开关。
3. ticket 09 的精度裁定不变；实现等 ticket 11 合并后开始。
