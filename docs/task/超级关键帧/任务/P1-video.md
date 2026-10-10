# t144 / P1 剪辑超级关键帧

状态：本单实现、精确验证、正式 Electron 完整序列及四项性能断言均已通过，05:21 最终复拍 33 张截图已逐张目视。共享格式指纹门禁与指定广测尚未全绿，不能登记整个 P1 完成；由总管理者整合审查与 Git 提交。本任务没有 Git 写操作，没有修改图片编辑实现或 packages/ai-sdk，没有付费调用，没有启动 electron:dev。

## 实现与选型

- 直接消费 t143 的 fit-curve、原生时间基函数、双时钟/visit、pins 与候选身份内核，不另写拟合器、求解器或合成链。沿用现有 Web Worker、正式 PAL/document importFile、react-virtuoso 和 Ui*。这一选择保留真实普通曲线和现有撤销/导出链，并减少另一套渲染、存储和权限实现。
- 剪辑领域格式升到 3，统一文档内容 kindVersion 升到 2，显式 dev-break，拒绝旧开发格式；旧黄金样本按基线豁免保留，不写迁移。草稿头留 drafts/sessions/resources 共用槽位，motionOptions 为剪辑接线选项；图片持久化接线不在本单。
- 原稿页 SHA-256 + bytes + owner/target/take + seq/mono/clock 校验。逐页读写，每页 256 个样本属于 I/O 批次预算；最近 96 个样本仅作残影视图，全部原稿仍在不可变页。原稿、候选、原稿 A、应用记录候选，以及当前/undo/redo 引用均进入存活集合。没有新增私人 GC 或删除通道。
- 草稿元数据沿正式文档会话保存，不增加普通曲线撤销步、不清空 redo。位置变化不触发跟随时间指针切片段。关闭准备回调先封存待写页，再过正式文档保存屏障；失败保留待写数据和会话，停在可再次结束的暂停状态。复制/包导入改变文档身份时发布新的不可变资源与摘要，源文件不动；移动沿现有位置编解码搬运。
- 开始示范不播放。默认找位置；真正拖元素或已有示范后显式选择示范运动才采姿态，单击不建立示范。分时摆放允许前向定位到多个帧，保留真实 visit/clock；连续录制的 seek、暂停采集、倒退按共核规则断计算段。Alt 临时切模式，位置/旋转/缩放切换时重新取增量原点。
- 采样来自正式 RenderSession 的成功呈现回执，requestedFrame 仅作诊断；未知呈现不伪造。0.5x/0.25x 改节目时钟，不改素材速度或再缩放关键帧。慢录时现有 1x 音频调度暂停出声，**当前慢录静音，不承诺保调慢放**；A/B 回到正常速并复用唯一节目链。
- 真实半速验收发现旧姿态被未来帧 deadline 阻塞。录制姿态发布即取消旧投影等待，仍用唯一 RenderSession 重画现有播放时钟已到帧；首次覆盖已有曲线保持时钟，真正的文档/素材改变仍走原失效流程。暂停、正常回放及 A/B 保留原调度。32 项节目监视器/时钟回归及正式输入 P95 门槛通过。
- 半速排程复拍输入 P95 21.90ms 达标；同轮滑杆 P95 307.70ms 超过 300ms。已复用成功整理后无原稿状态的空闲 Worker，取消/失败直接终止，关闭项目或闲置 10s 释放。仅缓存一个空闲计算进程是内存预算，并发任务各自独占 Worker，不限制项目/素材数量。3 项 ACK/复用/取消迟到/关闭/闲置回归通过；最新构建与最终复拍均通过正式四门槛，滑杆最终 P95 186.40ms。
- 整理在 Worker 逐页 ACK 后进行，取消直接终止 Worker。意图端点和钉点从全部已封存页流式读取，不依赖残影尾缓存；候选身份包含 owner、原稿摘要、算法版本、目标基态、几何、保真、意图、映射和采用 take。几何摘要包含实际素材/嵌套序列尺寸，素材移动不使候选失效，宽高改变会阻断旧候选。重开先定位原片段，失效候选保留原稿并明确要求重新示范。迟到结果不能覆盖新输入，未发布资源失败清理。
- 普通曲线通过正式编辑事务整组应用，局部帧范围与未操作属性保持原样，一次撤销恢复。应用后的磁盘失败主动作显示“重试保存”，只保存原作品，不增加第二个编辑事务。范围外保持测试按整数应用边界及 .25 帧探测；与范围内端点相连的一个帧间隔属于新段过渡。
- 共用组件只有 props 与回调，不持有业务 Store、文档或算法；公开 motion/layout 呈现配置，静态图片只提供共用候选/保真/钉点操作，不伪造录制、播放或空回调。节目命令带使用既有 PanelTrigger，一个主动作。候选不叠加修改；保真滑杆取消不重算、放手只提交一次；钉点和重访段列表用 Virtuoso，跨段残影断线且不拦截画面命中。

