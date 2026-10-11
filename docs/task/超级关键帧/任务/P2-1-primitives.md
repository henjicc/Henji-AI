# t151 / P2-1 动作原语与剪辑界面

状态：实现、精确测试、正式 Electron 截图及完整六目录自动复验通过；阶段人类留出与长录制性能门槛仍未满足。完整复验 308 文件、2458 passed、7 个现有开关基准 skipped、0 failed / pending。总管理者审查后提交，本任务不执行 Git 写操作。

## 实现与边界

- 接手 P1 唯一 `recipe / recognition / motionCompiler`，保留原来的回弹、停顿及正式标量曲线求值链，没有新增播放器或运行时配方解释器。
- 14 个严格原语：follow_path、move_line、move_arc、orbit、overshoot、bounce、spring_settle、swing、pulse、spin、sway、zigzag、scale_focus、dwell。空间弧线由法线方向的二次曲线定义；时间由独立 linear / bezier 定义，不能把空间控制点当成时间缓动。
- `cycle` 是不递归的编译期组合：明确模板、loop / pingpong、整数 periodFrames。有限区间展开成普通关键帧；要求完整周期，拒绝未经明确确认的半截尾周、开放 loop、奇数帧往返周期。保留并验证原有 pins。
- 连续循环检查模板位置和速度闭合；接缝及往返转向前后增加局部锚点，普通贝塞尔端柄约束为同一原生单位速度，再按正式宿主求值重新验证误差。往返转向速度为零。
- 频率约束按整数帧可表达的相位分别检查：zigzag 每段至少一帧；bounce / pulse 每周至少两帧；orbit / swing / sway / spring 每周至少四帧；cycle 至少两帧、往返为偶数帧。最终仍由实际原生拟合误差决定接受。两帧 bounce / pulse / pingpong 与小幅四帧 orbit 可接受；大幅四帧 orbit 因真实误差超预算拒绝，不设统一八帧门槛或产品数量上限。剪辑入口也移除原有统一十六帧门槛。
- 批量配方在编译前校验全部 take target、属性、区间与映射；未知字段、未知 target、缺少区间边界样本、同对象同属性的重叠区间（跨 take 别名仍按稳定 ref 检查）、超出原生 rotation 范围均拒绝，不截断角度或吞错。配方必须保留原目标可编辑属性授权，不能通过缩窄/替换目标描述来扩大授权。
- 识别在重采样的 65 个特征点上比较位置、角度、对数缩放、方向变化、速度和停顿。此为分类计算预算，原稿及编译输入不降采样。两端点不能作为语义证据；单弧线与单次抛物弹跳无法区分时保留候选并拒绝自动决定。垂直缩放变化计入缩放证据，不能只读水平缩放误判停顿；变化锚点不属于这些固定锚点原语时明确拒识。
- 候选仍经既有草稿流程确认、应用与撤销。自动识别只在单 take、有足够内部轨迹且无明确用户 intent 时补充候选；不会从端点虚构动作。剪辑选项增加弹跳、环绕、往返。

## 算法选型

调研的一手来源：

