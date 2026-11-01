摘要：C 线代码与一轮独立审查修复已完成；本分支仍基于 3c813ce7d，A 依赖未交付，尚不能视为完成验收。
摘要：不修改冻结 DTO/签名，不安装依赖，不使用 9334，不合并、不推送。
摘要：本分支直接回归17项通过；只读交叉预检数值13项、正式闭环4项、混合二维运动28项、同源覆盖/保存22项通过；预检不替代本分支L2。

## A 线接线需求

- C 按冻结契约消费 `spatialEvaluation.ts` 的 `evaluateSpatialFrame`、`spatialPropagation.ts` 的 `applySpatialPatch` / `planSpatialPropagation`。
- 请 A 在独占的 `application/videoEditMotionWorkerClient.ts` 导出 `planVideoEditSpatialLayoutOffThread(snapshot: SpatialSnapshot, intent: SpatialLayoutIntent, output: SpatialOutput, signal: AbortSignal): Promise<SpatialPatch>`，委托 C 的 `core/videoEdit/spatialLayout.ts::planSpatialLayout`，沿既有运动 Worker 支持取消。该转接不改 4.5/4.6 冻结签名。
- C 通用字段接入消费 A 的 document/keyframes 空间字段；格式基线、manifest/seeds 等全局生成产物仍由 A/Claude 串行登记。
- 工作分支：`task/16C-三维算法与读回`，父契约 `3c813ce7d`；C 改动共26文件（含相邻语义回归），均在3.1所有权内。当前没有可报的交付提交：正式 L2 尚未通过，不把依赖缺失状态提交为已验收成果。


## 当前完成与证据（等待 A 交付后的最终门禁）

- 新增两项写算法、只读空间验证、同源片段/相机属性、完整引用转换及光学输入规范化；4.5/4.6 冻结 DTO 与签名未改。
- 布局以层中心视差比求解，三维矩阵与相机只使用 A 求值；普通关键帧拟合检查输出帧与四分之一帧，门槛仍为 0.25px。区间外 Bezier/easeRange/easeValues 保留。
- 结构读回逐记录分页、绑定内容身份，含多边形裁剪/遮挡、层序、焦点、CoC、近远裁剪与未知场景边界。二维屏幕覆盖项也参与遮挡；不执行作者代码，不把结构证据标成视觉通过。
- 转场分组同时查正式转场窗口，即使上游未标 compoundGroup，也不能把正在淡出的矩形当完整不透明遮挡证据；景深虚化边缘同样保留未知，不证明完全覆盖。区间局部激活会导致非零休眠空间数据在范围外生效时，计算阶段明确返回事实；全片重排采用有效平面姿态，不恢复休眠曲线覆盖试解。
- 取景目标、占高、透视保存在正式相机字段；原始焦距输入经同一公共 schema 规范为透视量。undoRef 为文档历史的稳定引用，传给 undo_video_edit.documentRef，沿同一撤销栈；不伪造通用事务的撤销令牌。
- 二维运动候选合并按支持键遍历，忽略候选带来的空间曲线；错峰复用同一键定义。录制/拟合/候选应用、稳定、跟踪应用/关闭/撤销以混合空间数据精确回归。
- 修复共享拟合器提前把两个帧间隔退化成直线的问题，允许细分到单帧；保留非线性子帧参考测试。
- 配方已改为风格件 → 内置效果 → 宿主空间能力 → 标准 three 内容；不继续教学手写投影、相机或景深核。

### 已实际执行

