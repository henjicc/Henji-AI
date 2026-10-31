摘要：第一步只做 GPU 效果链按内容提升、作者层栈和片段/嵌套/转场浮点交接。
边界：不改持久格式、作者 API、界面或精度指纹；Canvas 与运动模糊不触发；第 10 节为最终裁定。
状态：设计已按裁定收敛；第一步实现后基准超出性能门槛，已停止，数据与未完成项见 result.md。

# 09 按内容自动高精度合成

## 1. 基线与统一语义

复用 VideoEditGpuCompositor、VideoEditAuthorRuntime、VideoEditBuiltinEffectsGpu 与现有 pass 规划器，共用 Worker/GPUDevice。rgba16float 只改变存储精度，继续预乘、编码域 RGB；保留发光 shoulder、固定抖动、carriesLight 与 ticket 05 的普通后处理隔离边界。现有 10 位与嵌套画面须回归不变。

## 2. 判定与执行

- 有效 GPU 链中的 glow、gaussian/directional/zoom/lens blur、pose.blur、vignette、color_grade 的曲线/LUT/暗角触发；尊重停用、amount=0、恒等旁路与 glow source 视图。
- 其他逐像素颜色调整、运动模糊、原生 WebGPU/WebGL 输出、未知作者代码、Canvas 渐变/阴影/混合均不触发；接到浮点输入则保留。
- shaders 图先检查当前框架真实输出格式；无浮点出口则保持当前路径，不增加适配或依赖升级。
- 片段在 normalize 前直接按已解析效果列表归并全链需求。作者保持现有回调顺序与次数，层栈从 8 位开始，遇首个可见触发层申请 16f、复制已画部分再继续；不做两阶段准备，不依赖上一帧或静止分组历史。
- 精度由当前内容与算法决定，不进 frameKey、指纹或窗口 hash；算法失效由 VIDEO_EDIT_RENDER_ENGINE_VERSION 负责。

## 3. 浮点交接

| 交接点 | 本步处理 |
| --- | --- |
| Canvas、图片、文字、原生作者源 | 保持 8 位源；bitmapOf/BitmapBridge 图片参数为已知 8 位边界 |
| 作者效果 output/underlay/mix/over/pose.blur | 全链按需求使用 16f；已有精确高斯 32f scratch 保持 |
| 作者层栈/mip/曝光合成 | attachment 与 pipeline 跟实际格式；运动模糊本身不触发 |
| 片段 normalize/效果/amount/mask | 第一项计算前归并需求，浮点输入不降档 |
| 嵌套/调整层/转场 | 继承依赖精度；最终由正式固定抖动呈现 |
| 作者滤镜 | 目标跟输入格式，现行契约允许 16f；格式不匹配须给可读错误 |
| 预热/试渲染/native override | 复用正式作者链；不得隐性转成 8 位位图 |

## 4. Shader 兼容边界

8 位 shader 模块文本逐字节保持；另建浮点变体，仅预乘代码画面输入去掉交接钳制，视频/图片仍 clamp(rgb,0,1)。不复用 extendedRange，不改修图共用生成器或 CPU 参照。保留现有非线性滤镜/转场的零 alpha 光隔离语义。

## 5. 资源生命周期与容量

逐项处理 CodeGpu.texture 的 512MiB/8192 硬拒绝、compositor.prepareImages 代码预算、renderer.checkInputBudget、generatorTargetCapacity 固定四字节估算、spill 高精度抛错。按实际字节统计（含层持久画布），回收闲置及前视，不让内容提升引入固定容量拒绝；设备实际纹理尺寸上限仍需遵守。浮点不走 bitmap spill。两档闲置目标保留到帧边界，按格式缓存管线，取消不发布未提交缓存，dispose 清零。

## 6. 缓存与错误

精度不进入内容指纹；GPU 纹理池/效果缓存仍区分实际 format。逐帧覆盖 carriesLight。作者滤镜按 target.format 建管线，格式验证失败附输入/目标格式与可操作说明，沿现有错误与日志通道反馈。Canvas 第二步与 shaders 无浮点出口均不是本步失败条件。

## 7. 测试与基准

L2：跨消费者 GPU 资源与异步状态。只跑匹配精确测试、渲染层类型检查及相关静态门禁，不跑 Reality。

