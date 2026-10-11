# t165：错峰复制动作与 3D 机位界面（最小版本）

2026-10-11；工作目录 `D:/VibeCode/henji-wt-batch`，分支 `codex/minimal-batch`。总管理者负责审查、截图和 Git 提交。本单只改代码、单测和指定记录；没有 Git 写操作、付费调用、安装依赖、构建、Reality 或开发实例启动/重启。

## 范围与实现

- 剪辑超级关键帧仅增加一行“应用到所选，依次错开 [4] 帧”和次级“应用”。选中多个视觉片段且其中一个已有运动曲线时显示，优先选主选片段为源；有入出点时使用其与源片段相交的区间，否则使用源动作的起止帧。
- 错峰算法采用源片段内帧，第一个目标延后 N 帧、后续按所选顺序累加。位置、角度与锚点相对各自基态相加；缩放相对比例相乘。保留曲线插值、裁切后的贝塞尔区间及目标其他区间。目标锁定、跟随、禁用运动、时长不足或值越界时整批拒绝；先完整计算，再一次正式文档事务写入，一步撤销。没有数量上限。
- 3D 路径工具旁复用剪辑样式入口与 `CreativeIntentControls`，增加 camera profile，只显示机位/视线/焦距、示范控制、钉住当前机位、原稿/平滑推拉/环绕/推近停顿及既有预览/应用操作；不显示二维示范模式、倍速、动作原语或保真滑块，不加常驻说明。
- 拖时间指针只 seek；视口 OrbitControls/相机 gizmo 的移动才记录示范。播放中采用原生播放 runtime 的呈现时间；临时样本和候选不写正式状态关键帧或历史。候选沿原生视口与播放采样器预览，应用调用 t160 的 `cameraMotionService`，保存失败保留同一应用句柄，重试仅保存。
- 视线采用原生旋转轨道表达，手动视线变化通过已有相机数学换算；对象跟踪目标保持原有约束，不扩展动态目标动画。焦距沿原生 FOV 轨道；没有新增持久 schema、私有播放器或正式派生轨道真相。

## 助手覆盖与设计自查

覆盖分级为算法入口，同源调用领域服务，不增加普通属性专用工具：`stagger_video_edit_motion`、`organize_camera_stage_motion`、`apply_camera_stage_motion_candidate`。遵循现有 capability ID 的下划线规则，未使用点分 ID。输入用文档/片段/机位/状态关键帧引用、源区间、依次错开帧数和候选选择表达；校验归属、权限、过期候选，结果返回真实修改引用与保存状态。

1. **助手只凭名称和说明能否用对？** 能。错峰说明明确源局部区间、目标顺序、基态关系及整批拒绝条件；3D 先整理再确认应用，说明审阅句柄、过期重整及保存重试规则。正式公共调用测试覆盖发现、执行、归属拒绝、读回与撤销。
2. **能否 AI 先做、人只确认？** 能。助手调用确定性错峰；3D 先生成原稿对照与三族候选，人通过原生视口预览后应用或钉住校正。没有让模型直接写场景或额外收费步骤。
3. **产物能否直接流进其他工作区？** 使用正式片段曲线和完整场景状态关键帧，已有剪辑/场景导出可继续消费；本单不新增跨域配方或 2D 到 3D 转换承诺，未实测跨工作区媒体交付。

## 选型

沿用已集成的成熟 `three`、`@react-three/fiber`、`@react-three/drei` 和 `three-stdlib` 原生相机交互/播放；曲线复用项目唯一 `sliceVideoEditCurves`、`mergeMotionClipCurves`，场景复用唯一状态关键帧编译与 t160 三族候选服务。通用 tween/独立轨迹库不能替代现有文档事务、贝塞尔裁切和场景状态契约，因此只添加基态相对复制算法与宿主薄接线，没有新增依赖。

## 本单文件清单