## 对外接口

- 剪辑：startVideoMotion / stopVideoMotion / pauseVideoMotion / resumeVideoMotion；recordVideoMotionPresentation 是正式 RenderSession 回执入口，demonstrateVideoMotion 只提交待呈现姿态。
- 整理与确认：configureVideoMotion、setVideoMotionIntent、pinVideoMotionFrame、optimizeVideoMotion、cancelVideoMotionOptimization、previewVideoMotion、applyVideoMotion、reopenVideoMotion。
- 投影：videoMotionComposition 只返回临时普通曲线投影；videoMotionState/subscribeVideoMotion 为宿主 UI 接线。videoMotionLiveResources 与 core 的 creativeIntentLiveResources 供正式存活集合。
- 公共 UI 出口：@/features/creativeIntent 的 CreativeIntentControls / CreativeIntentControlsProps、CreativeIntentOverlay / CreativeIntentGhost。默认 motion 配置包含模式、采集方式、速度、属性、采用段和正常速 A/B；profile='layout' 只要求共用候选、保真、pins、原稿对照、保存恢复及对应回调，支持 pinLabel。图像侧可直接复用纯呈现出口，无需录制假实现。
- **P1-5 公共实体/算法能力尚未登记**。本单的应用关联是文档内事实记录，不冒充已存在的公共 MCP 操作回执；总管理者需在 P1-5 接入统一实体、账本、应用读回与助手状态台账。

## 基准成绩

环境：Windows，AMD Ryzen 9 5900X，24 逻辑 CPU，63.91 GiB，Node 24.18.0；本次 S15 定向精确测试与既有 21 项 benchmark 均通过。误差按画幅短边归一化；下面是本次独立解析参考与正式普通曲线求值的结果，非真实 Electron 性能。

| 基准 | K | 最大位置误差 | RMS | 误差 P95 | 纯整理 ms | 硬失败 |
|---|---:|---:|---:|---:|---:|---|
| S01 | 2 | 3.179e-8 | 1.836e-8 | 3.179e-8 | 43.66 | 无 |
| S02 | 6 | 2.587e-8 | 9.388e-9 | 1.811e-8 | 17.28 | 无 |
| S03 | 3 | 5.150e-8 | 1.709e-8 | 3.862e-8 | 15.52 | 无 |
| S04 | 7 | 3.463e-4 | 3.613e-5 | 4.960e-5 | 9.85 | 无 |
| S05 | 3 | 4.768e-8 | 2.009e-8 | 4.059e-8 | 7.80 | 无 |
| S06 | 9 | 1.627e-4 | 1.053e-4 | 1.587e-4 | 29.67 | 无 |
| S07 | 39 | 0 | 0 | 0 | 17.91 | 无 |
| S08 | 2 | 1.127e-8 | 4.758e-9 | 9.454e-9 | 82.12 | 无 |
| S10 | 6 | 2.587e-8 | 9.388e-9 | 1.811e-8 | 13.51 | 无 |
| S11 | 4 | 1.589e-8 | 5.956e-9 | 1.434e-8 | 11.39 | 无 |
| S15 | 21 | 2.427e-4 | 1.286e-4 | 2.097e-4 | 47.78 | 无 |
| S16 | 34 | 1.475e-4 | 2.132e-5 | 4.148e-5 | 7.42 | 无 |

S15 对照：

