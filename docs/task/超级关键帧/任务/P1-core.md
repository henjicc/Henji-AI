# t143：P1 纯契约与共享算法

状态（2026-10-11）：**本模块 49 个精确测试通过；公共 core 受并行图片任务失败阻断；双端 tsc 最终通过，集成待验。** 本单完成 P1-0 的纯 core 部分与 P1-1 的确定性内核，没有注册持久格式、助手能力或 UI，不能登记整个 P1 完全验收。总管理者负责复审与 Git；本单没有执行任何 Git 写操作、SDK 修改、付费调用、Reality 或开发实例启动。

## 实现与文件范围

全部代码新增于 `src/core/creativeIntent/`，未修改现有 videoEdit 求值器、图片文件、package/锁文件与 baseline。

| 文件 | 职责 |
|---|---|
| contracts.ts | MotionDraft、pose/pins/基态/候选身份、双时钟/clockSegments/visit、页与资源引用的唯一纯 schema |
| schema.ts | ExplanationSession、控制/指针/命令/增量/转录/标注/几何/音频事件与历史图像证据 |
| pages.ts | 强类型页、页内顺序/条数/时钟校验、注入 SHA-256 与 I/O 的逐页惰性读取 |
| sampling.ts | 最后确认姿态、反向 take、硬 pins 冲突、重访选择、gap/未知引用拒绝、协作取消 |
| fitting.ts | Schneider 拟合与原生时间基函数精化、事件分段、密集回退、保真去抖 |
| recipe.ts | 显式 follow_path/move_line/dwell/overshoot/spring_settle/scale_focus 的编译期子集 |
| recognition.ts | 保守 dwell / 已观察过冲证据；不猜循环、呼吸、弹簧与指针意图 |
| motionCompiler.ts | 显式宿主坐标转换，编译现有普通关键帧，正式求值与 pins/范围检查 |
| layout.ts | 完整仿射保持、真实世界边缘对齐/等距、组与硬锁约束、候选 |
| layoutElimination.ts | 独立固定大小等式消元，耦合约束交回成熟 Cassowary |
| candidates.ts | 输入身份、候选差异、过期拒绝、独立封页批次的 Worker 计算接口 |
| index.ts | 唯一共享入口；生产模块全部相对导入，无 features/stores/I/O |
| fixtures/motionFixtures.ts | 独立解析真值、4K60/120Hz 固定种子轨迹、真实呈现帧与静态几何 |
| fixtures/scoring.ts | 正式帧/四分之一帧 RMS/P95/max、事件/焦点/角度/尺度、原稿与 pins 硬门槛 |
| contracts.test.ts / motion.test.ts / layout.test.ts | 契约、拒绝恢复、帧保真、静态约束和范围的精确测试 |
| benchmark.test.ts / worker.test.ts | 合成基准、5 次预热/30 次短动作测量、独立进程真实 Worker 长记录与取消 |

本记录与 02-实施拆分.md 的 P1-0/P1-1 末尾状态行是唯一文档改动。

## 对外接口

从 `src/core/creativeIntent/index.ts` 相对导入；主进程不使用 `@/`。

| 消费方 | 接口与输入 | 输出/契约 |
|---|---|---|
| P1-0 存储接线 | motionDraftSchema / explanationSessionSchema / creativeIntentPageSchema / readCreativeIntentPages | 严格封闭契约；宿主提供 owner、sourceDigest、异步 hash/I/O，可附 clockSegments 进行页事件引用校验 |
| P1-2 剪辑 | optimizeMotionDraft({draft,samples,mappings,selectedTakeIds?,intent?}, control) | candidates + unavailable；每 take 的 curves/range/keyCount/maxErrors，全部为现有 VideoEditKeyframe[] |
| P1-2 坐标桥 | MotionCompileContext：positionToNative、pivotToNative、clipStart、scaleFactor、rotationOffsetDegrees | 从作品比例坐标到原生片段偏移与 local frame；不按墙钟缩放动作，不隐式假设偏移就是作品中心 |
| P1-3 图片 | solveStaticLayout / createLayoutCandidates(items,constraints,identity,control) | 完整 affine 与世界平移 delta；只整理已声明目标，不改变尺度/旋转/字体/层级；groupRef 维持同组共同平移 |
| P1-4 候选 | MotionCandidate / LayoutCandidate、motionCandidateIdentity / assertCandidateCurrent | 当前输入、owner、源摘要、目标基态、几何、算法版本、保真/意图/映射/采用 take 身份；变化后重新计算 |
| Worker | optimizeMotionBatches(asyncInputs,{cancelled,checkpoint}) | async generator，逐批返回 partial:true；取消检查在批次、采样和拟合/校验边界内，不代表全局应用成功 |