- 真实 GPU：8 位视频/文字/透明叠加/裁剪变换/既有转场对基线逐字节一致（maxDiff=0），含 8→16→8；嵌套与 10 位旧浮点帧不变；8 位 shader 文本相同。
- 超白：两份 RGB=.75、alpha=0 over 约 1.5，再 opacity=.25 约 .375，half 容差 .002。正式 glow 保留既定背景/opacity/顺序语义。
- 交接：作者栈、片段、amount/mask、嵌套、转场、顶层真实格式与数值；普通图像隔离边界单列。
- 状态：触发开关、强度跨零、隐藏层、静态缓存/frameKey 与独立实例历史；格式往返、尺寸变化、取消、设备重建、释放账目、高精度不 spill。
- 同质量/尺寸/素材快照的预览、预渲染、导出编码前 RGBA 相同；有损编码不作为逐字节比较对象。Canvas float16 验证删除。
- 基准：同设备同质量，1080p/4K、0/1/3 全幅 glow、静态命中/动态重画、小 bounds 标题、强度在零附近往返。预热 60 帧、测 300 帧，三轮；准备 CPU 与提交完成墙钟 p50/p95、可用 GPU timestamp、纹理峰值、分配回收与缓存命中、冷编译和边界差异分列。计时内不读回。
- 8 位 pass/submit/upload/回调不增加且无浮点分配；p50/p95 增量筛查 max(.1ms,3%)，超过分析是否可重复回退。高精度门槛见第 9 节。
- 命令：npm run test:gpu -- <相关 gpu 测试>；npm run verify:changed -- --level L2 <本次文件...>，先 dry-run，related 过大时明确直接消费者。
- 提交前独立上下文审查，仅交任务目标、diff 和领域规则；本任务只在指定任务分支本地提交，不推送。

## 8. 已裁定边界

不改作者 API；原生程序不触发。Canvas 与 float16 Canvas 延后；shaders 无浮点出口则保持 8 位。保留 carriesLight、glow shoulder/dither；同质量编码前逐字节比较。上述边界以第 10 节为准。

## 9. Claude 裁定（10-31，已按第 10 节收敛）

- 本步触发与边界以第 2、10 节为准，不包含 Canvas 或运动模糊。
- 不改作者 API 与持久格式；保留零 alpha 光既定语义与同质量编码前像素一致定义。
- 性能门槛：8 位帧不得有可重复回退；1080p 单发光层每帧增量超过 3ms 即停下报告，由 Claude 裁定，不自行增加阈值或开关。Canvas float16 慢 30% 门槛保留给第二步，本步不测。

## 10. 设计审查后的裁定（10-31，优先于前文与第 9 节冲突处）

- **分两步，本票只做第一步**：GPU 效果链触发（glow、模糊类与 pose.blur、暗角、全能调色里的曲线/LUT、作者 `effects(t)` 返回的这些效果）+ 作者层栈 + 片段/嵌套/转场的浮点交接。**Canvas 渐变、阴影、混合模式的触发与 Canvas float16 全部移到第二步**（登记到以后再做第 14 项，等第 16 项做法 2 的 GPU 渐变/暗角/阴影标准件之后再评估是否还需要）。shaders 图：本步确认框架能否给浮点出口；不能就不触发（不另写适配）。
- **运动模糊不触发**（累积本已在高精度里一次写出）。
- **去钳制只给预乘的代码画面输入**；视频/图片素材输入保留 `clamp(rgb,0,1)`。8 位管线的 shader 模块文本逐字节不变，浮点变体另建模块；不复用 extendedRange，不改修图共用的生成器与 CPU 参照。补嵌套序列与 10 位素材帧的回归测试，证明现有浮点帧不变。
- **精度不进指纹**：精度是已散列内容 + 判定算法的纯函数，判定算法变化由 `VIDEO_EDIT_RENDER_ENGINE_VERSION` 覆盖；rgba16float 的渲染、混合、过滤是 WebGPU 核心能力，不加能力令牌。指纹与 `core/videoEdit/renderCache.ts` 不加精度字段，core 不依赖 engine 判定。
- **判定与会话历史无关**：作者实例的格式按“本帧任一可见层触发”决定；不按静止分组、粘性槽或上一帧状态决定。层栈默认 8 位，遇到首个触发层时向 CodeGpu 申请 16f 目标、拷贝已画部分后继续（不做两阶段准备帧，作者回调顺序不变）；片段链需求由文档里的效果列表直接求得。
- **作者滤镜按现行契约**：输入为 16f 时目标给 16f（author-shaders.md 已写明 target.format 可能是 rgba16float，10 位素材早已如此）；格式不匹配导致的失败要在错误里说明是格式问题，不静默。检查技能示例与内置滤镜有没有硬编码 rgba8unorm，有就改成按 target.format。
- **硬拒绝点全部列出并处理**：CodeGpu.texture 512MiB/8192、compositor.prepareImages 代码画面预算、renderer.checkInputBudget、generatorTargetCapacity（按实际字节）、spill 遇高精度抛错——内容触发后原来能渲染的帧不能因此报错；按容量规则改为按字节计、淘汰闲置与前视，浮点目标不走 bitmap spill。显存统计按字节（含每层持久画布）。
- **bitmapOf/BitmapBridge 交给 Canvas 作者的图片参数**：列为已知 8 位边界，本步不改。
- **8↔16 往返**：两档闲置纹理保留到帧边界，浮点管线可在首次用到时编译但要缓存；基准加“发光强度在 0 附近往返”的场景，记录卡顿与边界帧差异。
- 第 2.3 节第 4–5 条、第 5.3 节第 4 条、第 6.1 节第 1 条、第 8 节 C1/C2、2.1 表格中与本节冲突的内容按本节改写或删除。