| 实现 | K | 最大误差 | RMS | 误差 P95 |
|---|---:|---:|---:|---:|
| t143 原实现 | 37 | 0.00006761848226 | 0.00002967403887 | 0.00005697009662 |
| 本次 | 21 | 0.00024268353095 | 0.00012855177298 | 0.00020968342118 |

没有改基准或放宽 0.0005 短边门槛；去掉原生拟合额外半预算，按逆几何列分配既有总预算，算法身份升级为 p1-schneider-native/2。S15 K 落在 12–24 内；120–150 帧停顿在 .25 帧探测上保持，回返轨迹与硬端点通过独立参考验证。其他 K 是实际结果，不人为补无意义帧到参考下界。

性能：5 次预热 + 30 次测量的 10s/120Hz 带抖动轨迹，纯整理 P95 **144.94ms**；100 层布局 P95 **1.96ms**（共核复核，非本单图片接线）。最终真实 Electron 完整流程四项均在场景末尾断言：

| 实际指标 | 最终 P95 ms | 门槛 ms | 结果 |
|---|---:|---:|---|
| 输入→成功合成回执（42 次） | 19.90 | 50 | 通过 |
| 候选端到端生成（37 次） | 151.70 | 900 | 通过 |
| A/B 切换→合成呈现（30 次） | 32.40 | 100 | 通过 |
| 保真滑杆停手→合成呈现（30 次） | 186.40 | 300 | 通过 |

A/B 与滑杆各另有 5 次预热，输入及候选记录全流程所有正式样本，见最终 evidence.json 的 latencyMs/candidateMs 数组。05:00 排程修复前输入 P95 91.20ms，修复后曾测 21.90ms；随后一轮滑杆 P95 307.70ms，空闲 Worker 复用后的构建轮为 185.20ms，最终补拍为 186.40ms。这是不同正式轮次的实测对照，不假称同一次成对试验。不删除慢样本或改分位数。物理屏幕呈现与 GPU/合成回执不是同一指标。

缓存证据：node_modules/.cache/t144-core-metrics.json、node_modules/.cache/core.json、node_modules/.cache/t144-real-final-evidence.json，仅本机诊断，不加入提交。

## 检查与复审范围

- 已通过：共核 9 文件 55 用例；本单宿主 12 用例；普通曲线合并与几何身份 3 用例；共用控件 4 用例；格式黄金 83 用例；主进程复制/重绑及正式搬运链 2 用例；项目包黄金 5 用例。正式导入→移动→导出→重开对照 721 样本全量摘要、时钟和钉点，文档身份重配后资源摘要正确。目标切换和写入背压复用正式暂停，清除未呈现事件，结束封存不再被无效目标的视图订阅改回暂停。意图端点与正式内核同帧折叠一致，取最后确认姿态，新增分时摆放回归通过。真实关闭时卸载曾错误查找已关闭实例，已增加按原实例登记状态的清理保护，普通/录制关闭及同 ID 新实例指针隔离回归通过。钉点/保真重算保留候选选择，明确新意图优先对应方案；回归通过。后续修改只重跑受影响精确测试。
- 已通过：两套 tsc；渲染层曾被并行图片测试 src/features/imageEdit/v3/tools/vector/RunTextInputV3.test.tsx:6 的 Hook 返回类型错误阻断，该任务修正后复查通过，本单未改图片文件。本次 TS/TSX ESLint；CommonJS 脚本按 Node 合法 require/console 配置 ESLint。surface、colors、icons、ui-residue、main-imports、dependency-graph、dead-code 均通过。
- 已通过：check:assistant-capabilities；结构 + 公开覆盖 + 31 文件/206 用例不变量通过。共享 UI 无独立业务的原因明确登记，**不代表新增草稿业务已经具备公共助手能力**。
- 已通过：npm run test:assistant-persistence，正式 Electron 原生 SQLite 9 文件、83 用例、0 跳过。
- check:persistence-compat 失败：仅 image-package / image-working-copy / canvas-layer-package 的并行图片指纹；本单剪辑与新增格式指纹一致。不接管图片 schema。
- 指定大范围原命令已结束，原结果：727 文件通过、6 文件失败、19 文件跳过；5047 用例通过、2 用例失败、77 跳过，另有 1 次 Worker 内存不足。四个失败文件为 operationStore、mediaResources.native、generation-submissions 和 mcpWriteIntegration 的强制 Electron SQLite 运行器保护；这些原生文件已由上一条正式原生套件通过。两处本次升版本引起的旧断言已修复，相关 timelineEdits/documents/timedContent 定向 40 用例通过；内存中断漏报的 videoEditOutputs 单独 25 用例通过。原日志 node_modules/.cache/t144-full-tests.log 保留。**未把这些局部复测拼成“原广测 0 失败”结论**。
- 版本字面量检索已核对：当前剪辑作者/验收夹具为领域 3，内容为 2；保留旧格式拒绝测试、旧黄金豁免及无关布局/代码资产版本，未增加兼容代码。
- 同源排查包含元数据 undo/redo/gesture 恢复、应用后再整理的资源存活、复制与包导入的资源/候选/应用引用、关闭期间封页、取帧/合成失败的投影身份，以及实际呈现/属性切换/暂停倒退。图片持久化、P1-5 公共能力、物理屏幕 P95 未验。

