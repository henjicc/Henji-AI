摘要：在现有剪辑渲染 Worker 内增加实例独占的固定步长模拟；沿用 draw／layers／createWebGL／createWebGPU，新增 createSimulation 工厂与只读取样接口。
摘要：默认 120 步/秒、每 120 步快照；最近整秒快照仍在时中心帧最多补 120 步，冷跳转与快照淘汰后的成本按实际历史长度计算，不承诺恒定毫秒数。
摘要：物理候选为 Rapier 3D deterministic-compat 0.21.0，精确钉住并离线加载；本文件待 Claude 与审查员批准，当前不改源码、不安装依赖、不提交或推送。

## 1. 范围、依据与基线

- 本票依据：[plan.md](./plan.md)、[以后再做.md 第 5 项](../../../Henji-AI-t17/docs/task/代码效果与渲染改进/以后再做.md#5-模拟运行时原第-9-项)。交付包含参数驱动的物理与一般 CPU 累积模拟、任意时刻求值、快照、取消、既有渲染入口集成；不包含 GPU 状态快照、流体求解器、媒体像素反馈、交互事件录制或新的模拟编辑界面。
- 本轮代码核对基线为 `task/17-模拟运行时` 的 `90103a8f3bceb6b3d8c88b87f7302a461c390797`；该分支工作区干净、无上游。共享 main 在并行工作中已前进，本文不切分支、不 rebase；实现前由 Claude 串行同步基线并分配共享文件。
- 唯一持久真相是已有代码版本、库 pin、参数与源时间关键帧。World、快照、视图与推进位置都是可重建状态，不写入工程、不进入撤销栈；改变参数或源码仍走现有业务事务、撤销与保存。
- 当前 [videoEditAuthorModule.ts:14](../../../Henji-AI-t17/src/features/videoEdit/engine/videoEditAuthorModule.ts#L14) 的 `AuthorFrameInfo` 及 `AuthorModule` 没有模拟接口；[videoEditAuthorDeterminism.ts:13](../../../Henji-AI-t17/src/features/videoEdit/engine/videoEditAuthorDeterminism.ts#L13) 只在同步调用栈替换随机数和时钟，不能使累积状态自动支持乱序求值，也不覆盖 await 后的代码。
- [videoEditAuthorPrograms.ts:15](../../../Henji-AI-t17/src/features/videoEdit/engine/videoEditAuthorPrograms.ts#L15) 按 bundle 共享模块，按实例键创建 runtime。模拟的可变对象必须放在实例工厂内；不能放在模块顶层、共享库单例或 `globalThis`。
- 现有 [videoEditCodeFingerprint.ts:76](../../../Henji-AI-t17/src/features/videoEdit/engine/videoEditCodeFingerprint.ts#L76) 与 [videoEditAuthorFingerprint.ts:47](../../../Henji-AI-t17/src/features/videoEdit/engine/videoEditAuthorFingerprint.ts#L47) 会执行作者 layers、pose、effects、draw。模拟不能通过这些调用次数推进。

## 2. FrameFlow 对齐范围与作者契约

2026-11-01 读取的 FrameFlow MCP `guide({topic:"codefx/authoring"})`，资料 URI 为 [frameflow://guides/codefx/authoring](frameflow://guides/codefx/authoring)，知识库入口版本为 `1.0.0-beta.6`。该手册公开了 draw、layers、createWebGL、info.time／clip 与运动模糊；没有 createSimulation、固定步长或快照的公开签名，且确定性章节要求不能累计帧间模拟。因此下列模拟接口是 Henji 提案，不能标成“已与 FrameFlow 模拟 API 二进制兼容”。已有绘制函数形状保持一致；跨产品直接复用模拟部分须等 Claude 提供或确认 FrameFlow 对应契约。

### 2.1 接口决定

沿用“模块声明 + create 工厂 + 实例方法”的形状，与 createWebGL／createWebGPU 一致。一个作者效果实例拥有一个模拟实例，内部可以管理多个物理世界或粒子集合；不另建全局模拟注册表。

```ts
type SimulationData = null | boolean | number | string
  | SimulationData[] | { [key: string]: SimulationData }
  | ArrayBuffer | ArrayBufferView;

interface AuthorSimulationInfo {
  readonly step: number;       // 当前整数步号
  readonly time: number;       // step / rate，源时间秒
  readonly dt: number;         // 1 / rate
  readonly random: () => number;
}
interface AuthorSimulation<S extends SimulationData, V extends SimulationData> {
  step(params: AuthorParameters, info: AuthorSimulationInfo): void;
  snapshot(): S;
  restore(snapshot: S): void;
  read(): V;
  interpolate?(left: Readonly<V>, right: Readonly<V>, alpha: number): V;
  dispose(): void;
}
interface AuthorSimulationDeclaration {
  rate?: number;               // 默认 120，正安全整数
  snapshotEvery?: number;      // 默认 120，正安全整数
  seed?: number;               // 默认 0，uint32
}
// AuthorModule 增量；仅新作者 API 识别。
simulation?: AuthorSimulationDeclaration;
createSimulation?(params: AuthorParameters, width: number, height: number,
  info: AuthorSimulationInfo): AuthorSimulation<SimulationData, SimulationData>
  | Promise<AuthorSimulation<SimulationData, SimulationData>>;

// AuthorFrameInfo 增量；绘制阶段可用，frameKey 阶段不提供可读状态。
simulation?: {
  at(sourceSeconds: number): Readonly<SimulationData>;
};
```

- 工厂存在即启用模拟；`simulation` 元数据用于调度，只有声明而没有工厂属于契约错误。默认值归作者 API 管理，代码版本固定后不因设备、输出帧率或预览倍率改变。声明 `mode:"static"` 同时启用模拟属于语义冲突，发布检查明确报错，避免进入现有静态输出缓存。
- `createSimulation` 接受源时间 0 的参数与逻辑作者画幅；info 的 step/time 为 0。允许异步准备 Rapier，等待由宿主控制；准备完成之后，step、snapshot、restore、read、interpolate 都是同步方法。
- `step(P(n/h), {step:n,time:n/h,dt:1/h,random})` 负责从 S(n) 推到 S(n+1)。宿主每个整数步最多推进一次当前分支，作者不得根据 draw 次数补步。不能用当前请求帧的参数代替整段历史参数。
- `snapshot` 返回完整可恢复状态，宿主复制所有权；restore 收到独立副本，可消费它。数据允许普通树状对象、数组和数值缓冲，不承载函数、World、刚体包装对象、纹理、DOM 或共享可变引用。自定义类由作者序列化为普通数据；运行状态的其他闭包变量也必须包含在快照里。
- `read` 返回当前完整步用于绘制的独立视图，不返回可继续 step 的 World。宿主保存只读视图；普通对象递归冻结，TypedArray 通过副本避免暴露缓存的可写底层存储，不假定 `Object.freeze` 能冻结 TypedArray 元素。
- 未声明 interpolate 时，`at(t)` 返回 S(floor(t·h)) 的视图，明确为保持采样；声明 interpolate 时在相邻完整步视图间采样。插值不得修改物理世界、快照或任一输入。角度／旋转插值由作者按对象语义选择，已有 Three 的向量和四元数插值可直接复用，不在宿主发明通用状态插值算法。
- draw／layers／WebGL／WebGPU 签名不变，作者通过 `info.simulation.at(t)` 取样；layers 返回的 pose 闭包捕获这一帧的只读取样器，支持乱序、重复与快门子时刻访问。示意：`pose: t => ({x: view(info.simulation.at(t)).x, y: view(info.simulation.at(t)).y})`。`view` 是作者对自身返回数据的类型收窄，不是宿主新库。
- 模拟步输入只包含可重复计算的参数、不可变结构化数据和显式随机源；assets、输入帧纹理、网页当前 DOM、真实时钟、网络响应不是 step 输入。本票不新增这些历史采样能力。绘制阶段继续使用已有媒体接口；需要受音频／网页驱动的模拟，可先通过已有领域能力把分析结果固定成源码数据或结构化参数，再按源时间读取。

### 2.2 时间、参数与尺寸

1. 模拟零点固定在代码素材源时间 0，而非片段入点、首次预览时刻或预渲染窗口起点。[codeMaterialTiming.ts:35](../../../Henji-AI-t17/src/core/videoEdit/codeMaterialTiming.ts#L35) 和 [codeMaterialAnimation.ts:61](../../../Henji-AI-t17/src/core/videoEdit/codeMaterialAnimation.ts#L61) 已使用源时间；裁切／分割保持相同源时刻的状态，倒放只倒序请求状态，绝不负 dt 积分。移动片段不重置物理。
2. 固定步参数通过 `prepareCodeMaterialParameters`／`evaluateCodeMaterialParameters` 在 n/h 源时刻求值，保持现有关键帧前后延拓与插值语义。创建时传 P(0)，推进 n→n+1 时传 P(n/h)。恒定参数、全部曲线与使用的结构化数据构成完整输入定义，不能只存当前帧求值结果。
3. step 不拿 `info.clip`、序列帧率或当前渲染倍率。片段入出场仍可在 draw／pose 里叠加；这样源时间相同、参数历史相同时，裁切、倒放、不同序列帧率不会改变物理轨迹。
4. 工厂的 width/height 取 `codeMaterialSize` 决定的逻辑画幅；Canvas 与原生 GPU 入口的实际像素尺寸差异不得传入模拟。输出 scale／divisor 与精度只影响绘制，不影响碰撞形状、重力、dt 或随机种子。滤镜同样单独传逻辑输入画幅，不能拿缩小后的 input.texture 尺寸初始化世界。
5. 中心源时间尽量保留 `VideoEditSourceTime` 的微秒 + 有理数余量，以整数／BigInt 求步号与余量，最后才转换为作者 number。固定步时间不做 `time += dt` 累加。已有 pose 传入 number 的边界采用与 codeMaterialTiming 一致量级的浮点容差归一到最近步边界，不能用随意的毫秒 epsilon。
6. 本票保留现有 `authorFrameExposure`／`authorLayerSamples` 的源时间曝光语义，逐一按实际传给 pose 的 t 准备，不另写一套快门算法。源时间 <0 的模拟取 S0；声明 durationSeconds 时，超出尾部的取样保持最后可用视图。边界延拓只作用于模拟取样，不改变正式时间线对无效中心请求的校验。最后一个非整步时刻的插值右端可内部多计算一个完整步，参数按既有曲线尾端延拓，不产生可导出的额外时长。

## 3. 固定步长、快照和恢复算法

### 3.1 调度

- 默认 h=120 Hz、dt=1/120 秒，K=120；一秒一个检查点。高频相对于 24／25／30／60 fps 统一采样，不以播放掉帧、机器负荷或交互质量改变积分。源码可以显式选择其他正整数 rate／snapshotEvery，不新增用户设置项；超大规模以耗时与内存事实处理，不设置物体数或时长硬上限。
- 初始化得到 S0 并保留其快照。每完成 K 步，在事件处理和 JS 状态更新之后存 S(mK)，检查点含整数步号、完整快照及身份。普通 JS 累积状态和 Rapier 都走同一调度器。
- `prepare(range, input, signal)` 是宿主内部异步入口。对本帧中心与整个曝光范围计算最小步 a、最大需要步 b（插值时包含右邻步）；取不晚于 a 的最近检查点 c，或位于 c…a 之间且身份相同的当前活动状态，正向推进到 b。沿途保存检查点，收集范围内的绘制视图。
- 绘制前完成 prepare；绘制过程中 `at(t)` 只查本帧准备好的视图并插值，不 step、不 restore、不等待 wasm。超出准备范围的调用报带作者位置的契约错误，不同步启动一次长历史回放。任意目标时刻由下一次宿主帧请求支持，不把同步 at 当成任意历史计算入口。
- 曝光范围事先按模块声明上界确定，不能先调用有状态 pose 猜所需时间。当前 `authorLayerSamples` 会先做探测再选样本，所有探测与正式采样都读同一批视图；层数增加不会让物理重复推进。
- 同一模拟实例严格串行。每批推进在真实宿主时钟经过约 4ms 或完成 32 步时让出 Worker 消息循环并检查 signal／epoch；只让出调度，不更改 dt。单个作者同步 step 的时间不可强制分割，故取消延迟最多为当前同步调用剩余时间加调度开销，不承诺硬实时期限。
- 取消时不发布旧帧或未完成视图；已完成且身份未变的整步检查点可以保留。step／snapshot／restore 抛错后废弃该活动世界，释放资源，保留之前已提交的检查点，沿既有错误通道报告；不得把半步状态继续使用或画成正常空白帧。

### 3.2 成本上界

定义 n=floor(t·h)，b 为完整曝光准备的最大步号，a 为最小步号；C_step 为本次所需各步的最大耗时，C_restore 为对应快照恢复耗时，C_snap 为一个检查点创建／复制耗时，C_view 为一个步视图生成／复制耗时，B 为该检查点字节数。它们随作者算法、物体／接触数与数据量变化，不是固定常数承诺。

| 场景 | 步数与成本上界 |
|---|---|
| 中心帧，整格检查点 floor(n/K)·K 仍在 | 保持采样最多 K−1 步；需要右邻插值最多 K 步。成本 ≤ C_restore + K·C_step + C_snap + 2·C_view，加快照查找／复制成本 |
| 完整曝光，a 前面的整格检查点仍在 | 步数 ≤ K−1+(b−a)；取样视图生成至多 b−a+1 次，检查点创建至多 ceil((K−1+b−a)/K) 次。快门跨多个 K 时不能仍写“最多 K 步” |
| 连续顺播 | 当前状态能接着推进时只付目标差值的步数；相同视图范围重复请求不推进。检查点成本按每 K 步摊销，倒放不适用此顺播界 |
| 首次冷跳到 t，只有 S0 | 中心插值最多 n+1 步；完整曝光最多 b 步，另有 floor(b/K) 次快照与所需视图成本。复杂度随源时间线性增长，不能凭 K 得到 O(1) 冷启动 |
| 检查点被回收 | 从实际保留的 c≤a 恢复，最多 b−c 步；最坏退化到 S0 的 b 步。记录真实 c 与 replaySteps，不把缓存未命中称成快照加速 |
| 已有输出缓存／预渲染帧命中 | 无需创建／推进世界；以后缺帧时按该目标源时间独立恢复，不要求模拟已“播放到”缓存帧 |

检查点用有序步号索引找前驱，查找 O(log M)；索引删除随缓存回收同步进行。完全保留时快照空间约 Σ B(mK)，对长度 T 的均匀状态规模约 O((T·h/K)·B)。绘制视图空间为 O((b−a+1)·V)，不按整个历史保存逐步视图。状态巨大或极长快门时，必要工作集本身可以超过缓存预算，不能把内存软预算冒充整个进程的硬上限。

第一版快照仅在当前 Worker 内存中保留，Worker 内所有模拟共用 64 MiB 的检查点软预算，LRU 淘汰可重建检查点；当前活动世界、S0、进行中的帧所需检查点／视图不在可淘汰集合。二进制按实际 buffer 字节计，JS 结构按确定的编码字节与对象开销估算，诊断区分估算值与实际进程内存。记录总字节及超预算原因；没有可回收项时允许当前工作集超额，空闲后释放。跨 Worker 不共享 World，也不增加快照磁盘格式。因回收不能同时保证永久 K 步跳转上界，这一取舍明确交 Claude 审批。

预渲染使用已有任务调度，以连续源区间预热检查点，再输出帧；不新建“模拟烘焙”业务任务。首次跳到长片尾部需要准备的时间必须作为真实等待计入现有预渲染／渲染状态，不伪装即刻完成。持久快照、全历史保留和跨 Worker 分发不在首版范围。

## 4. 确定性与实例生命周期

### 4.1 完整身份

宿主建立 `simulationEpoch`：作者 API 语义版本、完整源码依赖闭包、固定组件、实际库版本与内容摘要、逻辑画幅、simulation 声明（rate/K/seed）、参数默认值及完整实例参数／曲线、完整结构化数据依赖、模拟实现版本。它是内容身份，不用会话 ID、播放方向、随机 UUID 或全工程 revision 充当输入。K 一并计入以隔离调度策略，虽然正确实现的 K 变化不应改变状态。

- 源码依赖采用完整文件闭包；对模拟不能沿用 frameKey 的 `dataFiles` 排除，因为早先的数据可能改变后续所有状态。绘制键也必须带该模拟身份，不能因当前画面参数相同就遗漏历史。
- 第一版保守地把全部参数曲线与结构化数据计入；任何影响模拟的编辑都失效该模拟全部检查点及后续输出。不做“只使编辑时刻之后失效”的增量证明，也不把不相关片段或无关项目元数据纳入。
- 同一内容可以有相同身份，但实例仍不共享可变 World。复制片段在相同源时刻与相同参数下结果相同；需要不同随机外观时作者显式提供不同 seed，不能隐式掺入 clipId。
- 字体／henji-layout 若参与建立碰撞几何，使用已准备的不可变几何数据及其内容身份；首版工厂不等待布局库内部字体状态。模拟身份至少覆盖对应库 pin 与几何数据。仅绘制使用字体时由既有像素依赖负责失效。

### 4.2 随机数和事件

- 新 API 的 init／step 得到显式 random；按固定算法由声明 seed、阶段和整数步号确定，每步重新开始该步随机序列，恢复时不需要猜测之前调用 random 的次数。整数步号完整参与混合，不能截成 32 位导致长时间循环。同步 `Math.random`／Date.now／performance.now 包装沿用现有机制并以相同步号语义调用，异步工厂 await 后只保证显式 random 可复现。
- 模块顶层保持现有固定 import 随机行为。不得在整个 prepare 的 await 区间替换全局随机数或计时函数，否则会污染 Worker 调度与其他作者实例；预算计时在包装外使用真实 performance.now。
- 物理对象创建、删除与施力按稳定顺序；JS 外部事件若存在于作者数据中，按固定时间与稳定键排序处理。事件队列每个整步消费完再快照；有意延迟处理的事件存进 JS 快照。
- Rapier 的确定性不覆盖作者 `Math.sin/cos` 等跨引擎数值差异、不同几何输入或 GPU 光栅化。首版承诺同一构建、相同输入、同一运行环境的预览／预渲染／导出状态与像素一致；跨平台 Rapier 状态须满足官方初值和顺序前提，最终像素仍按字体、GPU、色彩环境单列验证。

### 4.3 生命周期

- 每个 `VideoEditAuthorRuntime` 持有模拟 session；生成片段、附加代码滤镜、素材试画／预设样片都调用同一 session 实现。模块加载缓存只缓存不可变声明和工厂；工厂内持有世界、事件队列、句柄映射和作者状态。
- 当前帧、预打开、试画、代码观察、预渲染与导出均通过同一 prepare／sample 协议。预打开只能在自己的实例队列内工作，不抢改正在显示帧的状态；观察读当前成功帧保留的取样视图，不能用已经推进到未来的 World 重算旧 pose。
- 参数或源码变更产生新 epoch；取消旧请求后创建新世界，旧 epoch 的迟到结果不能写入新帧／缓存。设备丢失后 GPU 资源按现有路径重建；CPU 模拟可保留或从快照恢复，两者结果必须相同。
- dispose 先置 closed、取消未完成 prepare、等待实例队列退出，再释放 World／EventQueue／作者状态及视图引用。Wasm 编译／模块实例可以按版本在 Worker 内共用，World.free 释放的是世界分配，不能承诺 Wasm Memory 立即缩容或交还全部 RSS。

## 5. Rapier 接入、Wasm 与冻结

### 5.1 候选与依赖安装归属

选 `@dimforge/rapier3d-deterministic-compat@0.21.0`，Apache-2.0，官方发布的确定性兼容构建；0.21.0 的 npm 元数据已核对。普通 compat／SIMD 版本不作为本票物理实现，避免把本机确定性等同跨平台确定性；不采用依赖 React Three Fiber 的封装，因为运行位置是已有非 React 的 Worker；不自研碰撞与约束求解器。2D 专用包暂不安装，二维画面可用普通 JS 累积状态或 3D 世界限制自由度；以后有真实 2D 专用需求时再增加同一协议适配。

| 候选依赖 | 接入决定 |
|---|---|
| `@dimforge/rapier3d-deterministic-compat@0.21.0` | Claude 在主工作区串行安装确切 npm 别名 `henji-author-rapier3d-deterministic-compat-0.21.0`；记录 `npm:@dimforge/rapier3d-deterministic-compat@0.21.0`，不使用范围或 canary |
| 类型声明 | 使用同包 `dist/rapier.d.ts` 及其声明闭包，不额外安装重复运行库或 `@types` |
| 调度／克隆／索引 | 复用宿主时间求值、现有随机函数与 structuredClone；只实现本票必须的检查点调度，不再引入游戏循环或 React 物理框架 |

注册包的 integrity 为 `sha512-n7JuU62Obljlgq+OeH2DHhTmRSjRzwuJPl54tS9pFIzVQyvXsO5CH+a5KkIRBtnFWDbg1Zicv9BulG0jfBAopA==`。正式安装以 npm registry 和 lockfile 校验为准；本轮没有执行 install／ci／uninstall，没有修改联接点。

### 5.2 作者库与初始化

1. 在 [authorLibraries.ts:41](../../../Henji-AI-t17/src/core/videoEdit/codeMaterial/authorLibraries.ts#L41) 追加官方说明符 `@dimforge/rapier3d-deterministic-compat`，保留包名，使作者可以使用官方 API；minApiVersion 指向本票新 API。宿主首个冻结发行号为 **`0.21.0-henji.1`**，与上游 npm 版本 **`0.21.0`** 分开记录；libraries pin 使用前者，`RAPIER.version()` 仍返回后者，不声称 npm 上存在宿主发行号。
2. 当前 `authorLibraryPackageName` 直接拼库名，scoped 包会生成含 `@`／`/` 的非法 npm 别名。登记项增加可选 `sourcePackage: { name, version, alias }`，本项分别为官方包名、`0.21.0`、`henji-author-rapier3d-deterministic-compat-0.21.0`。冻结脚本读取此来源，已有库继续原命名；types 使用 `source:'frozen'`，从同一个安装包生成冻结声明，不重复安装类型包。
3. 新增 `scripts/freeze-rapier-library.ts`，复用现有冻结校验原语，把确切包的 `dist/rapier.mjs`、init 封装、声明闭包及 LICENSE／NOTICE 冻结到 `resources/video-edit-author/frozen/@dimforge/rapier3d-deterministic-compat/0.21.0-henji.1/`。日常 [build-author-libraries.ts](../../../Henji-AI-t17/scripts/build-author-libraries.ts) 只验证并复制 frozen 产物，不重新包第三方源码。正式作者 URL 为 `henji-media://author-lib/@dimforge/rapier3d-deterministic-compat/0.21.0-henji.1/rapier.mjs`；现有协议按路径段定位，`@dimforge` 是独立目录段，不新增 IPC 或下载服务。
4. deterministic-compat 的 wasm 以 base64 嵌在 JS 内，官方 `init(): Promise<void>` 必须完成才能使用 World。生产不访问 CDN，不另 fetch `.wasm`，不采用 Three addon 内置的远程 Rapier 加载器，也不新增 Electron 权限。
5. 在**新版本发行产物**中给该模块的 init 增加一次性 Promise 去重薄封装；多个作者并发请求共享初始化完成／失败结果，其余官方导出保持一致，default 导出的 init 与命名 init 指向同一函数。封装不创建 World，不改变物理算法。首次初始化失败向调用者报错，重新创建执行会话可重试，不在帧循环里无休止自动重试。
6. 作者在 createSimulation 内 `await RAPIER.init()`；模块 inspect／读 metadata 不创建世界、不跑 step。外来内容仍先经过 `assertAuthorTrust`，包括首次模块 import，不以“只读声明”绕过已有信任判断。
7. `release.json` 沿用已有 library/version/inputs/outputs：library 为官方 scoped 名，version 为 `0.21.0-henji.1`，inputs 保存来源清单／lockfile／构建脚本的摘要，来源清单记录官方版本和 integrity，outputs 覆盖全部实际字节。封装或类型有变化时追加 `0.21.0-henji.2`，不得重冻覆盖 `.1`；上游升级则另发对应新版。当前 `scripts/lib/frozenAuthorLibraries.ts` 的历史检查按两层 library/version 解析，须改为从登记 frozen 根和 release.json 确定边界，并对已提交清单继续核验完整文件集合；兼容已有 unscoped 目录，不靠固定路径层数漏检 scoped 库。此为 ticket 10 共用冻结工具的必要接缝。

### 5.3 快照边界

Rapier 作者适配在初始化和恢复后明确设置 `world.timestep = info.dt`，每次宿主 step 调用恰好执行一次 `world.step(...)`，求解器／CCD 设置作为作者初始化数据固定；不依赖 Rapier 默认步长或真实耗时。使用 `world.takeSnapshot(): Uint8Array` 和 `RAPIER.World.restoreSnapshot(bytes)`；完整快照不等于作者全部状态。作者 snapshot 同时保存计数器、粒子出生表、稳定 ID→handle 映射、延迟事件和其他影响未来的 JS 数据。恢复时先构建成功的新 World，再替换并 free 旧 World；旧 RigidBody／Collider 包装对象不能继续引用，通过恢复后的 World 和 handle 重新获取。EventQueue／事件回调按既定设置重建，不假定它们在 World 字节里。

只恢复与相同 Rapier 包、发行摘要、作者 API、simulationEpoch 相符的快照；本票内存快照无需跨版本迁移。无匹配身份时从 S0 重建。未来如做磁盘快照，须按可重建缓存独立标版本与内容身份，不能把 Rapier 二进制当用户工程的长期兼容格式。

## 6. frameKey、帧指纹、片段输出和预渲染

| 层次 | 本票关系与失效条件 |
|---|---|
| 模拟检查点 | 保存可继续推进的状态；按 simulationEpoch + step 寻址，独立于输出像素缓存；缓存命中不意味着某个 World 已到达该时刻 |
| 作者 frameKey | 仍是纯函数；不能读取或推进 simulation。宿主在其外层加入模拟身份及精确中心／曝光采样身份，作者常量 frameKey 不能合并不同模拟时刻。模拟源码的 dataFiles 全计入模拟身份 |
| 帧指纹 | 模拟模块走新的纯身份路径，增加 `method:'simulation'`；基于完整模拟身份、中心与曝光时间、逻辑／输出尺寸及正式绘制依赖生成保守指纹，不调用 layers、pose、effects、draw 来计算状态。没有足够输入身份时返回明确 fallback，不能用错误字符串作有效 digest |
| ticket 15 片段输出复用 | 最新裁定只在节目预览会话的工作目标上记上一次完整内容键，不是历史 GPU/RAM LRU。该键须包含 simulationEpoch 与采样身份；命中跳过 prepare 与生成，观察视图按其已有规则补齐。回访较早时刻通常需要重画，检查点减少重算成本但不冒充输出命中 |
| 序列预渲染 | 沿现有 `videoEditRenderCache.ts` 计算窗口、按正式渲染生成视频。模拟会话跨连续窗口存活时可复用内存检查点；新 Worker 冷启动仍需重演历史，不能让每个窗口以窗口起点为 S0 |
| 导出 | 使用现有导出／预览复用条件。匹配输出帧可以直接读取；实时缺帧调用同一模拟核心。不同输出分辨率不会改变状态，像素结果按实际尺寸分别验证 |

具体接入决定：

- [videoEditAuthorFingerprint.ts:12](../../../Henji-AI-t17/src/features/videoEdit/engine/videoEditAuthorFingerprint.ts#L12) 保留无模拟模块的 dataFiles 行为；模拟完整身份由独立共享纯函数计算，供 sources、指纹、窗口缓存和 ticket 15 调用，不各复制一份键规则。
- `fingerprintAuthorFrameKey` 当前会为了 API7 图层效果运行 `fingerprintLayerEffects`；模拟模块不能走这一分支。纯身份路径保守纳入完整作者源码／参数、作者效果环境与 LUT、全部相关媒体／结构化数据身份、覆盖、曝光和质量。没有观测到本帧真实层效果时，不据此删掉“未用”依赖。
- [renderCache.ts:71](../../../Henji-AI-t17/src/core/videoEdit/renderCache.ts#L71) 的窗口依赖必须带完整模拟历史输入定义。早于当前窗口的曲线／场景数据变化也应失效后续模拟输出；不能沿普通 scene 窗口裁剪只散列当前相交记录。无可用逐帧指纹时，保守窗口键仍要携带 simulationEpoch，不依赖新指纹成功才修正历史依赖。
- `simulationEpoch` 只覆盖状态输入；最终像素键继续包含实际渲染尺寸、精度、素材采样身份、字体内容、风格／效果环境、draw 依赖的 clip.time／duration 与帧率等。帧率不改变积分，但会改变曝光和作者画面，不能从最终键删除。
- [renderEngineVersion.mjs:28](../../../Henji-AI-t17/scripts/vite/renderEngineVersion.mjs#L28) 已对渲染 Worker 依赖闭包散列；新调度实现应进入闭包。动态加载的作者库输出摘要须作为正式内容身份，不只依赖源码包版本字符串；运行逻辑变更自动失效旧预渲染缓存。
- ticket 14 的网页录段、GOP、解码、色度与页面时间不进入模拟核心。网页可在 draw 作纹理输入，保留网页内容身份／时间；不能借它的实时页面状态驱动物理。ticket 15 首版不缓存网页／序列输入的裁定继续有效。

## 7. 作者 API 与持久兼容

- 当前基线 `CODE_AUTHOR_API_VERSION=7`。ticket 10 已批准 API8，本文预留 **API9** 给模拟，实施时以 Claude 串行登记后的最新空号为准；不复用 API8，不批量把旧代码记录升级到新 API。
- API4–8 保持现有含义；只有新 API 激活 createSimulation、simulation 声明与 info.simulation。旧源码里同名普通属性不能被静默解释为模拟。现有新建／显式升级业务路径负责选择新 API，导入／复制／导出保留实际记录。
- 类型、运行时元数据、检查／编译入口共同校验新契约；作者声明无效、未知库 pin、失败的 init 或不可序列化快照都明确失败。旧接口读回与已有冻结库必须保留。
- 按 [persistence.md](../../../Henji-AI-t17/docs/rules/persistence.md) 对 `code-author-api`、嵌套接受新 API 的 `code-version`、`code-asset`、`document.video_edit`、`document.screen_recording`，以及 ticket 10 已补 pin 的风格样片／模板／风格包分别登记升级与逐版本迁移。精确数字在 ticket 10／13 合并后由 Claude 统一分配；schema 指纹变化的父容器不能漏升。
- 所有会容纳新 API 内容、旧读取器会错误解释或拒绝其嵌套值的容器提高 minReaderVersion；普通可重建元数据缓存直接失效。迁移保留已有 apiVersion、libraries、源码、引用、参数／曲线与预览字节，不迁移作者物理结果；旧黄金样本不改，追加新 API 的正式构造器样本。
- ticket 10 已负责样片／模板实际 pin 与旧缺省 pin 的固定解释；本票在该路径上支持 API9 + Rapier，不另写新默认解析器。原生预设继续固定生成器版本，不因模拟库可用就自动升级全部预设。
- 作者库升级是显式版本切换；同一工程里旧新版 Rapier 可以共存，各自独立 init 与 World。升级导致轨迹改变属于可见行为，必须新代码版本、失效模拟与像素缓存，并按指定帧对比；不能通过旧快照迁移掩盖。

## 8. 文件所有权与并行接缝

下表为实现阶段的文件范围；本轮实际只创建本 design.md。“新增”路径是设计目标，其余路径已在本分支核对。

| 文件／模块 | 本票修改内容 | 接缝与串行要求 |
|---|---|---|
| 新增 `src/core/videoEdit/codeSimulation.ts`、对应测试 | 不依赖 DOM 的声明、时间定位、完整身份契约 | 供 runtime／指纹／缓存共用，不放应用组件 |
| 新增 `src/features/videoEdit/engine/videoEditAuthorSimulation.ts`、对应测试 | 实例状态、检查点、prepare／只读取样、预算与取消 | 本票独占；复用正式时间／参数求值 |
| `videoEditAuthorModule.ts`、`videoEditAuthorParameters.ts`、`videoEditAuthorDeterminism.ts`、`resources/video-edit-author/author-api.d.ts` | 工厂、声明、类型、版本分流与同步随机包装 | 与 ticket 10 的字体准备、ticket 11/12/13 的效果接口重叠，先合并其已批准契约 |
| `videoEditAuthorRuntime.ts`、`videoEditAuthorPrograms.ts` | 实例准备、取样器注入、观察视图、释放 | 与 ticket 10／11／12／15 高频重叠；本票不改文字、效果或纹理缓存算法 |
| `videoEditCodeSources.ts`、`videoEditCodeGpu.ts`、`videoEditGpuCompositor.ts` | 完整参数历史传入；生成器、滤镜、试画三条路径同源 | 与 ticket 15 串行；接口需携带逻辑画幅和输入定义，而非逐帧结果 |
| `videoEditCodeFingerprint.ts`、`videoEditAuthorFingerprint.ts`、`src/core/videoEdit/renderFingerprint.ts`、`src/core/videoEdit/renderCache.ts` | 纯模拟身份指纹、完整历史依赖、保守回退 | 与 ticket 14／15 接壤；只增模拟依赖，不改网页缓存或视频解码 |
| `src/features/videoEdit/application/videoEditRenderCache.ts` | 核对并在必要处保持相邻窗口的渲染会话／模拟实例存活；日志与取消沿原任务 | 不新建预渲染业务任务；若既有会话已覆盖则仅补回归测试 |
| `src/core/videoEdit/codeMaterial/authorLibraries.ts`、`scripts/build-author-libraries.ts`、`scripts/lib/frozenAuthorLibraries.ts`、新增 `scripts/freeze-rapier-library.ts` 与 Rapier 冻结输出／发布清单 | scoped 包来源与安装别名、同包类型、init 去重封装、scoped 冻结边界与不可变内容 | 与 ticket 10／13 共用登记／冻结工具，由 Claude 串行合入 |
| `package.json`、`package-lock.json` | 精确运行包别名；无额外类型包 | **只由 Claude 在主工作区安装和提交**；本工作树不碰 node_modules |
| `src/core/videoEdit/codeAuthorProgram.ts`、`codeMaterialPersistence.ts`、`src/core/persistence/{formats,formatMigrations,schemaVersions,schemaBaseline,releasedCompatibility}` 相关 TS／JSON、文档内容 descriptor、`codeAsset.ts`、风格模板 schema／迁移、黄金样本生成器与 fixtures | 新 API 与嵌套格式升级，原 API 值保留 | ticket 10／13 完成后分配版本；根据实际 schema 传递闭包精确列文件，禁止覆盖别票迁移 |
| `videoEditAuthorTypeCheck*`／`videoEditAuthorApiContract.test.ts`、作者库与 protocol 现有测试 | 新类型可见、旧 API 分流、scoped URL／离线加载检查 | 复用现有类型环境；protocol 若现实现满足，不修改主进程实现 |
| `scripts/vite/renderEngineVersion.mjs` 及测试 | 核对动态库摘要与新运行实现进入引擎身份，缺项才补 | 与 ticket 14／15 共同使用，同轮集成只维护一次 |
| `resources/assistant-skills/video-edit-code-creation/references/author-api.md`、`recipes-particles.md`、`performance.md` | 写新接口及取样／快照规则，示例调用宿主模拟能力 | 与 ticket 10 字体、ticket 13 技能三档重叠，按小节串行合并，不重写其文案 |

实施顺序：Claude 确认契约与发行编号 → ticket 10 的 API／pin 底座及 ticket 11 运行时合入 → 本票接入共享核心 → 与 ticket 15 的实际工作目标键集成 → 最后统一格式门禁与真实渲染验证。ticket 12／13 正在修改的共享文件按实际完成边界合入；本票可以独立实现调度纯逻辑，不并发改这些文件。不存在必须等待 ticket 14 原生解码实现才能做模拟的依赖。

应用能力按 `henji-application-capability` 核对：新增的是已有作者内容的执行语义，不新增用户可编辑业务对象或独立烘焙操作；代码素材／版本／参数／曲线已有 `video_edit` 实体与通用事务，预渲染／取消／导出已有正式能力。复用 [videoEditFields.ts:61](../../../Henji-AI-t17/src/features/videoEdit/application/videoEditFields.ts#L61)、`videoEditExecutors.ts` 与现有检查／升级／观察服务；不新增 simulate、snapshot 或 set_seed MCP 工具。版本类型变化自动从正式 schema 投影，必要的公开契约指纹由 Claude 在集成时统一更新；宿主内部检查点不作为用户业务数据暴露。

## 9. 验证、日志与已知事实

### 9.1 本轮实际证据

- 本轮为 testing.md 的 **L0 技术设计**，不运行构建、应用测试、端口探测或窗口操作；没有访问 `D:\视频制作`，没有操作 9334 开发版。
- 一次 Node 内存探针：Windows、Node `v24.18.0`，通过确切版本 ESM 的 data URL 加载 Rapier `0.21.0`，不写探针文件。世界含一个地面碰撞体和 100 个动态球，球心为 `((i%10)*0.6, 2+floor(i/10)*0.6, 0)`、球半径 0.2、重力 y=-9.81，h=120，运行 240 步，第 120 步快照后恢复并补 120 步。
- 快照 127,887 字节；加载加 init 147.41ms，单步 P50 0.224ms／P95 0.508ms，首次 restore 23.09ms。恢复续算与独立世界从 0 推进到 240 的最终快照 SHA-256 均与原世界相同。时间是单次小样本，含初始化／JIT 影响，不作为 P95 恢复、生产实时性或跨平台证据。
- npm registry 元数据、官方包归档及 init 类型已读取，归档在内存中通过上述 SHA-512 integrity 校验；其中 ESM 为 4,372,012 字节，发布包含完整声明。未安装正式别名、未验证 `henji-media` 打包资源、真实 Worker、多实例 GPU 像素或跨机器结果；这些属于实施后的验证。
- L0 文档核查：开头恰有三行摘要；22 个相对文件链接均存在；代码围栏成对。源码工作区仍干净，ticket 17 目录只新增 design.md。

### 9.2 实现后的风险匹配验证

| 风险 | 最小可判定验证 |
|---|---|
| 任意时刻／完整状态 | 顺序推进作基准，乱序／重复／回退／冷跳、K 边界、非整步、源时间有理数、刚体新增／删除和 JS 累积状态逐字节比较；快照别名修改不得改变后续结果 |
| 参数历史 | 两条曲线在目标时刻数值相同、早期值不同，最终状态必须不同；改窗口之前的数据必须失效后续窗口；改无关片段不改变本模拟身份 |
| 生命周期 | 两个相同源码实例交错调用、不同 seed、不同参数、取消后恢复、释放期间 init 未结束、restore 失败、旧 epoch 迟到、设备重建；验证无错世界引用与未释放 World |
| 绘制与运动模糊 | 多层乱序 pose、探测／正式样本、中心与曝光范围、首尾边界、观察旧帧；插值取样只读，不增加 step 次数 |
| 缓存 | 常量 frameKey 不能复用错误物理时刻；dataFiles／早期曲线／库 pin 变化失效；有／无检查点、输出命中后跳到缺帧、预算淘汰都得到相同结果；ticket 15 只验证已裁定的上次工作目标复用 |
| 三入口一致 | 生成片段、附加代码滤镜、试画／样片使用同一测试源；预览、预渲染、实时导出、使用预览导出在相同尺寸／精度／质量／色彩设置下逐帧像素比较；24／30／60 与 30000/1001 fps 在相同源时刻比较状态 |
| Wasm／发行 | 正式 build:author-libs 输出能在真实 Electron Worker 离线 import／init；两个实例并发 init 一次；源码与类型入口、license、冻结摘要、安装包资源完整。无 DOM、CDN 或单独 wasm 请求 |
| 向后兼容 | 旧 API4–8 的运行与旧黄金样本；新模拟素材经代码资产、项目、样片／模板／风格包保存导入导出保留 API 和精确库 pin；不读取或保存世界快照 |

实施阶段是跨作者公共契约、关键依赖与持久格式的 **L3 集成改动**（testing.md 第一节“核心公共契约、关键依赖”），开发时先跑对应精确测试和所属类型检查，不在每次小编辑跑全仓。最终由 Claude 在共享构建安全边界执行一次匹配 L3 门禁、持久兼容检查及真实 Electron 场景；需最新产物时用 electron:bundle，不因产物过期用完整 build。耗时超过一分钟的检查后台串行执行，不能争用开发实例或共享产物。

性能验收输入固定为 100／1,000 个动态刚体各 60 秒、10,000 个普通 JS 粒子 60 秒、三个实例并发；分别量冷跳 30／60 秒、热跳、倒放、顺播和快照淘汰，记录 step／snapshot／restore／prepare 的 P50/P95、实际补步数、检查点字节及峰值内存。这些是测试规模，不是产品上限。典型 100 刚体 1080p60 的暖态模拟阶段目标 P95≤4ms；恢复和冷跳单列，不纳入暖态指标掩盖。120Hz／K=120 的最终性能准入由这些数据决定，默认步率改变必须在首次 API 发布前裁定。

日志经既有 `createLogger('features.videoEdit.authorSimulation')` 通道：`video_edit.simulation.prepare.start/completed/failed`，初始化、恢复、淘汰、取消用 debug／trace 汇总，避免每步日志。上下文记录 sequence／clip／effect 归属、epoch 摘要、目标时间、恢复步号、推进步数、快照字节、耗时及取消原因；不记录完整作者状态、源码、密钥或媒体。正式界面沿现有“正在准备画面／渲染失败”表达，不展示步号、哈希和 Worker 计数。

本轮按共享实现实际核对：生成器、附加代码滤镜、独立试画、作者模块共享、帧指纹、窗口依赖、ticket 15 最新裁定、作者库构建／冻结、持久版本及类型声明。以上是设计影响面，不是这些入口已经修复或验收通过。实现代码提交前按 AGENTS.md 由干净上下文审查正确性、同源调用方与持久兼容；本轮设计尚未取得 Claude／审查员批准。

## 10. 需要 Claude 裁定

1. **FrameFlow 契约**：批准本文 `createSimulation + simulation.at` 形状，或提供尚未公开的 FrameFlow 模拟接口作为对齐依据；未提供之前不能承诺模拟代码两边直接通用。
2. **时空与预算**：批准源时间 0 起算、120Hz／K=120、保持采样默认＋作者可选插值、64 MiB Worker 共享检查点软预算，以及首版仅内存快照的冷跳／淘汰成本边界。若要求首次任意长时间跳转也有固定低延迟，必须另批预计算／持久快照范围，单靠本算法不能满足。
3. **依赖与冻结身份**：批准 Rapier 3D deterministic-compat 上游 `0.21.0`、宿主冻结发行 `0.21.0-henji.1`，由 Claude 主工作区安装；确认第 5.2 节的来源登记、init 去重封装和 scoped 冻结检查扩展，与 ticket 10 共用工具串行合入。
4. **并行合入**：确认 API9 占号与 ticket 10／11／13／15 共享文件的串行顺序；后续实现需 Claude 与审查员批准本设计，本轮不以小探针通过代替批准。

## 11. 一手资料

- [Rapier 官方 npm：构建选择与 compat](https://www.npmjs.com/package/@dimforge/rapier3d)；[确定性兼容包的确切版本元数据](https://registry.npmjs.org/@dimforge%2frapier3d-deterministic-compat/0.21.0)：deterministic 构建、base64 wasm、0.21.0、ESM 路径及 Apache-2.0 来源。
- [Rapier 确定性](https://rapier.rs/docs/user_guides/javascript/determinism/)：相同版本、初值和对象操作顺序的要求，作者超越函数的跨平台差异边界。
- [Rapier JS 序列化](https://rapier.rs/docs/user_guides/javascript/serialization/)：takeSnapshot／restoreSnapshot；[官方 World API](https://rapier.rs/javascript3d/classes/World.html)：世界生命周期与方法。
- [确切发行的 init 声明](https://unpkg.com/@dimforge/rapier3d-deterministic-compat@0.21.0/dist/init.d.ts)、[同发行 ESM](https://unpkg.com/@dimforge/rapier3d-deterministic-compat@0.21.0/dist/rapier.mjs)：本轮只读核对和内存探针来源；生产使用随包冻结资源。
- [Rapier 官方 TypeScript 源码目录](https://github.com/dimforge/rapier/tree/master/typescript)：当前官方实现；旧 rapier.js 仓库已迁移，不依赖旧仓库 API 记忆。
- [ticket 10 设计及后置裁定](../10-文字排版/design.md)、[ticket 15 设计第 14 节](../15-代码片段输出缓存/design.md#14-设计审查后的裁定10-31优先于前文)：API8／冻结／pin 与首版输出复用的真实接缝；[ticket 14 计划](../14-网页页面时间缓存/plan.md)、[ticket 11](../11-效果合并/plan.md)、[ticket 12](../12-新效果/plan.md)、[ticket 13](../13-风格件与技能三档/plan.md) 界定并行文件职责。

## 12. Claude 裁定（11-01）
1. 批准 `createSimulation + simulation.at` 形状；FrameFlow 模拟接口未公开，以后有了再对齐，不承诺两边直接通用。
2. 批准源时间 0 起算、120Hz／K=120、默认保持采样＋作者可选插值、64 MiB Worker 共享检查点软预算、首版仅内存快照；首次长距离冷跳的延迟按算法上界接受，不做持久快照。
3. 批准 Rapier 3D deterministic-compat 0.21.0、冻结身份 0.21.0-henji.1；**按冻结作者库方式随源码登记（npm pack 到临时目录取出所需文件，附许可证与来源），不改 package.json 与 node_modules**，与 ticket 10 的 vendor 工具共用、检查扩展串行合入。
4. API 号：ticket 10 占 API 8；本票与 ticket 18 共用 API 9（谁先合并谁登记 API 9，另一个在 API 9 未发布前直接扩充，不再升号）。实现期间用一处常量。
设计审查并入实现后的那次 Opus xhigh 合并审查（新功能、默认不触发、与现有路径隔离）。