位置、pivot 用作品比例；rotationTurns 用连续展开角（不自动 modulo）；scaleXY 为正双轴尺度。墙钟为安全整数微秒，seq 为安全整数全局事件序号，作品时间为实际 presented frame + 有理 fps + sequence/visit。requestedFrame 只作为请求事实；hold 不推进作品帧，seek 是零时长访问边界，gap 内不补事件或路径（仅容许录制控制边界事实）。静态事件 timeline=null 并带 static 原因。

轨迹按墙钟原顺序验证，单调 take 内才按作品帧编译；同 take 普通同帧采用最后确认姿态，旧采样的 valueLocked pin 仍优先精确保留。跨 take 重访不做 last-write-wins，必须显式选择；同帧互斥 pins 返回两个 pin 身份。timeLocked 点成为硬时间边界。fidelity=1 的原稿候选直接保留合法正式帧值，密集点不受 K 区间限制；其余保真值逐渐收紧误差与去抖幅度。原稿输入完全不变。

候选最多三份。明确过冲量/焦点时间曲线可产生两份可见差异；约束与保真下等价候选经**现有正式求值器**去重，返回 no-distinct-result，不换名字凑数。未给动作意图不会凭两点、hover 或噪声制造回弹。

## 选型依据与可复核身份

- [fit-curve 上游](https://github.com/soswow/fit-curve)，0.2.0，MIT：直接采用 Schneider 实现；空间 RDP / [simplify-js](https://github.com/mourner/simplify-js) 不保持双时钟、停顿与回弹硬点，未采用。Schneider 的 chord 参数与几何端切线直接转时间曲线时，S03/S04 子帧峰值误差超预算，不能放宽预算。因此先消去精确端点，在现有原生固定时间基函数内解两自由柄的 2×2 最小二乘；不够时比较上游 Schneider 与自适应原生分段，选择经正式求值校验的较少合法点。该层只做表示转换/硬边界，并没有复制播放求值器。
- [LUME Kiwi 上游](https://github.com/lume/kiwi)，0.4.4，BSD-3-Clause：直接采用 Cassowary，required 等式落实硬锁/硬对齐/组关系，软偏好与 weak 原姿态不覆盖 pins。同一 S13 输入，消元 0.377 ms、Kiwi 3.478 ms，完整输出仿射相同。1000 对象的全 weak Cassowary 表测试出现明显长耗时，独立固定尺寸对齐/间距等式可精确消元为线性流程，耦合轴/外部参照重叠/组仍交 Kiwi；没有另造通用求解器。
- [OSQP 官方求解说明](https://osqp.org/docs/solver/index.html) 已比较：当前没有需要联合优化的大规模柄 QP；上面的端点消元仅两个未知量，引入 WASM 初始化/矩阵装配没有收益，本单未引入 OSQP，不虚报 OSQP 实测胜负。
- 两个上游库以 npm 精确版本依赖引入（`fit-curve@0.2.0`、`@lume/kiwi@0.4.4`），不在仓内复制；fit-curve 自带声明漏了取消用的进度回调参数，在 `fitting.ts` 局部补类型。
- fit-curve.mjs SHA-256：`706e7f01ef217f150ba379c310c03bfd1336ed6bf1ab63ff2959d0d1fbac20b5`。
- 本单当前 TS/MTS/MJS 内容身份：`4274138197e389cefb99937b506e04f846631e2fb6b4afe5bf89dfa7b7546ca0`；按 Windows 相对文件名排序后依次 SHA-256(文件名+原始字节)，排除结果 JSON/文档。Git 身份由总管理者提交时补充；本单没有创建提交。

## 合成基准结果

版本 motion-draft-benchmark-v1；固定 fast-check seed=14001，4K60、120Hz，噪声为短边 ≤0.1% 的 14Hz/4Hz 固定相位组合。真值在夹具内以独立解析函数定义，不由编译器生成参考。逐正式帧、四分之一帧以及 Bézier 解析导数定位的峰谷调用既有 evaluateVideoEditKeyframes；pins/原稿/范围是独立硬门槛。S03另测峰时刻/幅度；S04测回弹峰；S02/S10测停顿漂移；S08保持世界焦点。

辅助分沿 03 §5.4 的 q(r,b) 与适用权重；P2/P3 识别、人眼候选差异/手感均 N/A，按适用项归一，**不是 P1 发布分**。S07/S06 等仅证明原轨迹保留，不声称脉冲/循环识别。拒绝例没有成功曲线，不捏造 100 分。

| 夹具 | 辅助得分 | 硬失败 | 整理耗时 ms | K | 候选数 | 位置 RMS / P95 / max（短边比例） | 最大角误差 ° | 最大尺度 log 比 |
|---|---:|---|---:|---:|---:|---|---:|---:|
| S01 | 99.66 | 否 | 74.35 | 2 | 1 | 1.83586e-8 / 3.17891e-8 / 3.17891e-8 | 0.00000 | 0.00000 |
| S02 | 99.90 | 否 | 35.08 | 6 | 1 | 9.38773e-9 / 1.81145e-8 / 2.58731e-8 | 0.00000 | 0.00000 |
| S03 | 99.92 | 否 | 27.15 | 3 | 2 | 1.70938e-8 / 3.86238e-8 / 5.14984e-8 | 0.00000 | 0.00000 |
| S04 | 99.04 | 否 | 10.95 | 8 | 1 | 0.0000251408 / 0.0000260320 / 0.000267616 | 0.00000 | 0.00000 |
| S05 | 99.93 | 否 | 14.44 | 3 | 1 | 2.00899e-8 / 4.05912e-8 / 4.76837e-8 | 0.00000 | 0.00000 |
| S06 | 99.13 | 否 | 49.38 | 9 | 1 | 0.0000741417 / 0.000114310 / 0.000119186 | 0.00000 | 0.00000 |
| S07 | 99.32 | 否 | 31.00 | 39 | 1 | 0.00000 / 0.00000 / 0.00000 | 0.00000 | 0.00104176 |
| S08 | 99.48 | 否 | 114.05 | 2 | 2 | 4.75828e-9 / 9.45421e-9 / 1.12705e-8 | 0.00000 | 1.17658e-8 |
| S10 | 99.92 | 否 | 28.37 | 6 | 1 | 9.38773e-9 / 1.81145e-8 / 2.58731e-8 | 0.00000 | 0.00000 |
| S11 | 99.92 | 否 | 18.14 | 4 | 1 | 5.95556e-9 / 1.43424e-8 / 1.58946e-8 | 8.94070e-7 | 8.16566e-9 |
| S15 | 94.65 | 否 | 72.28 | 37 | 2 | 0.0000296740 / 0.0000569701 / 0.0000676185 | 0.00000 | 0.00000 |
| S16 | 99.23 | 否 | 11.83 | 34 | 1 | 0.0000213164 / 0.0000414781 / 0.000147515 | 0.00000 | 0.00000 |
| S10@0.25x | 99.87 | 否 | 46.94 | 6 | 1 | 9.38773e-9 / 1.81145e-8 / 2.58731e-8 | 0.00000 | 0.00000 |
| S10@0.5x | 99.91 | 否 | 31.07 | 6 | 1 | 9.38773e-9 / 1.81145e-8 / 2.58731e-8 | 0.00000 | 0.00000 |
| S10@1x | 99.92 | 否 | 28.45 | 6 | 1 | 9.38773e-9 / 1.81145e-8 / 2.58731e-8 | 0.00000 | 0.00000 |
| S01@24000/1001 | 99.91 | 否 | 19.44 | 2 | 1 | 1.78059e-8 / 2.98321e-8 / 3.11580e-8 | 0.00000 | 0.00000 |
| S01@60000/1001 | 99.92 | 否 | 16.77 | 2 | 1 | 1.81435e-8 / 2.99647e-8 / 3.15558e-8 | 0.00000 | 0.00000 |
| S01-noisy | 99.83 | 否 | 37.18 | 2 | 2 | 1.83586e-8 / 3.17891e-8 / 3.17891e-8 | 0.00000 | 0.00000 |

S02/S10 的 dwell 事件偏差 0 帧，S03 过冲峰事件偏差 0 帧，声明支持的这些样本事件 F1=1；S08 焦点最大漂移 7.74729e-16 短边。S01-noisy RMS 改善 99.9964%。S15 的 K=37 超过参考 12–24：保住八字交叉、停顿、反向以及严格时间/几何误差，当前没有截断点数达标；稀疏参考 ≥90% 的整组门槛不能据此宣称已完成。S03/S05/S11 的 K 低于参考下沿，独立几何/事件已过，少点未丢运动，但不将其硬算成“落在参考区间”。

| 其他夹具/负例 | 得分 | 硬失败 | 测试段耗时 ms（包含拒绝/恢复断言） |
|---|---|---|---:|
| S14 | N/A（拒绝/恢复） | 否；预期无效输入被拒绝 | 45.07 |
| E02 | N/A（拒绝/恢复） | 否；预期无效输入被拒绝 | 15.43 |
| E04 | N/A（拒绝/恢复） | 否；预期无效输入被拒绝 | 35.87 |
| zero timeline span does not turn wall-clock waiting into a dwell animation | N/A（拒绝/恢复） | 否；预期无效输入被拒绝 | 8.94 |
| S17 | N/A（拒绝/恢复） | 否；预期无效输入被拒绝 | 31.56 |
| S17 | N/A（拒绝/恢复） | 否；预期无效输入被拒绝 | 2.21 |
| rotation domain, nonuniform video scaling and unsupported recipes are rejected without clamps | N/A（拒绝/恢复） | 否；预期无效输入被拒绝 | 20.13 |
| S13 | N/A（约束断言） | 否 | 10.05 |
| hard conflicts reject with references rather than moving a pinned object | N/A（约束断言） | 否 | 1.76 |
| fixed nonuniform/rotated affines remain complete; shared groups preserve relative translations | N/A（约束断言） | 否 | 3.75 |
| S18 | N/A（约束断言） | 否 | 37.93 |

S13 两候选保持主图/标题完整仿射，上边缘全等、真实边缘间距 0.06；S18 静态处理全部 1000 对象，尾 pin 不动，硬约束残差 <1e-8。静态、拒绝例分数 N/A，约束断言是通过依据。契约的 10 项测试另覆盖非法数/页损坏截断/重复 seq/源 owner、词句跨 visit、ASR segment 不造 wordId、undo/redo 关联、失败命令不造状态变化、历史图像状态/ROI/像素预算、已删原音/无授权录制；这里只证明 schema/纯事件契约，尚未完成 E01–E09 的真实连续采集/词对齐/图像理解验收。

## 性能与运行环境

Windows win32；AMD Ryzen 9 5900X 12-Core Processor，24 逻辑核，63.91 GiB RAM；Node 24.18.0，Vitest 1.6.1。没有启动 Electron；以下是纯算法与测试 Worker 指标，不能代替 03 §6 的真实 IPC、冷启动、UI 呈现与输入延迟。

| 路径 | 规模/方法 | P95 | P99 / worst | 结论 |
|---|---|---:|---:|---|
| 动作全部候选+正式校验 | 10s，120Hz，5 次预热+30 次；同进程纯内核 | 231.14 ms | 234.40 ms | 小于 900ms；暖计算亚秒 |
| 布局全部候选 | 100 层，几何已提供，5 次预热+30 次 | 3.39 ms | 3.86 ms | 小于 900ms，不包含几何获取/呈现 |
| S18 长 Worker | 独立隐藏 Node 子进程内真实 worker_threads，1200 个独立 3s S02 封批、433200 原采样、尾帧 216000 | N/A（单次压力） | 17889.06 ms 总耗时 | 全部尾部处理，没有累积原稿数组 |
| 长 Worker 内存 | 运行前基线至测量峰，工作量含夹具与核心算法 | heap +129.23 MiB | RSS +192.60 MiB | 两者均小于 256MiB |
| 取消 | 共享 Atomic 标志，完成第一批后请求取消 | N/A（单次） | 1.498 ms | 小于 100ms；原稿/已封页不动 |

30min / 60min 检查点 RSS 303.895 / 304.188 MiB；峰增量不是这两个绝对 RSS。Vitest 同进程 RSS 会混入其他测试，已改为独立 Node 子进程归因；没有拿混合 RSS 冒充核心内存结果。长段性能夹具是逐批独立 take，不证明完整一小时文档的全局 pins/跨批重访冲突与一次应用；那部分由集成接线验证。

256 个采样的拟合工作分段只是取消/库调用预算；没有素材、图层、take、样本或关键帧数量产品上限。正式技术约束为安全整数时间、正尺度、可逆矩阵、现有普通片段统一 scale 与 rotation [-360,360] / scale [0.01,4] 等既有曲线域，以及显式弹簧每周期至少 4 帧；越界给失败原因，不 clamp、不丢尾部。

复跑精确基准：`npx vitest run src/core/creativeIntent --silent`。需要原测量 JSON 时，单次进程设置 `HENJI_P1_BENCH_DIR` 为存在的可写目录；默认测试不落盘。临时结果 JSON 不提交，本记录保留数值与复现方法。

## 检查证据

本单按 testing.md L2（共享契约/取消与多消费方内核）选两端 tsc、精确测试、文件 ESLint、dependency-graph/dead-code。全 core 是本任务明确要求的额外检查，不跑全仓、related、构建或 Reality。

| 检查 | 实际结果 |
|---|---|
| npx vitest run src/core/creativeIntent --silent | 5 文件 / 49 测试通过，后续新增记录和过期身份断言所在 motion/layout 精确测试分别通过 |
| npx vitest run src/core --silent | **1 failed / 1631 passed / 1 skipped**（244 文件；01:29 运行）。未达到要求的 0 失败；失败在不属本单的 builtInRenderNodes.test.ts:68，图片任务新增 mosaic，预期列表仍缺它 |
| npx tsc -p tsconfig.json --noEmit | 最终通过；此前并行图片测试重复导入导致失败，图片负责人已修正，本单未修改其文件 |
| npx tsc -p tsconfig.electron.json --noEmit | 通过 |
| 本单 .ts/.mts/.mjs 文件 eslint，--report-unused-disable-directives --max-warnings 0 | 通过；后续测试文件再次精确检查通过 |
| npm run check:dependency-graph | 通过：2 静态 SCC / 0 冻结跨层边；新生产内核无 features/stores 依赖 |
| npm run check:dead-code | 最终通过：1 baseline 未使用文件 / 0 未使用依赖；2106 导出/类型仅报告。新纯接口由测试覆盖、生产接线待后续，不改 baseline 造假已用；现存 unlisted/unresolved 提示如脚本 esbuild、nanoid 与 native Worker 不属于本单 |
| Git / SDK / Reality / Electron dev /付费 | 全部未执行；现有并行工作未暂存/提交/还原 |

最后一次全部 core 运行后，仅本模块文件被定向修正并通过精确检查，没有再跑受并行任务影响的整套 core 兜底；总管理者在图片任务稳定后修复剩余 mosaic 预期问题并完成 0 失败检查。

## 接线要点与未完成项

1. P1-0 在图片任务结束后串行修改 documentTypes、codec、descriptor、persistence formats/versions/baseline 与黄金样本；头引用页资源，禁止把所有采样平铺文档。按当前开发规则升正式版本/dev-break，不迁移旧数据。页、原稿、候选、词稿、历史图像、原音、undo/redo live-set 一起纳入资源收集、移动/独立包/导出/GC与隐私擦除；原音删除不删文字和动作。
2. 页 hash 是宿主对封页原始 UTF-8 字节的 SHA-256，sourceDigest 必须随采样/pins/take/意图原输入变化；夹具固定摘要仅供测试。多类分页各自顺序读取，跨种事件用 monoUs/全局 seq 合并；不把按 kind 分开的页硬接成一个乱序事件流。补跨资源引用目录、页字节数/种类/条数对账、未封页保存失败恢复、边界序号/seek/visit 校验与完整导出重开。
3. P1-2 用实际节目呈现帧/稳定 sequenceRef 与 visit，而非 requestedFrame 或墙钟推算；pause 播放继续采集原帧，pause 录制写真实 gap。逆序或 seek/方向切换分 take，旋转传连续展开角；unwrapRotationTurns 只用于明确 wrapped 的传感器值。一个同帧零时长摆放只返回一个普通点，不发明动作时长。clipStart 之外范围/既有曲线合并、越界片段末端、原子写入与一次撤销由正式宿主校验。
4. P1-3 提供真正裁剪/旋转/文字/祖先矩阵后的世界边缘，LayoutItem.affine 必须对应同一历史姿态/几何。translationLocked 从实际锁层与 valueLocked pins 派生；若 pin 指向较早采样，先使用该 pin 对应姿态几何，不拿最后姿态替代。已有固定尺度/旋转本来不会改变；不等价的多个静态 pin 必须在 adapter 归并时显式冲突。世界 delta 用原矩阵核转换回本地祖先坐标，不能直接当 local affine 平移；本内核没有接静态草稿页→宿主状态的采集桥。
5. 流式输入必须是独立、完整封好的计算单元；批结果只可预览。宿主维护跨批目标/基态/重访区间、pins 来源和连贯性索引，全部完成后复核全局锁/间距/范围，才允许同一个原子事务应用。Worker Promise/共享取消/最新请求竞争、序列化和长任务生命周期使用现有通道；本单没有增加 IPC、Worker 宿主或日志通道。
6. P1-4 保真/模式/意图/采用 take 或几何变化都使请求过期；应用前重新读基态并用带完整 request 的 motionCandidateIdentity 与 assertCandidateCurrent 比较。组件展示任务原因，不展示摘要/seq/算法版本等内部状态；原稿 A/B 与局部曲线合并仍需真实宿主。
7. P1-5 按 assistant-capability 覆盖分级接 draft/take/pin/candidate 通用实体读写，优化作为算法入口；本单仅纯算法，无新界面/业务可用入口，未改助手台账。一次撤销、保存事实、权限、导出重开、留出 R01/R02/R04/R06、人眼三评与冷 Worker/IPC/真实 Electron 手感均未验证。
8. 大规模耦合组的 Kiwi 性能与库内部单次调用取消延迟尚未测量；本次 1000 层与取消成绩分别只覆盖独立等式布局和运动计算，不能外推。S15 与 ≥90% 参考稀疏比例仍需后续优化并公开误差/K 对照；不能用辅助分 >85 隐去未达标项。P2 的循环/往返/呼吸/脉冲、复杂相对约束、P3 ASR/语义/图像识别不在本单，支持原轨迹不等于识别完成。

## 设计自查

1. **助手能否只凭名称和说明用对？** 纯接口已按“整理示范轨迹 / 保持焦点推近 / 对齐真实边缘”意图封闭参数，硬 pins 与目标范围自动校验，缺实际帧或歧义重访返回恢复原因；下一任务仍须接通用实体与能力描述，当前尚不能由正式助手调用。
2. **能否 AI 先做、人只确认？** 内核自动拟合、保存停顿/回弹、给有差异的候选及布局；人确认动作、采用 take、保真度和最终应用，硬冲突不替人解钉。此阶段先提供确定性整理，不依赖付费模型。
3. **产物能否直接流入其他工作区？** 输出现有普通关键帧和完整图片仿射，复用原求值/导出/资源桥即可继续编辑；原稿页、历史证据和草稿资源的跨工作区搬运仍待 P1-0/P1-5 接线验收，没有另建播放器或私有成品格式。