## 正式截图与交互序列

正式场景：video-edit-motion-draft，已登记到既有 uiInspectionScenes。每轮仅在成功创建 .reality/ui-lock 后运行，结束后只释放自己取得的空锁目录；本任务未删除或接管其他任务的锁。早期轮次修正素材夹具、按钮匹配、标尺遮挡和截图后缀，入口改为单行并向上展开。并行图片源码在构建中更新时新鲜度门禁拒绝启动，没有绕过；后续 05:00 完整流程通过，构建 174.42s。

场景覆盖清单：不播放找位置→实际元素拖动；分时终点；整理候选 B→原稿 A→候选 B，两者均正常速播放；钉终点→应用普通曲线→一步撤销→重做；保存重开原稿与钉点；0.5x 手动播放→暂停继续操作→Alt 临时模式→暂停旋转/缩放→向前示范→倒退重访。每段元素拖动另拍 3 张真实原生画面，正式窗口截图由既有 capture 保存。PerformanceObserver 记录原有合成回执入口与候选端到端 measure；缓存 A/B 和滑杆停手重算各 5 次预热、30 次实际事件→合成呈现采样。

**04:47 正式前半段共 15 张流程截图 + 1 张失败截图已逐张目视**：.reality/t144-video-motion-verified/1440x900-video-edit-motion-draft-step-001.png 至 step-015.png。step-001 不播放定位到 20 帧且无示范；002–004 同帧拖元素逐步移位并有姿态残影；005–007 定位 90 帧后摆终点；008 封存；009–011 轻回弹候选、原稿 A 与候选 B 正常速对照，运动画面明显不同；012 终点钉点与解钉入口；013–015 普通曲线应用、一步撤销、重做。单行入口、向上玻璃面板正常，内容可纵向滚动无横向溢出，关闭面板后标尺和画面可命中。原生画面 3,686,400 字节对照：应用与重做差异字节 0，原作品与撤销差异字节 0。

失败截图 failure.png 是关闭后全界面异常；正式日志定位 useVideoEditMotionGesture 卸载清理调用已关闭实例，已修复并精确复测。目视还发现钉点重算丢失候选选择，已修复并回归。05:00 完整复拍 .reality/t144-video-motion-final 的 step-001 至 step-032 和默认项目列表图共 33 张已逐张目视，功能流程通过但输入 P95 未通过；原证据 node_modules/.cache/t144-real-pre-latency-fix.json 保留。后续改半速当前帧排程和空闲 Worker 复用，最新 --build 轮 .reality/t144-video-motion-reuse 构建 158.86s，四性能断言通过；随后只修改验收脚本，等待“开始示范”出现再拍封存，复用新鲜正式产物完成最终 .reality/t144-video-motion-review（2026-10-11 05:21:56 CST，0 失败）。没有绕过新鲜度或 UI 锁。