1. [DTAIDistance DTW 文档](https://dtaidistance.readthedocs.io/en/latest/usage/dtw.html)：成熟 Python/C 实现，支持多特征、带窗口、剪枝和线性内存距离计算。适合离线对照，但引入 Python/C 运行时不符合本次已有 TypeScript Worker 核的轻量部署边界。
2. [dynamic-time-warping JavaScript 实现](https://github.com/GordonLesti/dynamic-time-warping)：可直接在 JS 中使用，但公开实现的完整距离矩阵与本次明确的窗口及可取消需求不匹配，未直接引入依赖。
3. [hmmlearn 官方教程](https://hmmlearn.readthedocs.io/en/latest/tutorial.html)：HMM 需要训练、状态数量和留出数据选择；当前没有独立标注与留出证据证明优于规则或 DTW，因此不使用 HMM。
4. 原生曲线转换继续复用仓内 P1 的 `fit-curve@0.2.0` 与正式 videoEdit 贝塞尔求值，不重复拟合链。

本次比较规则与 Sakoe–Chiba 窗口 6 的多特征 DTW（两行 Float64 距离缓冲、可取消）。窗口算法是可核查的短基准核，不新造通用 DTW 框架。两者先通过同一保守几何门槛生成可解释假设；规则直接保留原时间，DTW 只比较分类距离，不用于改变时间或宣称拟合误差通过。

当前闭合夹具上规则与 DTW 同分，未形成 DTW 胜出的证据；生产默认规则，DTW 保留为独立比较入口。没有凭这组成绩引入 HMM。以下成绩是独立解析夹具的确定性结果，不能替代 R03 真实人类留出、噪声统计或大规模泛化成绩。

同轮 14 个夹具的分类 CPU 耗时：规则均值 1.138 ms、P95 4.698 ms；DTW 均值 1.247 ms、P95 5.627 ms。样本量小且包含冷热混合，只用于本轮对照，不是 Worker 端到端或长录制预算。窗口核每个模板两行距离缓冲为 1056 字节（不含特征与假设对象）。规则在本轮同分且略快，因此保持默认。

## 原语成绩

`fixtures/primitiveFixtures.ts` 的参考公式独立于编译器。每种原语包含：241 帧可区分轨迹；叠加移动、旋转、缩放而不属于单原语的混淆轨迹；只有两端点的无证据轨迹。另加数学上同形的 arc / bounce 混淆样本。原生误差逐四分之一帧求值，峰时由正式标量曲线极值求出。

| 原语 | 规则 Top-1/Top-3 | DTW Top-1/Top-3 | 混淆/无证据拒识（两算法） | K | 最大位置误差（画面比例） | 峰时误差（帧） |
| --- | --- | --- | --- | ---: | ---: | ---: |
| move_line | 1/1 | 1/1 | 1/1 | 2 | 1.788e-8 | 0 |
| move_arc | 1/1 | 1/1 | 1/1 | 3 | 2.250e-8 | 0 |
| follow_path | 1/1 | 1/1 | 1/1 | 37 | 0.00023134 | 0.635 |
| orbit | 1/1 | 1/1 | 1/1 | 17 | 0.00021259 | 0 |
| overshoot | 1/1 | 1/1 | 1/1 | 3 | 2.950e-8 | 0 |
| bounce | 1/1 | 1/1 | 1/1 | 7 | 9.159e-9 | 0 |
| spring_settle | 1/1 | 1/1 | 1/1 | 22 | 0.00008914 | 0.620 |
| swing | 1/1 | 1/1 | 1/1 | 17 | 0 | 0 |
| pulse | 1/1 | 1/1 | 1/1 | 9 | 0 | 0 |
| spin | 1/1 | 1/1 | 1/1 | 2 | 0 | 0 |
| sway | 1/1 | 1/1 | 1/1 | 9 | 0.00012747 | 0 |
| zigzag | 1/1 | 1/1 | 1/1 | 9 | 3.725e-9 | 0 |
| scale_focus | 1/1 | 1/1 | 1/1 | 2 | 5.529e-9 | 0 |
| dwell | 1/1 | 1/1 | 1/1 | 2 | 0 | 0 |

按类别宏平均：规则和 DTW Top-1 / Top-3 均为 100%；混淆拒识与无证据拒识均为 100%。每类目前只有上述解析样本族，分母小，不能称为真实人类识别率。arc / bounce 同形样本两算法都拒识。峰值误差最大为 spring 的 0.00003808；旋转最大误差为 swing 的 0.004863°；缩放最大误差为 pulse 的 0.00021245。完整数据位于 `node_modules/.cache/t151/primitives.json`。

120 帧一周、两周 orbit cycle：K=21，接缝左右速度差 `[5.4843e-7, 0]`（画面比例/帧，有限差分步长 0.001 帧）。两周与往返转向均通过普通曲线求值，额外接缝锚点不是运行时循环状态。

## 界面修复与根因

1. 节目监视器：`PanelTrigger` 带 `label="标注"` 会进入表单字段的两行布局；命令带去掉表单标签，保留当前动作名称，统一小号单行触发器。
2. 关键帧属性：原行 `flex-wrap` 与有关键帧时的缩进把标签、导航和数值挤成两行。改为单行，标签可省略并有完整 title，数值收至 16 宽度，导航组不换行；保留所有上一帧/开关/下一帧/轨道按钮。
3. 讲解审阅：删除常驻坐标和重叠流程说明；隐私告知精简为“关闭审阅后删除临时原音。”。候选文字在有限宽度内省略，完整名称保留 title。
4. 白色阶梯：核对原始 `.reality/t150-recording-r10/1440x900-video-edit-explanation-step-016.png` 与旧场景源代码，场景刻意添加 `overlap-clip`（scale .3）与原片段（scale .35）重叠，移动其中一个后露出另一个。是两个真实素材的正常合成，不是残影、缓存位图或渲染缺陷；不改渲染器掩盖真实内容。
5. 窄面板：讲解会话 Virtuoso 改成外层确定高度，避免虚拟列表零高；候选名称与审阅侧栏限制在父级宽度内。核心 Overlay 属于 t149，本任务没有修改。

## 正式 Electron 截图与逐帧序列

验收场景 `video-edit-primitives` 使用正式 Electron、已有受管文档和正式应用操作；只阻断付费入口，不替换播放器或曲线。`t151-primitives-final` 已通过：保存 9 张步骤截图与逐整数帧 0–240 的两周 orbit 原始截图，241/241 presentedFrame 与请求一致。保存内容是普通曲线，手改贝塞尔后确认曲线变化；撤销手改精确恢复原曲线；撤销应用移除整组新曲线。paidCalls=0。

- [弹跳候选](../../../../.reality/t151-primitives-final/1440x900-video-edit-primitives-step-002.png)、[环绕候选](../../../../.reality/t151-primitives-final/1440x900-video-edit-primitives-step-003.png)。
- [应用普通关键帧](../../../../.reality/t151-primitives-final/1440x900-video-edit-primitives-step-004.png)、[普通贝塞尔手改](../../../../.reality/t151-primitives-final/1440x900-video-edit-primitives-step-005.png)、[撤销手改](../../../../.reality/t151-primitives-final/1440x900-video-edit-primitives-step-006.png)、[撤销应用](../../../../.reality/t151-primitives-final/1440x900-video-edit-primitives-step-007.png)。
- [首帧](../../../../.reality/t151-primitives-final/1440x900-video-edit-primitives-orbit-frame-000.png)、[转向 30 帧](../../../../.reality/t151-primitives-final/1440x900-video-edit-primitives-orbit-frame-030.png)、[转向 60 帧](../../../../.reality/t151-primitives-final/1440x900-video-edit-primitives-orbit-frame-060.png)、[接缝前](../../../../.reality/t151-primitives-final/1440x900-video-edit-primitives-orbit-frame-119.png)、[接缝](../../../../.reality/t151-primitives-final/1440x900-video-edit-primitives-orbit-frame-120.png)、[接缝后](../../../../.reality/t151-primitives-final/1440x900-video-edit-primitives-orbit-frame-121.png)、[两周末帧](../../../../.reality/t151-primitives-final/1440x900-video-edit-primitives-orbit-frame-240.png)。全部原始逐帧截图保留在同目录，不是从动画插值生成的帧。

逐张目视检查了 r4 的 241 张原始帧（13 张只用于检查的裁切联系表），以及 final 的各步骤和讲解场景 21 个步骤。两周连续、转向清楚，无缺帧或历史白色像素；初轮步骤图抓到了浮层入场动画，final 增加稳定等待并重拍。正常浮层使用内部纵向滚动，根宽度/scrollWidth 都为 288 DIP；单一主动作断言通过。[候选与主动作完整画面](../../../../.reality/t151-primitives-final/1440x900-video-edit-primitives-step-009.png)。

额外将 final 的 241 张实际白色素材质心与保存曲线的正式 `evaluateVideoEditKeyframes` 对账：以原始 2162×1353 截图中实际节目黑色区域（472,179,1141,642）标定，最大差 0.725 个物理像素；0/120/240 帧同位置。诊断数据 `node_modules/.cache/t151/native-frame-errors.json`。这是像素呈现证据，和上述编译期 cycle 接缝速度指标分开统计；GUI 使用两周 orbit 原语，显式 cycle / pingpong 的速度契约由精确测试验证。

| 界面问题 | 修复前 | 修复后与目视结论 |
| --- | --- | --- |
| 命令带两行 | [t150-016](../../../../.reality/t150-recording-r10/1440x900-video-edit-explanation-step-016.png) | [t151-016](../../../../.reality/t151-polish-r1/1440x900-video-edit-explanation-step-016.png)：移除表单 label，单行；DOM 高度 40.72 DIP。 |
| 有关键帧属性两行 | [t144-013](../../../../.reality/t144-video-motion-final/1440x900-video-edit-motion-draft-step-013.png) | [t151-004](../../../../.reality/t151-primitives-final/1440x900-video-edit-primitives-step-004.png)：保留导航且名称/数值同排；行高 31.99 DIP，无横向溢出。 |
| 常驻开发说明与隐私告知 | [t150-016](../../../../.reality/t150-recording-r10/1440x900-video-edit-explanation-step-016.png) | [t151-016](../../../../.reality/t151-polish-r1/1440x900-video-edit-explanation-step-016.png)：说明删除、告知精简，只保留当前确实待确认的起点/终点提示。 |
| 白色阶梯来源 | [t150-016](../../../../.reality/t150-recording-r10/1440x900-video-edit-explanation-step-016.png) | [同样重叠的 t151-016](../../../../.reality/t151-polish-r1/1440x900-video-edit-explanation-step-016.png)；[关闭审阅的 t151-021](../../../../.reality/t151-polish-r1/1440x900-video-edit-explanation-step-021.png)仍相同；[单素材对照](../../../../.reality/t151-primitives-final/1440x900-video-edit-primitives-step-001.png)边缘完整。确认是真实两素材合成，不作伪修复。 |
| 候选与窄面板 | [t144-013](../../../../.reality/t144-video-motion-final/1440x900-video-edit-motion-draft-step-013.png) | [t151-009](../../../../.reality/t151-primitives-final/1440x900-video-edit-primitives-step-009.png)：一项主动作、无 ID/版本外露、可纵向滚动；[讲解候选](../../../../.reality/t151-polish-r1/1440x900-video-edit-explanation-step-018.png)在窄侧栏内。 |

讲解场景复用 t150 正式 AudioWorklet / 时钟 / 受管记录，只替换付费 ASR 边界为明确毫秒 DTO；不把它当作真实 ASR 准确率。`t151-polish-r1` 通过，零真实付费调用。两轮 Reality 均独立获锁并在结束后释放；没有启动或重启 electron:dev。

加强复核 `t151-primitives-demonstrated` 通过：真实鼠标手势按 32 个时间位置摆出两周环绕，没有注入草稿样本；先不指定原语点击整理，断言实际 UI 出现“沿椭圆环绕”自动候选，再选择弹跳/环绕对照并重复应用、手改、撤销及 241 帧捕获。paidCalls=0。[环绕对照](../../../../.reality/t151-primitives-demonstrated/1440x900-video-edit-primitives-step-003.png)、[应用后的单行属性](../../../../.reality/t151-primitives-demonstrated/1440x900-video-edit-primitives-step-004.png)。该轮也独立获锁、及时释放。


最新短周期边界代码构建后的 `t151-primitives-grid-final` 再次通过：9 张步骤、241 帧，自动环绕候选、普通贝塞尔编辑与两次撤销均验证。逐张检查了全部步骤及 13 张联系表覆盖的全部原始帧；重新按本轮保存曲线进行像素对账，最大差 0.596 个物理像素，0/120/240 同位置（`node_modules/.cache/t151/native-frame-errors-grid.json`）。[最新环绕候选](../../../../.reality/t151-primitives-grid-final/1440x900-video-edit-primitives-step-003.png)、[最新单行属性](../../../../.reality/t151-primitives-grid-final/1440x900-video-edit-primitives-step-004.png)、[最新主动作](../../../../.reality/t151-primitives-grid-final/1440x900-video-edit-primitives-step-009.png)、[两周逐帧索引](../../../../.reality/t151-primitives-grid-final/index.md)。本轮 paidCalls=0，锁已释放。实际 GUI 保存曲线另按 1280×720 / 30fps、有限差分 0.001 帧核对第 120 帧与两周首尾接缝，速度差范数均为 0.000349 短边/秒，低于 0.005 门槛；不是只验证位置闭合（`node_modules/.cache/t151/gui-seam-velocity.json`）。后续单通道拒识及批量授权/重叠修改由精确测试覆盖，不将此轮截图宣称为变化锚点或非等比缩放的视觉验收。

## 检查与验收状态

- 原语精确测试：22/22 通过；含 P1 编译器的最终两文件 34/34 通过，剪辑接入 12/12 通过；P1 运动/布局/剪辑接入和候选相关六文件曾 82/82 通过，后续循环修改由新精确测试覆盖。
- `npx tsc -p tsconfig.json --noEmit`、`npx tsc -p tsconfig.electron.json --noEmit` 与改动文件 ESLint 通过；渲染层 tsc 首轮内存不足，串行限制半空间重跑后通过。
- dependency-graph、dead-code、ui-residue、surface、colors、icons 通过。
- assistant-capabilities 结构和覆盖检查通过；默认并发 invariants 退出失败，限制线程及单进程后 31 文件 / 206 测试通过。
- 用户指定六目录测试首轮不通过：Node 下原生 SQLite 运行器门槛；单 fork 跨文件原型污染；工作进程堆溢出。四个污染文件隔离复核 28/28 通过。早期 Electron Node 轮次仅汇总字段显示 308 文件 / 2462 项全通过；逐断言复核实际 2399 passed、56 pending、7 skipped，因此撤回该轮完整通过结论。后续 Electron Node 轮次在 2396 项实际通过后剩余 GPU 未完成，已结束本任务该轮进程树。正式 Node 的 gpu 模式四角定位实际执行 1002 ms 并通过，证明需按既有单测/GPU/原生运行时分层验收。中间两次复验因继续补齐单通道与批量授权边界而主动中断，仅结束明确核对过的本任务测试进程树，不计通过。
- 最终同一六目录的完整 308 文件按正式 `testSuites.cjs` 分层执行，CLI 均带 `--silent --poolOptions.threads.maxThreads=3 --poolOptions.threads.minThreads=1`，实际采用隔离 fork 单并发：unit 在 Node 下 296 文件 / 2398 passed / 3 skipped；gpu 在 Node 下 11 文件 / 57 passed / 4 skipped；native 在 Electron Node 下 1 文件 / 3 passed。合计 2465 项、2458 passed、7 skipped、0 failed、0 pending。三层进程退出均为 0，逐文件集合与原始六目录发现清单完全一致，没有排除用户指定文件；逐断言核对状态和失败信息，不能只看汇总 success。证据 `node_modules/.cache/t151/layered-final-proof.json` 与 `layer-final-{unit,gpu,native}.json / .log`。中间缓存核对脚本因允许列表漏掉既有 GPU 开关基准而拒绝汇总，补齐逐标题源代码证据后复用已通过的 unit / gpu 报告，仅继续执行 native；没有改测试或重复测试。
- 7 个跳过项均为原命令默认关闭的现有显式开关基准：4K/8K 保存（`HENJI_IMAGE_SAVE_BENCH`）、遮罩手势（`HENJI_MASK_BENCH`）、剪辑手势（`HENJI_GESTURE_BENCH`）、高斯热执行测量（`HENJI_GPU_MEASURE`）、参数写入 GPU 测量（`HENJI_PARAMETER_BENCH`）、500 片段/字幕压力基准（`HENJI_VIDEO_PRESSURE_BENCH`）、组件 sweep（`HENJI_SHADER_SWEEP`）。具体文件及完整标题列入 proof；这些未执行项不计通过，不作为本任务性能门槛证据。
- 分层初轮 Node 三线程退出：V8 原生 Zone 分配失败（本机提交量不足），未生成有效报告；改为隔离 fork 单并发，未关闭用户程序。
- Reality 前三轮构建失败：原生 Rust 缺少 VS INCLUDE/LIB；提交量不足的进程退出；3 GiB 堆不足。设置单次 VS 开发环境、限制半空间并给串行构建 6 GiB 堆后，r4 正式轻量构建与场景通过，final 和 polish 复用新产物通过。没有关闭用户程序，各轮锁均已释放。
- 新增单通道测试首轮将所有垂直缩放都要求拒识，发现“保持焦点推近”在焦点对应当前位置时可合法解释该动作；改为准确断言“不判停顿”，变化锚点要求拒识。22/22 最终通过，未关闭合法动作来满足测试。

## 未完成项与总管理者注意

- 截图、逐帧序列与完整六目录自动复验已完成；因下述人类留出与性能证据尚缺，当前不能标为 P2-1 整阶段验收通过。
- 真实人类 R03 留出、03 §5.5 三人对照、长录制冷热预算尚未采集，解析夹具不代替这些阶段门槛。
- P1-5 的公共实体和算法能力仍由总管理者注册；本次沿用已有草稿操作，不声称新增原语已作为独立 MCP 动作对外接通。
- `motionOptions.intent` 是草稿落盘内容，严格 schema 扩展涉及当前格式指纹/公共格式台账。本任务禁止触碰 `src/core/persistence/**` 与格式夹具，请总管理者串行核对并更新；不写旧格式迁移。
- 构建副作用：正式 `test:reality --build` 调用既有 `electron:bundle`，其 `generate-catalog-index.cjs` 会重写 `packages/ai-sdk/src/catalog/index.ts`，删除并重建 `src/packs/{models,provider-adapters,provider-packs}`。本任务没有事先隔离这一环节，属于文件所有权之外的自动写入，不能声称完全没有碰 SDK。当前 145 个被 Git 标为改动的生成文件已与 HEAD 逐文件、逐字节核对，全等，内容差异为零；未执行任何 SDK 手改/还原/暂存。完整路径、字节比较及换行证据在 `node_modules/.cache/t151/sdk-generation-side-effects.json`，请总管理者确认生成文件状态，不混入本任务提交。
- 并行 t149 的 Overlay、图片编辑、settings、persistence 文件未修改；共享场景索引只新增视频 require 与视频场景行。禁止将工作区其他改动算入本任务。

## 设计自查

1. 助手只凭名称和说明能否用对？内部原语有明确语义、单位、target 与区间拒绝；现有草稿操作可调用。独立原语公共能力仍待 P1-5 注册，不能提前宣称完成。
2. 能否 AI 先做、人只确认？有足够轨迹时自动提供保守候选；歧义和无证据拒识，由人选择，应用后仍可普通贝塞尔手调与撤销。
3. 产物能否直接流进其他工作区？编译产物是既有普通关键帧曲线，保留正式剪辑导出与作品引用；没有新增独立媒体或私有播放器。静态布局核未改，跨宿主公共配方入口待总管理者接通。