| 验证 | 当前结果 |
| --- | --- |
| 本分支 `motionDraft.test.ts`、`stagger.test.ts`、`fitting.test.ts` | 3 文件 9 项通过，10.33s（测试主体 63ms） |
| 本分支 `stabilization.test.ts` | 8 项通过，6.42s（测试主体5654ms）；含空间四键/曲线保持回归 |
| `check:assistant-capabilities:structure` | 通过 |
| 改动文件 ESLint | 最后修复后全部22个TS文件通过，3.81s；`git diff --check` 通过 |
| `npm run check:assistant-capabilities` | 正式执行未通过：结构检查通过，coverage 在收集时因缺少 A 的 spatialPropagation 中止；invariants 未执行 |
| 渲染层 tsc | 默认堆OOM；最后8GiB堆完成检查，报A求值/传播模块、document/keyframes空间类型及Worker转接缺失，未通过；类型未接入产生的后续错误也未掩盖 |
| 主进程 tsc | `node --max-old-space-size=8192 node_modules/typescript/bin/tsc -p tsconfig.electron.json --noEmit` 通过 |
| `verify:changed -- --level L2 <26 个明确文件> --test <10 个精确测试>` | dry-run 与正式命令均实际执行，均因 `spatialLayout.test.ts → ./spatialEvaluation` 不存在而依赖解析失败；L2未通过 |
| 数值算法交叉预检 | 只读映射A工作树的document/keyframes/spatialSchema/spatialEvaluation/spatialPropagation，最后13/13通过；6.04s（主体747ms），含转场/休眠/景深alpha边界 |
| 正式应用调用交叉预检 | 正式声明/反射/事务/状态/存储，线程与像素边界替身；最后4/4通过，38.72s（主体1443ms），真实使用返回的文档undoRef撤销 |
| 二维运动交叉预检 | videoEditMotionDraft + videoEditTrackingCapabilities，28/28 通过，50.54s（主体1800ms） |
| 同源覆盖/保存交叉预检 | applicationControlCoverage、videoEditAssistantCoverage、applicationDomainPersistence，3文件22项通过，72.45s（主体1.78s）；纯harness无Electron导出登记的边界警告不算真实运行证据 |

交叉预检通过 Vitest 的临时内存解析插件只读引用 A 工作树，不复制、不修改 A 文件，不安装依赖；A 当时仍是未提交实现，因此只能用于提前发现接缝问题，不能替代 C 分支最终类型检查、L2 或整票验收。未运行真实 GPU：C 未改 shader、GPU 调度或像素实现，P1–P5 为 A/B 集成后的整票验收；也未启动 Electron、9334 或真实作品。真实助手模型/外部MCP与GPU画面闭环尚未验证，不能由应用harness的通过项代替。

### 独立审查一轮

全新上下文只读审查：2 项重要问题，均修复并补语义回归。
1. 展开覆盖区间外 framing.heightFraction：改为按范围写 framingHeightFraction 曲线，保留原静态值/曲线及绑定；测试覆盖休眠目标在后续时刻恢复。
2. 稀疏图形参数默认坐标被误当成0：共用正式 prepareVideoEditGraphic 的默认值/校验，只证明实际满幅不透明矩形；测试覆盖透明留白与二维覆盖。

审查后的交叉预检还修复了二维输入无空间卡几何、平面旋转等价解选择不连续、公共相机输入与读回规范化不一致；没有降低门槛。

### 尚待协调

- A 工作树已有求值/传播/schema 实现，但未形成可吸收提交。A 分支现已前进到 69127fe3b（合并 main），C 未自行吸收或切换分支。
- A Worker 当前只有 spatial-evaluate / spatial-propagate，C 所需 `planVideoEditSpatialLayoutOffThread` 尚缺；请保留布局错误的 SpatialFact 结构穿过 Worker。
- 未改 assistant-status、全局 manifest/seeds 或持久格式登记文件，所有权仍由 A/Claude 汇总。
- 等待用户/Claude 确认吸收 A 依赖提交后，重跑本分支精确测试、能力聚合门禁与 L2，再在任务分支提交；未提交、未推送。

本轮停止点为依赖协调，不申请改设计或降低门槛。需要A交付可吸收的正式求值/传播/schema实现及布局Worker转接，再确认怎样把该依赖带入C任务分支；C不会越过3.1所有权修改A文件，也不会通过把静态导入改成不可检查字符串或另写替代求值器来掩盖缺失。