**最终 33 张已逐张目视**：step-001 不播放找位置；002–004 同帧元素示范；005–007 分时终点；008 确认封存已结束；009–011 候选与原稿正常速 A/B；012 终点钉住；013 应用且右侧呈现普通曲线；014 一步撤销；015 一步重做；016 保存重开原稿、钉点与轻回弹选择；017–019 半速手动播放逐帧姿态；020–022 暂停后继续操作；023 修饰键示范模式，过渡已完成；024–026 暂停旋转；027–029 暂停缩放；030 向前示范；031 倒退重访；032 确认三段原稿封存，默认图为正常项目列表。单行命令带、向上面板、纵向滚动及主动作正常，无横向溢出、关闭异常或错误内部标识。最新原生图像应用↔重做与原作品↔撤销均为 3,686,400 字节、差异 0。缓存 32 张原生序列在 node_modules/.cache/video-edit-motion-draft/，最终结构证据和已完成目视结论归档 node_modules/.cache/t144-real-final-evidence.json；正式截图索引 .reality/t144-video-motion-review/index.md。截图/缓存不加入 Git。三位盲评/真人 R 集由 P1-5 组织，不伪造评审者。

显示器经 Windows 查询：DISPLAY1 是右侧副屏，坐标 X=2560、Y=0，2560×1440；DISPLAY2 为主屏。正式 ui-tour 默认 2561,1 位于副屏，不使用 Electron display.id 推断 Windows 编号。

## 未完成与总管理者注意

1. 本单剪辑实现、完整正式流程、33 张目视和四项性能已通过；指定广测与共享格式指纹尚未全绿，不据此登记整个 P1 验收通过。
2. 指定广测没有达到原命令 0 失败；本单两处版本断言已修复通过，输出模块内存中断也已单独通过。原命令将原生测试放进 Node 与“原生单独运行”存在环境冲突，应由总管理者采用正式 unit 分层 + 已通过的原生层，不改保护测试伪造绿灯。
3. 图片侧三种格式指纹由并行任务完成后统一登记；本单留好扩展槽位，不碰图片实现、SDK 或其他脏文件。
4. P1-5 接线应用事实到正式公共 operation/receipt、草稿/候选/属性与算法注册、助手回读，并协调 assistant-status 台账；本单没有专用旧 Agent 工具。
5. 不执行 Git 写操作、不启动开发实例。本次改变主进程资源重绑代码，真实用户开发实例后续应由总管理者按其任务授权重启；本单明确禁止 electron:dev。
6. 最终只读核对 main 与本单显式清单：涉及 63 个文件，其中 uiInspectionScenes.cjs 的场景登记已在当前 HEAD，当前无待提交差异；其余 62 个文件有修改或未跟踪内容。共享工作区还存在其他任务 SDK/设置/音频等改动，不属于本单，禁止将整个脏工作区作为本单提交范围。

## 设计自查

1. **助手只凭名称和说明能否用对？** 领域入口是示范、找位置、整理、钉住、原稿对照与应用语义，材料与普通曲线同源；P1-5 的正式公共实体/算法接线未完成前，答案是“领域接口可供接线，公开助手目前不能完整调用”，不虚报覆盖。
2. **能否 AI 先做、人只确认？** 已由本地内核先给合法候选，人只校正保真、风格、采用段与钉点；不替用户自动播放，不发生云端付费调用。
3. **产物能否直接流进其他工作区？** 应用是既有普通剪辑曲线，走正式导出与媒体桥；草稿资源跟随文档/项目包搬运。图片侧后续直接消费共用呈现组件，图片持久化仍需其正式适配。

## 本次文件清单