| 文件 | 本单改动 |
|---|---|
| `src/core/creativeIntent/stagger.ts` | 确定性区间复制、相对基态转换和整批校验。 |
| `src/core/creativeIntent/stagger.test.ts` | 基态/缩放/贝塞尔/区间保留与失败拒绝测试。 |
| `src/core/application-control/domains/videoEdit/videoEditStaggerCapability.ts` | 注册错峰算法契约。 |
| `src/core/application-control/domains/videoEdit/videoEditApplicationCapabilities.ts` | 将错峰加入原能力目录，保留 t164 改动。 |
| `src/features/videoEdit/application/videoEditMotionDraft.ts` | 多选源判断及一次事务错峰应用，保留 t164 改动。 |
| `src/features/videoEdit/application/videoEditStagger.test.ts` | 公共算法、归属校验与批次撤销测试。 |
| `src/features/videoEdit/application/applicationDomain.ts` | 公共错峰执行接入同源服务，保留其他任务改动。 |
| `src/features/videoEdit/application/videoEditDocumentAlgorithm.ts` | 错峰加入原子文档算法保护。 |
| `src/features/videoEdit/panels/VideoEditMotionControls.tsx` | 仅增加错峰行及其本地输入，保留 t164 开关。 |
| `src/features/creativeIntent/ui/CreativeIntentControls.tsx` | 共用 camera profile 与最短机位文案。 |
| `src/features/creativeIntent/ui/CreativeIntentControls.test.tsx` | 验证 camera 标签、回调及二维选项隐藏。 |
| `src/core/application-control/domains/cameraStage/cameraStageIntentCapabilities.ts` | 注册只读整理和正式应用两个算法契约。 |
| `src/core/application-control/domains/cameraStage/cameraStageMotionApplicationCapabilities.ts` | 加入原机位能力目录。 |
| `src/features/cameraStage/application/cameraMotionDraft.ts` | 临时示范、钉点、原生预览及保存重试接线。 |
| `src/features/cameraStage/application/cameraMotionDraft.test.ts` | seek/示范/预览/公共调用/撤销/保存恢复与钉点失败测试。 |
| `src/features/cameraStage/application/cameraMotionCandidates.ts` | 手动视线适配与不受 seek 影响的候选身份。 |
| `src/features/cameraStage/application/cameraMotionService.ts` | t160 接收临时示范并提供只读原生预览。 |
| `src/features/cameraStage/application/registerCameraStageCapabilityHandlers.ts` | 公共机位整理/应用同源接线。 |
| `src/features/cameraStage/scene/StageScene.tsx` | 相机 gizmo 示范截获与临时姿态呈现。 |
| `src/features/cameraStage/scene/StageCameraViewControls.tsx` | 原生机位视口示范截获。 |
| `src/features/cameraStage/scene/StagePlaybackDriver.tsx` | 原生播放消费临时候选。 |
| `src/features/cameraStage/toolbar/CameraMotionControls.tsx` | 共用控制面板薄宿主。 |
| `src/features/cameraStage/toolbar/StageViewportToolbar.tsx` | 路径工具旁增加入口。 |
| `docs/task/超级关键帧/02-实施拆分.md` | 仅增加 t165 状态行。 |
| `docs/rules/assistant-status.md` | 仅登记 t165 新接通算法与未验证边界。 |
| `docs/task/超级关键帧/任务/t165-stagger-camera.md` | 本单指定记录。 |

## 验证

本单为 L2（共享曲线算法、正式事务和原生预览接线）；按用户要求四目录分开单 worker 静音运行，没有全仓测试；cameraStage 目录明确包含本单接线与 t160 原服务调用方，同源排查不扩大到其他工作区。

- `npx vitest run src/core/creativeIntent --silent --minWorkers=1 --maxWorkers=1`：18 文件、149 项通过、0 失败。
- `npx vitest run src/features/creativeIntent --silent --minWorkers=1 --maxWorkers=1`：7 文件、29 项通过、0 失败。
- `npx vitest run src/features/cameraStage --silent --minWorkers=1 --maxWorkers=1`：51 文件、304 项通过、0 失败；之后新增钉点失败测试并精确复验 `cameraMotionDraft.test.ts` 与 `CreativeIntentControls.test.tsx` 共 11 项通过，cameraStage 有效证据为 305 项通过。
- `npx vitest run src/features/videoEdit/application --silent --minWorkers=1 --maxWorkers=1`：81 文件、647 项通过、3 失败、1 既有基准跳过。失败为并行 `videoEditExplanation.test.ts` 两项 `sameExplanationBinding is not a function` 和 `videoEditBeatAnalysis.test.ts` 一项 `snap_to_beat` 读回为空字符串。讲解实现随后补齐，精确复验 13/13 通过；节拍读回仍交 t164/总管理者处理。本单错峰 2/2 通过，不能登记剪辑目录已零失败。
- 本单 23 个 TS/TSX 文件 eslint `--max-warnings 0` 通过；末次机位采集错误呈现、测试和共用文案变动的三个文件再次通过。
- `npx tsc -p tsconfig.electron.json --noEmit` 通过；渲染层当前仅其他任务新增 `videoEditBeatWorkerClient.test.ts:26` 的测试 hook 返回值类型错误（先前的其他并行错误已消失）。
- `check:surface`、`check:icons`、`check:ui-residue`、`check:assistant-capabilities` 通过。
- `check:persistence-compat` 最新通过（41 种格式）；早先并行 `document.video_edit` 与 `subtitle-manifest` 指纹未登记已由其任务补齐，本单未改持久格式，无本单 dev-break 或黄金样本变更。
- `check:colors` 未通过：存量 `src/components/ui/styleTokens.ts` 注释中的 `divide-border-dark/60` 被门禁识别为未定义颜色类（门禁定位 152 行）；本单未修改此文件，交总管理者处理。
- `check:dependency-graph` 未通过：并行 `src/features/application-control/creativeIntentExplanation.ts → capabilities/applicationControlRegistry.ts` 新增动态值回边，未涉及本单机位/错峰依赖，交 t166/总管理者处理。
- 本单显式文件 `git diff --check -- <本单文件清单>` 通过。记录的链接、文件路径与命令已核对存在。

## 未验证与交接

没有真实 Electron 手势/光学预览截图、Pi/MCP 模型决策、长时录制性能或跨工作区导出实测，截图由总管理者统一补拍。只检查两类原生机位视口交互、原生播放、t160 候选/保存以及剪辑错峰的共享曲线和正式事务，不声明全部工作区已修好。没有主进程代码改动，不需要因本单重启主进程；本单未接触主仓库开发实例。

共享文件的错峰行、能力列表和 videoEdit 应用接线须与 t164/t166 的修改一起审查，不能整文件覆盖或误删其他任务内容。错峰动作容不下目标片段时整批拒绝，需要缩短源区间或延长目标；这是真实时长约束，没有自动裁断动作。临时机位示范不保存到工程，只有应用后的正式状态关键帧落盘，符合最小版本。