- `src/core/creativeIntent/contracts.ts`：加入分时摆放的显式 take 标记，保留真实双时钟与访问记录。
- `src/core/creativeIntent/fitting.ts`：按既定整段误差预算验收原生贝塞尔细分，消除额外半预算。
- `src/core/creativeIntent/motionCompiler.ts`：按几何逆映射分配短边误差预算。
- `src/core/creativeIntent/persistence.ts`：定义草稿头、不可变资源目录与候选落盘 schema；收集当前、撤销、重做和应用记录存活资源。
- `src/core/creativeIntent/sampling.ts`：分时摆放保留前向定位点，连续录制仍在跳转和倒退处断计算段。
- `src/core/creativeIntent/sparsity.test.ts`：验证 S15 的 12–24 稀疏门槛、停顿与原稿不变。
- `src/core/videoEdit/document.ts`：领域剪辑文档增加草稿头并升级格式。
- `src/core/videoEdit/motionDraft.ts`：通过正式求值器读取姿态，局部合并普通曲线并保留范围外曲线。
- `src/core/videoEdit/motionDraft.test.ts`：验证曲线范围、属性边界和非破坏合并。
- `src/core/documents/kinds/videoEdit.ts`：文档内容承载 creativeIntents，空文档判断保留原稿。
- `src/core/persistence/formats.ts`：登记原稿页和候选持久格式。
- `src/core/persistence/persistence.test.ts`：当前剪辑黄金样本按新领域文档版本验证。
- `src/core/persistence/schemaVersions.ts`：剪辑内容版本 2、领域文档版本 3。
- `src/features/videoEdit/VideoEditPreview.tsx`：真实呈现回执采集、慢录时钟与单条预览合成链；取帧和失败恢复消费当前投影。
- `src/features/videoEdit/application/videoEditCodeService.ts`：代码试片使用当前领域文档版本。
- `src/features/videoEdit/application/videoEditDocumentTestKit.ts`：测试重开使用当前领域文档版本。
- `src/features/videoEdit/application/videoEditService.ts`：原稿元数据保存、历史存活集合、录制选择策略、播放速率与关闭准备回调。
- `src/features/videoEdit/application/videoEditStylePreview.ts`：风格试片使用当前领域文档版本。
- `src/features/videoEdit/application/videoEditMotionDraft.ts`：采集封页、流式整理、候选预览、钉点、原子应用和保存重试。
- `src/features/videoEdit/application/videoEditMotionDraft.test.ts`：验证实际帧、候选重算选择、同帧端点、保存重开、撤销重做及关闭卸载的实例隔离。
- `src/features/videoEdit/application/videoEditMotionResources.ts`：复用文档 importFile 发布不可变资源，逐页校验摘要、时钟和归属。
- `src/features/videoEdit/application/videoEditMotionWorkerClient.ts`：逐页 ACK 背压传输、空闲 Worker 复用，取消/关闭/闲置安全释放。
- `src/features/videoEdit/engine/videoEditMotionWorker.ts`：在 Worker 内消费 t143 原内核，生成候选和原稿普通曲线。
- `src/features/videoEdit/engine/videoEditMotionWorkerProtocol.ts`：声明有界逐页传输与计算请求契约。
- `src/features/videoEdit/panels/VideoEditMotionControls.tsx`：节目命令带入口、宿主回调、A/B 与原生姿态残影映射。
- `src/features/videoEdit/panels/useVideoEditMotionGesture.ts`：元素拖动示范、切属性增量归零、失焦暂停及关闭后按原实例安全清理。
- `src/features/creativeIntent/ui/CreativeIntentControls.tsx`：motion/layout 纯 props 呈现，图片无需伪造录制回调；保存失败主动作改为重试保存。
- `src/features/creativeIntent/ui/CreativeIntentOverlay.tsx`：主题色画布轨迹与姿态残影，跨访问/示范段断线且不拦命中。
- `electron/main/services/documents/repository.ts`：复制剪辑时通过新不可变页重绑文档归属。
- `electron/main/services/documents/package-service.ts`：项目包导入重配文档身份时同步重绑原稿和候选。
- `electron/main/services/documents/video-motion-resources.ts`：校验复制源，更新资源身份/摘要/候选身份/应用引用，失败清理未发布资源。
- `electron/main/services/documents/video-motion-resources.test.ts`：验证重配身份、可用候选、源文件不变、损坏拒绝，以及正式包导入/移动/导出重开 721 样本全等。
- `scripts/generate-persistence-fixtures.ts`：正式黄金样本生成器支持新增页和候选格式。
- `scripts/generate-video-motion-fixtures.cjs`：通过正式 schema/内核更新本次黄金样本、项目包与剪辑基线。
- `src/core/creativeIntent/candidates.ts`：拟合行为变更升级算法身份，阻断旧候选误用。
- `src/features/creativeIntent/index.ts`：公开跨宿主组件与 props 类型出口。
- `src/features/creativeIntent/ui/CreativeIntentControls.test.tsx`：验证滑杆取消与单次提交、焦点、保存恢复及无录制依赖的图片配置。
- `src/core/persistence/schemaBaseline.json`：登记剪辑 dev-break 与新增资源格式，不接管图片指纹。
- `tests/fixtures/persistence/document.video_edit/v2.json`：当前格式黄金样本，包含原稿或候选的完整契约。
- `tests/fixtures/persistence/creative-intent-page/v1.json`：当前格式黄金样本，包含原稿或候选的完整契约。
- `tests/fixtures/persistence/creative-intent-candidate/v1.json`：当前格式黄金样本，包含原稿或候选的完整契约。
- `tests/fixtures/persistence/project-package/v1.henjipack`：项目包黄金样本包含不可变原稿页与候选。
- `scripts/check-assistant-capabilities.cjs`：登记共享 UI 无独立业务实体的真实原因，不伪造助手覆盖。
- `scripts/lib/uiInspectionScenes.cjs`：登记正式剪辑超级关键帧 Reality 场景。
- `scripts/lib/uiInspectionSceneVideoEditMotionDraft.cjs`：真实手势、A/B、钉点、应用撤销、重开和慢录倒退的截图序列与性能测量。
- `scripts/lib/uiInspectionVideoEditDocuments.cjs`：正式测试文档读回使用当前领域文档版本。
- `scripts/lib/uiInspectionSceneVideoEditAgentLoop.cjs`：剪辑验收夹具采用当前领域文档版本 3，保留故意拒绝旧格式的用例。
- `scripts/lib/uiInspectionSceneVideoEditCreativeResults.cjs`：剪辑验收夹具采用当前领域文档版本 3，保留故意拒绝旧格式的用例。
- `scripts/lib/uiInspectionSceneVideoEditLinks.cjs`：剪辑验收夹具采用当前领域文档版本 3，保留故意拒绝旧格式的用例。
- `scripts/lib/uiInspectionSceneVideoEditPerformance.cjs`：剪辑验收夹具采用当前领域文档版本 3，保留故意拒绝旧格式的用例。
- `scripts/lib/uiInspectionSceneVideoEditNativeSoak.cjs`：剪辑验收夹具采用当前领域文档版本 3，保留故意拒绝旧格式的用例。
- `scripts/lib/uiInspectionSceneVideoEditProbe.cjs`：剪辑验收夹具采用当前领域文档版本 3，保留故意拒绝旧格式的用例。
- `scripts/lib/uiInspectionSceneVideoEditPopout.cjs`：剪辑验收夹具采用当前领域文档版本 3，保留故意拒绝旧格式的用例。
- `scripts/lib/uiReviewVideoEditFixture.cjs`：剪辑验收夹具采用当前领域文档版本 3，保留故意拒绝旧格式的用例。
- `docs/task/超级关键帧/任务/P1-video.md`：记录本单实现、接口、实际证据与未完成项。
- `docs/task/超级关键帧/02-实施拆分.md`：只追加 P1-0/P1-2/P1-4 的 t144 状态行。
- `src/core/videoEdit/timelineEdits.test.ts`：当前文档版本断言改为 3，明确拒绝旧 v2；保留音画联动契约测试。
- `src/core/documents/documents.test.ts`：类型登记中的剪辑内容版本断言更新为 2。
- `src/core/videoEdit/timedContent.test.ts`：修正当前文档测试的旧版本兼容文案，保留字幕/标记时钟契约。
- `src/features/videoEdit/VideoEditPreview.test.tsx`：验证半速姿态即时重画、旧姿态取消及覆盖曲线保留播放时钟。
- `src/features/videoEdit/engine/videoEditDisplayClock.ts`：沿既有时钟计算已到帧，示范姿态无需等待未来播放帧。
- `src/features/videoEdit/engine/videoEditDisplayClock.test.ts`：验证起播预留时间、慢速、倒放和边界的时钟求帧。
- `src/features/videoEdit/application/videoEditMotionWorkerClient.test.ts`：验证流式 ACK、空闲 Worker 复用、取消迟到隔离、关闭和闲置释放。
