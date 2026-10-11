# P3 图片宿主录制讲解（t157）

状态：实现已落地，**尚未完整验收，不能按完成提交**。t152 补验通过；图片录制的最终双宿主截图与静态指代/位置候选仍有下述阻塞。只改图片 editor、图片 explanation 接线与图片 Reality 场景；共享索引只追加本单登记。总管理者负责 Git。零付费、不启停开发实例。

## 设计与选型

- 复用 RecordingCollector、AudioWorklet、带时间戳转写 PAL、ExplanationReview 和 ImageEditLayoutDraft，不引入录音、布局或图像处理库；现有浏览器原生采集、react-virtuoso 和 Kiwi 已覆盖工作需要。
- 静态会话只记录单调墙钟，timeline 明确为 null，不伪造剪辑帧。资源使用现有图片文档 CAS 与 creativeIntents 页，作品修改通过原命令总线。
- 音频分批保存、事件分页；截图按明确指向捕获，限制在应用作品区域。截图过程中作品或视口变化则拒绝关联，不能拿新画面冒充旧证据。
- 验证等级 L2（采集、保存与 UI 的跨边界接线）；用户明确要求双宿主及 960 截图和四目录回归，按该范围执行，不扩大全仓。构建只使用正式 Reality 的轻量 bundle。
- 已发现协作依赖：t156 所有的 deixis.ts 当前不支持 timeline=null；已请求静态指代和布局意图桥接，不擅改其文件。

## 设计自查

1. **助手只凭名称和说明能否用对？** 复用正式图片图层引用、讲解会话和布局服务；私密正文/绑定公开注册由 t156 接收，录音同意不能由助手伪造。本单不另建 MCP 工具。
2. **能否 AI 先做、人只确认？** 先转写并关联历史指向，人审阅对象和候选后应用；录制过程已经发生的编辑不重放。
3. **产物能否直接流进其他工作区？** 结果写回同一个图片文档和撤销栈，工具箱与画布图片节点共享，继续使用既有导出与素材入口。

## 文件范围

- `src/features/imageEdit/v3/application/imageEditExplanation.ts`：图片文档拥有的录制、分页保存、转写、历史证据读取与等距/对齐候选接线。
- `src/features/imageEdit/v3/application/imageEditExplanation.test.ts`：墙钟、暂停续录、保存重试、重复转写与同意边界的精确测试。
- `src/features/imageEdit/v3/editor/useImageEditorExplanationV3.ts`：两个图片宿主真实预览的图层命中、坐标还原、作品区域截图与失焦/卸载清理。
- `src/features/imageEdit/v3/editor/useImageEditorExplanationV3.test.tsx`：React 捕获截断下仍采集指向，排除作品外/敏感区/未呈现帧，卸载移除监听。
- `src/features/imageEdit/v3/editor/ImageEditorExplanationControlsV3.tsx`：录制同意、暂停结束、上传同意、分页词稿、共用审阅和候选入口。
- `src/features/imageEdit/v3/editor/ImageEditorCommandBarV3.tsx`：full / canvas-edit 命令栏挂载讲解入口。
- `src/features/imageEdit/v3/editor/ImageEditorPreviewV3.tsx`：挂载真实作品预览采集 hook。
- `scripts/lib/uiInspectionSceneImageEditExplanation.cjs`：本地合成音流、免费转写夹具和双宿主录制到撤销的正式场景。
- `scripts/lib/uiInspectionSceneImageEditLayoutDraft.cjs`：复用原图片夹具与截图链，增加录制模式和独立证据目录。
- `scripts/lib/uiInspectionScenes.cjs`：仅追加一行两个录制场景登记，其他差异属于并行任务。
- 本任务文件、`02-实施拆分.md` 本单状态行及 `P1-image.md` 的 t152 补验结论。

## 验证与遗留

- 两条 tsc 通过：渲染层最终记录 `node_modules/.cache/t157-tsc-final2.log`；Electron 记录 `node_modules/.cache/t157-tsc-electron.log`。早期本单类型/Ui* 参数错误均已修正，不将早期失败算作通过。
- 最新精确测试：讲解 4 项、坐标 2 项通过，`t157-latest-precise.log`；图片编辑器 22 项通过 `t157-host-unit.log`，预览 4 项复验通过 `t157-preview-retry.log`。预览前轮 worker 意外退出，随后单线程复验成功，保留 `t157-preview-unit.log`。
- 改动文件 ESLint 通过，`t157-eslint-latest.log`。check:ui-residue / surface / colors / icons / dependency-graph 通过，日志分别为 `t157-ui-residue.log`、`t157-surface.log`、`t157-colors2.log`、`t157-icons.log`、`t157-dependency.log`（均在 `node_modules/.cache/`）。颜色门禁首轮发现三个文字大小类，改为公共 token 后复验通过。
- 正式截图第一轮轻量构建成功；运行被并行源码较产物晚 5 秒的新鲜度门禁拒绝，未绕过。日志 `t157-reality-r1.log`；锁在 finally 中释放。第二次取得锁前曾发现其他任务占锁，未运行或清除其锁。
- 指定四目录完整回归通过：unit 278 文件 / 1547 项，GPU 11 文件 / 94 项，image-export 1 文件 / 4 项；合计 290 文件 / 1645 项，0 失败、0 跳过。均 `npx vitest run src/features/imageEdit src/features/canvas/imageEditV3 src/features/creativeIntent src/features/videoEdit/application --mode <unit|gpu|image-export> --silent --pool forks --poolOptions.forks.maxForks=1 --poolOptions.forks.minForks=1 --reporter=json --outputFile=node_modules/.cache/t157-<unit|gpu|export>.json`，普通单测约 18 分钟，后台单 worker；未重复全仓测试。
- 第二轮轻量构建成功（205.56 秒），再次被门禁拒绝：main 13:02:58，最新源码 13:04:14（并行 `semanticIntentRecording.ts`）；随后另有 t156 Reflection 写入，已请求稳定窗口。日志 `t157-reality-r2.log`。仍无新截图，不能登记截图通过；锁均立即释放，t155 占锁期间不争用。
- 复用 t155 最新产物的 r3 被拒绝（main 13:06:50，源码 13:09:26）；等待后 r4 轻量构建成功 167.20 秒，但再被拒绝（main 13:11:42，源码 13:13:14）。记录保留于 `t157-reality-r3.log` / `t157-reality-r4.log`，没有使用跳过门禁环境变量。正式场景工具 41 项通过，`t157-scenes-test.log`；场景命名/证据目录隔离后的 ESLint 通过 `t157-scene-eslint.log`。
- r5 轻量构建成功 177.83 秒并通过新鲜度。双录制宿主都在读回时发现没有 pointer down：预览工具在 React root 捕获阶段截断事件，原挂在 surface 的原生监听收不到。修为 ownerDocument 捕获 + 严格 surface containment，不干扰工具路由、不采集其他区域；精确回归 2 项及预览 4 项通过 `t157-pointer-regression.log`。渲染 tsc 发现新测试 beforeEach 返回值类型后已修并通过 `t157-tsc-pointer-final.log`；hook 与测试 ESLint、ui-residue 通过（`t157-pointer-eslint*.log` / `t157-residue-pointer.log`）。新录制复验 r6 进行中。

### t152 补验：39 张正式截图逐张目视通过

命令：`npm run test:reality -- --suite ui --only image-edit-layout-draft-panel,image-edit-layout-draft-node-panel --size 960x640 --out .reality/t157-panel-960`。1440 工具箱在 r5 的混合轮通过；r5 整轮因录制场景失败退出 1，不能冒称整轮成功。960 独立轮退出 0，两个场景均通过。每轮独占截图锁、结束即释放；未启停 electron:dev。

三组分别是 `.reality/t157-recording-r5/1440x900-image-edit-layout-draft-panel-*`、`.reality/t157-panel-960/960x640-image-edit-layout-draft-panel-*` 和同目录的 `960x640-image-edit-layout-draft-node-panel-*`。每组 01–12 及末帧都已调用 view_image 检查；末帧与 12 的重复画面还核对了文件一致性。960 是窗口 DIP 尺寸，由正式工具断言；默认应用缩放下 CSS viewport=1068，不把截图物理像素尺寸当 DIP。

| 序列 | 三组逐张结论 |
|---|---|
| 01 | 不足三层条件提示简短，动作禁用。 |
| 02 | 粗摆、镜像、旋转、锁层可辨。 |
| 03 | 边缘对齐候选，单选行同宽，应用为主动作。 |
| 04 | 等距候选和原稿残影可区分，无横向溢出。 |
| 05 | 键盘焦点环与悬停/选中状态可区分。 |
| 06 | 主图钉点和单行解钉项可辨。 |
| 07 | 原稿位置 1% 明确回显。 |
| 08 | 应用后姿态正确，普通可撤销提示，防重复应用。 |
| 09 | 撤销恢复粗摆，原服务读回断言通过。 |
| 10 | 重做恢复候选，读回断言通过。 |
| 11 | 保存重开后候选与钉点可读。 |
| 12 / 末帧 | 蒙版只显示一个错误块及恢复建议；窄窗口面板完整可见。 |

r5 两录制宿主各 5 步和失败帧也已逐张目视（12 张）：同意范围、开始、指向、连续指向、结束面板均可见；因为没有存入指向，不能把这些图算作完成录制全链路的证据。

### 录制最终验收状态（13:31）

- r6 正式画布图片宿主十步及末帧共 11 张已逐张目视。脚本完成开始、真实指向、结束、夹具转写、点词、等距候选、一步应用与一步撤销；读回 `mode=static`、1 条 down 命中、1 张历史画面、1 次夹具 ASR、0 付费，音轨结束。源证据 `node_modules/.cache/t157-explanation-canvas/evidence.json`，截图 `.reality/t157-recording-r6/1440x900-image-edit-explanation-node-step-01.png` 至 `step-10.png` 和末帧。
- **脚本通过不等于视觉验收通过**：07 历史画面带入右侧面板。根因是 CSS rect 直接交给以窗口 DIP 为单位的 capturePage，在默认 90% UI 缩放下范围偏移；图片 hook 已通过正式 `window.getContentSize()` 换算 DIP，同时换算指向标记并拒绝截图期间的尺寸变化。新增 90% 缩放回归通过，场景增加 2:1 作品比例及标记偏差断言。最新 3 项 hook 测试通过 `t157-zoom-regression.log`，hook/测试 ESLint 通过 `t157-zoom-eslint.log`，场景 ESLint 通过 `t157-scene-zoom-eslint.log`。该修复尚未完成新产物截图。
- 07 同时明确展示共享 ExplanationReview 的静态指代拒绝，不能将手动选中集的等距候选视为“这/那”绑定通路已完成。08 等距候选、09 应用、10 撤销画面符合原文档读回断言；布局求解与应用复用原服务。
- r6 在进入工具箱宿主前又因源码更新被拒绝（main 13:24:35，`imageEditLayoutDraft.ts` 13:27:10），整轮退出 1，没有完整最终 index/evidence。录制工具箱修复后尚未复验。
- 最新 `npx tsc -p tsconfig.json --noEmit` 退出 2：**他任务 `src/features/application-control/creativeIntentReflection.ts:49` TS1005**，`const result = unrestrictedCollectionAvailability(...) return result` 中间缺语句分隔。已请求总管理者通知 t156，未越权修改。日志 `t157-tsc-zoom.log`。因此不能声称交付时全部检查 0 失败；此前两套 tsc 和四目录回归的通过证据只对应当时版本。
- 沿裁切根因检查同一 PAL 调用方：`features/navigation/application/surfaceObservation.ts` 与 `features/canvas/application/canvasProjectCover.ts` 也直接提供 DOM 坐标，存在同类缩放风险，属于他任务文件，未改且未真实验证；交总管理者决定是否在共享入口统一修正，届时应移除图片侧重复换算。剪辑讲解使用已呈现像素保留接口，未发现本单这个 native rect 换算路径。
- 后续需先修复共享语法并暂停运行源码写入，再持截图锁运行 `npm run test:reality -- --build --suite ui --only image-edit-explanation,image-edit-explanation-node --size 1440x900 --out .reality/t157-recording-accepted`，逐张检查历史图没有旁侧 UI、指向标记准确，并补最新渲染 tsc。t156 的静态 deixis/位置候选完成后还要增加“把这个放到那边”证据与实际候选应用，不能只凭等距场景结项。

### 总管理者必须检查的未闭环边界

- 本单属于能力增量，不能仅按 UI 覆盖登记。公共 Reflection / Mutation / Collection 为 t156 所有；本单没有复制 MCP 工具或越权修改其文件。录音同意属于人工动作，词稿/绑定/候选仍需统一公共注册与授权验证。
- `deixis.ts` / `alignment.ts` 目前过滤 timeline=null，静态词稿的对象/区域确认未通；不能把历史图片回显或等距关键词入口当作静态指代解析完成。已请求 t156 补静态契约。
- 当前只把录制时明确选中的至少三个图层送给既有等距/对齐算法；“把这个放到那边”的目标位置候选尚无允许本单调用的正式桥接，未直接改图层冒充候选。
- 当前持久化在暂停、结束与转写页完成时确认；录制中的定期会话 head 持久化、进程崩溃恢复、编辑 command/undo/delta 全事实记录没有在本单闭环。元数据走原文档命令，仍会进入历史；最终布局应用必须单步撤销实测。
- 临时音频关闭图片后释放，词稿/指向仍保存；删除讲解、删除全部证据与隐私清理的公共操作需由 t156 核对正式注册链，本单不声明已验收。
- 未修改 core、main、videoEdit 或 shared recording 采集层，故无新增主进程代码或剪辑行为分支。未手改 SDK、未执行 Git 写操作、未启停 electron:dev；正式 bundle 的自动生成产物由总管理者核对归属。

### t159 审阅面板重做

2026-10-11。代码按总管理者给定设计稿实现，由总管理者审查与 Git 提交。本任务没有执行 Git 写操作，没有修改 packages/ai-sdk、t158 所有权文件，没有启动或重启 electron:dev，没有真实付费调用。

**实现及覆盖分级**

- 图片 full/canvas-edit 与剪辑共用 360px 浮层，标题/内容/操作三段、最大 80vh、内部滚动。录制自动收起，命令带显示危险色圆点、计时及暂停/继续/结束图标；空闲只显示开始录制和首次隐私元信息，首次开始事实仅以本机布尔呈现偏好保存，未保存私密内容。
- 按自然段排版词稿，指代词 2px 下划线/3px 偏移，已确认强调色，待确认琥珀色和小圆点；点词展开一处历史图、MapPin 与对象名。原因只在该词证据中映射一句，不显示内部编号、坐标、原因列表或分页。没有历史画面时显示对象名与缺图一句；异步换词立即隐藏旧图，迟到结果不覆盖新证据。
- 单选最多两个候选加“其他…”，其他与重新点选进入真实作品画面，消费 pointerdown，不执行编辑或寻找不存在的历史帧。否定绑定显示保护锁与“不改动”摘要；还有 N 处待确认可跳词，已确认摘要最多五行并展开余项。超过 2000 词用既有 react-virtuoso 按段虚拟化，存储页只是分批载入，不设产品数量上限。
- 转写仅显示进度/取消，失败复用 UiError 一句标题与重试，重试执行原失败动作；音频上传仍需原外发同意。本机原音关闭已转写审阅后释放；删除复用各宿主领域入口。
- 静态 timeline=null 不再被剪辑呈现要求过滤：词级精度仍来自 ASR DTO、实际墙钟和音频不确定度，跨 gap 与粗时间需确认；“把这个放到那边”生成对象/目标位置差异计划，“这几个等距”按当时选中集合进入唯一布局服务，粗时间需确认完整集合。菜单/时间线不作为显示候选；剪辑原有歧义保护保留。
- 图片截图延续 t157 的 CSS→窗口 DIP 换算，新增浮层/弹窗遮挡拒绝与捕获后复核；剪辑沿已有已呈现作品像素入口，只选该词对应的指针帧。
- UI 骨架/首次提示属于呈现层；绑定、点选、取消与删除复用原领域服务，属原能力入口改造，没有另写 MCP 工具。公共 C2 注册/权限与通用撤销由 t158/总管理者审查，本任务不把内部 UI 校正当作公共能力已验收。

**选型与设计自查**

- 复用 UiTextToken、UiOptionButton、UiError、PanelTrigger 和已安装的 react-virtuoso；比较后不沿用逐词 chip/分页，不自写虚拟列表或另一套布局求解器。图片整理复用 ImageEditLayoutDraft，手动校正复用现有图层/片段命中几何，没有新增依赖。
- 助手只凭名称和说明能否用对？对象引用和目标位置沿原私密讲解及实体语义，内部审阅已经有确定结果；公共 C2 正文写入、移动候选桥接尚未完整，不能宣称助手端闭环。
- 能否 AI 先做、人只确认？确定的词级静态指向先解析，重叠/粗时间/缺指向才就地确认；已确认集合交原算法整理，否定对象保持保护。真实模型质量、ASR 质量没有付费验收。
- 产物能否直接流进其他工作区？布局沿原图片文档与撤销/导出链，可作为既有其他宿主素材；讲解音频与私密证据不自动外发。移动差异计划尚未接入正式候选，不能将摘要当实际产物。

**本任务实际文件范围（必要扩展已说明）**

- src/core/creativeIntent/alignment.ts：静态墙钟候选、菜单忽略及缺口保护。
- src/core/creativeIntent/deixis.ts：静态/集合指代和显式点选校正。
- src/core/creativeIntent/deixis.test.ts：静态移动、集合、人工校正回归。
- src/core/creativeIntent/recordingAlignment.ts：合法静态词时间精度，保持 null 时间线。
- src/core/creativeIntent/recording.test.ts：静态 ASR 与 gap 精度回归。
- src/features/creativeIntent/index.ts：共享面板/呈现 helper 的正式公开导出。
- src/features/creativeIntent/ui/ExplanationReview.tsx：自然词稿与单处就地证据。
- src/features/creativeIntent/ui/ExplanationReview.test.tsx：绑定、缺图与过期结果回归。
- src/features/creativeIntent/ui/ExplanationPanel.tsx（新增）：双宿主共用三段骨架及状态。
- src/features/creativeIntent/ui/ExplanationPanel.test.tsx（新增）：摘要折叠、确认跳词、虚拟化、首用提示、分批竞态。
- src/features/creativeIntent/ui/explanationPresentation.ts（新增）：用户文案映射、分批词稿与首次呈现偏好。
- src/features/videoEdit/panels/VideoEditExplanationControls.tsx：命令带录制与共享浮层接线。
- src/features/videoEdit/panels/VideoEditExplanationControls.test.tsx：清私密旧稿、计时与失败重试。
- src/features/videoEdit/VideoEditPreview.tsx：移除旧审阅侧栏占位，保留节目区域。
- src/features/videoEdit/application/videoEditExplanation.ts（必要扩展）：精确词证据、画面点选与绑定校验。
- src/features/videoEdit/application/videoEditExplanation.test.ts（必要扩展）：粗时间校正、呈现拒绝与取消回归。
- src/features/imageEdit/v3/editor/ImageEditorExplanationControlsV3.tsx：共享面板与静态布局接线。
- src/features/imageEdit/v3/editor/useImageEditorExplanationV3.ts：点选路由与截图遮挡拒绝。
- src/features/imageEdit/v3/editor/useImageEditorExplanationV3.test.tsx：DIP、遮挡和点选路由回归。
- src/features/imageEdit/v3/application/imageEditExplanation.ts（必要扩展）：静态计划读回、绑定/集合校验与录音释放。
- src/features/imageEdit/v3/application/imageEditExplanation.test.ts（必要扩展）：移动计划、粗集合和手动确认回归。
- scripts/lib/uiInspectionSceneImageEditExplanation.cjs：新面板真实宿主脚本及纯作品图断言。
- scripts/lib/uiInspectionSceneVideoEditExplanation.cjs：新词证据/粗时间/保护/无内部文案场景。
- 本文件、02-实施拆分.md 本单状态行、docs/rules/assistant-status.md 本单索引。

**检查与证据**

验证为 testing.md L2（共享 core、两直接宿主、异步读写/取消）。按用户指定目录分批单 worker 静音回归，耗时流程后台运行；没有全仓测试或完整构建。

- core/creativeIntent：13 文件、126 项通过，node_modules/.cache/t159-core-final.log。
- features/creativeIntent：7 文件、22 项通过，t159-creative-final.log；失败态后最新面板/词稿 10 项复验通过，t159-retry-final.log（该轮整轮有下述测试标签失败，不能把整轮记为通过）。
- imageEdit/v3/editor：39 文件、166 项通过，t159-image-editor-tests.log；此后 controls 仅补失败标题/重试接线，ESLint 通过；真实双宿主仍待截图。
- imageEditExplanation.test.ts：7 项通过，t159-image-application-final.log。
- videoEdit unit：首次 177 文件，173 通过、两文件失败、两个基准文件跳过；失败来自运行中公开导出变化。两失败文件和讲解服务稳定源码复验 3 文件、47 项通过，t159-video-final.log。随后重试接线新增测试，预览 32 项/共享审阅 10 项通过，controls 一项因 UiError 默认英文重试标签失败；显式按设计稿设中文“重试”后 controls 4 项通过，t159-retry-control-fixed.log。不隐瞒首轮与中间轮失败。
- videoEdit GPU：11 文件、57 项通过、4 项既有基准/不支持分支跳过，0 失败，t159-video-gpu.log；跳过项不作为已验收。
- 两套 tsc 在 t159-tsc-renderer-delivery.log / t159-tsc-electron-delivery.log 均退出 0。重试接线后 renderer 曾退出 2，t159-tsc-renderer-final-review.log：并行 codeParamAdapter.test.ts 缺 description/number.unit 及 vector.unit=normalized 类型不符，videoEditCodeParameters.test.ts 的效果参数、执行器参数/结果类型不符，均非本单文件；未越权修改。随后并行修复已落入工作区，最终完整 renderer 检查 t159-tsc-renderer-handoff.log 退出 0，本单文件未见类型错误。
- 全部本单 TS/TSX/CJS ESLint 通过，t159-eslint-delivery.log；重试接线四文件 t159-retry-eslint.log 通过，最终标签 t159-label-eslint.log 通过。
- check:surface / colors / icons / ui-residue / dependency-graph 均通过，t159-check-<名称>-delivery.log。dependency-graph 初轮跨 feature 私有导入失败，已改正式 index 导出后复验通过。
- check:assistant-capabilities 通过，t159-check-assistant-capabilities-delivery.log（结构检查、覆盖13项、通用不变量31文件206项）；本单未动正式能力声明。
- 正式场景工具 45 项通过，t159-scenes-tests.log。git diff --check 只读核对本单文件，无空白错误；未执行任何 Git 写动作。
- Reality 只尝试一轮：node_modules/.cache/t159-reality.log，退出1，产物13:24:35、最新源码13:52:25，被新鲜度门禁拒绝。没有绕过门禁、没有重新构建或重试；node_modules/.cache/ui-inspection.lock 已在 finally 释放。**截图待总管理者补拍**，不能将旧两张基线或 jsdom 当本次视觉验收。

**需要总管理者注意的未闭环边界**

- 静态对象/位置差异计划已产生，但 imageEditLayoutDraft 只提供整理/钉点/应用，没有消费任意位置差异的候选接口，且为 t158 所有。本单保留移动摘要与禁用“生成候选”的一句 tooltip，未直接改图层冒充候选。剪辑也缺正式移动计划转候选的 UI 桥接，主按钮保持禁用；图片等距/对齐有现成路径。请先补正式桥接再宣称设计稿的全部可执行状态完成。
- 图片删除沿 document.set-creative-intents，当前作品会移除讲解并释放原音，但已有文档撤销历史仍可能保留词稿/历史图引用；不能宣称与剪辑 purge 一样彻底不可恢复。需要在原历史服务补单会话隐私擦除，而非清空全部作品历史。
- 新图裁切/亮图标记、360px/80vh 实际呈现与长词稿性能尚无本轮正式截图/规模测量。对照旧截图已目视确认其问题，未声称新界面视觉验收完成。采集同源排查覆盖图片工具箱/画布共用 hook 和剪辑已呈现像素路径；surfaceObservation/canvasProjectCover 的其他 native CSS 坐标风险沿 t157 记录，未越权扩修。
- 目录回归是其运行时源码的证据；随后并行新增 cameraAdapter/codeParamAdapter/maskPathAdapter/propertyAdapter 及代码参数测试不属于本单，不能外推为那些新增文件已验证。总管理者需串行集成审查新增适配器与移动候选桥接；上述类型阻塞在最终 renderer 检查已消失。
- 未改 main/preload，不需因本单重启主进程；遵守授权，没有启动/重启开发实例。没有公共工具新增、SDK 改动、真实 ASR 或意图模型调用。

**t159 交回前最后定向复验（14:35）**：关闭某待确认词证据后，再点击唯一待确认摘要仍能重新展开，面板/词稿 2 文件10项通过，t159-focus-final.log；对应 ESLint t159-focus-eslint.log 退出0。剪辑失败重试按当前 recoverable 状态恢复 ASR 请求，controls 最新5项通过，t159-asr-retry-final.log；对应 ESLint t159-asr-retry-eslint.log 退出0。最后 renderer tsc（含最终 focus/重试源码）t159-tsc-renderer-handoff.log 退出0；Electron tsc 的有效通过证据仍为 t159-tsc-electron-delivery.log，此后未修改 core/main。最终截图锁不存在；未重新尝试 Reality。

## t162 验收修复

2026-10-11：沿 t159 设计稿修复；最终正式 Reality 三个场景全部通过、59 张截图逐张目视完成，待总管理者审查。Git 由总管理者负责，本单未执行任何 Git 写操作。前文 t159 的未完成边界是当时记录，移动候选与本轮视觉验收以本节为准。

**实现与选型**

1. 同名对象由宿主生成展示名：剪辑追加 V 轨道号，同轨同名再追加片段顺序；图片优先用唯一组名，否则用上层、下层或层顺序。稳定引用不变。共享审阅选项悬停/聚焦使用主题强调色 Canvas 2D 轮廓，描边宽度为 2 CSS px，随缩略图及 DPR 变化重绘。
2. 共享面板读取 PanelTrigger 的实际可用高度，标题和底部操作行不收缩，中间词稿单独滚动；保留设计稿 360px / 80vh。
3. 双宿主已有录制状态自动收起逻辑。旧截图脚本在收起动画期间再次点击讲解触发器，把面板重新展开；本轮改为等待面板隐藏。命令带继续使用正式计时、暂停、结束入口。
4. 绑定提交按指代维护状态，只有正在提交的那处禁用；第二处可先于第一处确认。没有人为的起点/终点确认顺序。
5. 移动计划先校验保护对象、基线和位置，再转正式候选。剪辑按段生成 MotionDraft，复用原有样本分页、优化、A/B、应用和撤销；同帧指向只生成该帧位置，不凭墙钟猜动画时长。图片直接生成既有布局候选资源，复用祖先仿射换算、预览、保存重开、应用和一次撤销；只平移，保留镜像、旋转、剪切与祖先变换。生成后打开原超级关键帧/随手摆面板，不建新界面。移动候选不显示排列专用的保真与钉点控件，领域层同样拒绝把移动候选重算为排列。
6. 正式 src / electron 路径没有“本地测试音流”。原文字仅来自 Reality ASR 替身；非目标音频块改为空转写，防止夹具占位文字成为无动作段落。正式 ASR、录音和付费调用没有新增测试注入。

复用现有 react-virtuoso、PanelTrigger / Ui*、MotionDraft / LayoutCandidate 与文档撤销链。轮廓只需浏览器 Canvas 2D 的四角描边；确认目标的移动只需仿射平移，不新增图形库、求解器或平行候选实现。现有布局整理仍使用原 Worker 求解器。`ImageEditorLayoutControlsV3.tsx` 和 `imageEditLayoutGeometry.ts` 是必要范围扩展，分别承担既有候选面板自动打开及单对象移动的几何采集；原排列测量默认要求保持不变。

**设计自查**

- 助手只凭名称和说明能否用对？计划只表达对象、位置与保护对象，正式候选沿既有通用实体读回/应用能力。此轮补的是宿主内部生成桥接，没有新增专用 Agent 工具，也不声明 C2 私密正文通用写入已闭环。
- 能否 AI 先做、人只确认？词时证据先推断对象/位置，人独立确认歧义后本地生成候选，作品只在“应用”时改变。
- 产物能否直接流进其他工作区？应用结果仍是原剪辑/图片文档的片段关键帧或图层位置，沿既有素材、保存、导出和撤销链流转；原音和私密证据不自动外发。

**验证与截图**

按 testing.md L2：共享 core、两个直接宿主、异步候选持久化与撤销；目录回归按用户明确验收范围单 worker、分目录静音运行。正式 Reality 为本单明确授权的真实布局/合成验收，没有启动或重启 electron:dev。耗时验证后台运行，没有全量测试；已通过后仅对后续修改的相关精确测试复验。

- core/creativeIntent：16 文件、139 项通过（t162-core.log）。
- features/creativeIntent：7 文件、23 项通过（t162-creative.log）；最终面板/词证据 2 文件13 项通过（t162-summary-regression.log）。
- videoEdit/application：77 文件、633 项通过，1 个既有基准文件/用例跳过（t162-video-application.log）；讲解最新13 项通过（t162-history-resume-final.log），移动草稿最新17 项通过（t162-motion-order-regression.log，含正向、反向帧顺序和同帧应用）。
- videoEdit/panels：33 文件、199 项通过（t162-video-panels.log）；最终讲解接线7 项通过（t162-delete-lifecycle-fixed.log，含私密版本刷新与异步删除期间不再读旧讲解）。
- imageEdit/v3/application：26 文件、140 项通过、1 项既有测试跳过（t162-image-application.log）；移动/同名对象 2 文件17 项通过，混合移动/排列接线讲解8 项通过（t162-image-regression.log、t162-image-generate-final.log）；最终删除资源排序回归讲解9 项通过（t162-remove-fixed.log）。同源反思资源写入的公共实体精确测试1 项通过（t162-image-intent-reflection.log）。
- imageEdit/v3/editor：39 文件、166 项通过（t162-image-editor.log）；最终共用采集 hook 6 项通过（t162-canvas-dialog.log）。上述六目录均为 0 失败，跳过项没有计作验收通过。
- `npx tsc -p tsconfig.json --noEmit` 退出0（最终 t162-final-tsc-renderer.log）；`npx tsc -p tsconfig.electron.json --noEmit` 退出0（t162-tsc-electron.log，此后 core 未修改）。
- 指定六门禁 surface、colors、icons、ui-residue、dependency-graph、persistence-compat 均退出0（t162-check-results.log 及各门禁日志）。
- 初轮精确 UI 测试有一项夹具按钮名写成“画面中心”，改为真实标签“中央”后 4 项通过（t162-confirm-regression.log）。初轮 ESLint 报截图脚本的 close 未使用，删除多余 helper 后 ESLint 复验通过；没有隐瞒中间失败。最终改动文件 ESLint 日志为 t162-eslint.log（初轮）、t162-eslint-fix.log、t162-eslint-final-additions.log、t162-eslint-runtime-final.log。
- Reality 第一轮在原生解码构建阶段缺少 MSVC 的 stdio.h 包含路径而失败（t162-reality.log）；该轮未启动截图实例，锁已释放。后续只在临时命令加载本机 VS 编译环境，原生构建成功；没有修改系统配置或构建脚本。最终正式构建前后 SDK src 全文件 SHA256 相同（t162-sdk-source-before.txt / final.txt），未改其源码，也没有覆盖工作区原有 SDK 改动。

以上日志均位于 node_modules/.cache。最终全部改动 TS/TSX/CJS ESLint 退出0（t162-eslint-handoff.log），0 errors、1 warning：ExplanationPanel 的 useCallback 捕获 review.onPick，exhaustive-deps 建议加入整个 review；依赖已列出实际使用的 onPick 和 cache，精确手动确认/缓存回归通过，但该警告仍保留并交审查，不能称为零警告。后续精确复验还有 t162-summary-eslint.log、t162-motion-order-eslint.log、t162-delete-lifecycle-eslint.log，截图脚本见 t162-final-scene-eslint.log。surface / dependency-graph 在同源修复后另复验通过（t162-check-surface-real-fix.log、t162-check-dependency-real-fix.log）。助手结构检查通过（t162-assistant-structure.log）；未改公共能力声明，没有扩大跑无关能力全套回归。

**同源排查与必要扩展**

- 检查两宿主共享审阅、人工绑定、私密状态刷新、录制/暂停/继续、生成/应用/撤销/删除。剪辑私密绑定只推进 owner.version，不能以 document.revision 刷新；手动点选前后使段落缓存失效。删除先关闭并立即卸载审阅子树，避免 PanelTrigger 关闭动画仍读已删除的私密页，已用异步删除回归和最终截图确认。
- 历史缩略图的轮廓必须对应录制当时画面，不能画当前姿态。剪辑结束录制冻结作品状态，按页读回后续操作的 before 姿态重建对应历史图；同一会话重开沿用冻结状态。若操作发生于其他时间帧而无法证明该图的姿态，则不画猜测轮廓。未验证进程重启后的历史姿态重建。
- 图片节点宿主共用采集 hook 将包含编辑器自身的弹窗误判为外部遮挡；现在只忽略包含作品表面的宿主容器，真正覆盖作品的其他浮层仍拒绝采集。工具箱与节点宿主共用测试和正式场景均覆盖。
- 图片讲解删除过滤 resources 后没有按目录契约排序，真实删除失败；沿共享私密资源写入路径检查，反思提交 imageEditCreativeIntentReflection 同样补一行排序，其他相关资源目录写入已排序。没有写兼容或吞错分支；remove 失败沿现有日志通道记录并继续抛出。imageEditCreativeIntentReflection.ts 是本次必要同源范围扩展。
- 移动桥保留讲解起止帧的实际顺序，包括反向时间帧；不会用 min/max 调换起点和终点。单个既有 MotionDraft 编辑器只编辑一个对象，外层逐段生成多个正式草稿，不设置讲解段数或草稿总数上限。目标相互冲突或触及保护对象时拒绝猜测执行。

**正式 Reality 与中间失败**

- 最终命令：`npm run test:reality -- --suite ui --build --only explanation --size 1440x900 --out .reality/t162-explanation-r8`。t162-reality-r8.log 退出0；真实 Electron 剪辑、画布图片文档节点、工具箱图片编辑三场景 passed=true，浏览器错误和应用日志错误各0。最新构建后源码未再改动；末尾只补授权记录与本单台账行。
- 最终证据：[59 张截图索引](../../../../.reality/t162-explanation-r8/index.md)；[结构化证据](../../../../.reality/t162-explanation-r8/evidence.json)。图片节点69条、工具箱37条 warning 为既有组变换 CPU 后备/导出 CPU 重试，以及源预热/图层缩略图并发额度回退；没有声称 GPU 全路径验收通过，也未扩修无关渲染链。剪辑0条 warning。
- 临时子进程在 Windows DISPLAY1 副屏内使用 HENJI_DEV_DISPLAY_POINT=2561,1；已查本机 DISPLAY1 右侧非主屏、DISPLAY2 主屏，未持久修改配置、未关闭用户程序。每轮截图锁在子进程退出后立即释放，最终 .reality/ui-lock 不存在。
- R2 暴露终点先确认不可用、节点宿主历史图被容器弹窗误挡及删除资源目录未排序；R3 暴露继续录制后历史画面清空，并因运行中修改源码被新鲜度门禁拒绝，未把该轮记作通过。R4 暴露私密版本/段落缓存陈旧；R5 功能链通过到删除，但脚本“删除”定位匹配时间线和确认弹窗两处，改为限定确认弹窗。R6 节点夹具 ASR 时间戳超出实际音块，按实际采样时长只在覆盖指向的完整音块生成词时间，非目标音块返回空词稿，没有钳制/伪造正式时间戳。R7 三场景通过，但逐张目视发现剪辑删除后错误缺页提示；随后补关闭动画期间立即卸载审阅，R8 重拍全部通过且该提示消失。
- 精确单测中间也有历史测试误把未人工确认的终点当已确认、资源目录排序回归先失败、删除仅 setOpen(false) 仍因关闭动画读取旧页而失败；各自修正契约/实现后定向复验通过。最终测试通过证据列于上方，不隐藏中间失败。

**六项必修问题逐条验收**

| 问题 | 解决方式与实际目视结论 | 最终截图/证据 |
|---|---|---|
| 1 同名与轮廓 | 选项和摘要均显示示范画面 · V2 / V1；悬停分别指向内外两个四角轮廓，键盘聚焦同样高亮。图片重复名称的组名/层位置规则由精确测试覆盖，本轮图片夹具对象名不同，不能将截图说成图片同名视觉验收。 | [轨道名](../../../../.reality/t162-explanation-r8/1440x900-video-edit-explanation-step-016.png)、[V2 悬停](../../../../.reality/t162-explanation-r8/1440x900-video-edit-explanation-step-017.png)、[V1 悬停](../../../../.reality/t162-explanation-r8/1440x900-video-edit-explanation-step-018.png)、[V1 聚焦](../../../../.reality/t162-explanation-r8/1440x900-video-edit-explanation-step-019.png)、[摘要区分](../../../../.reality/t162-explanation-r8/1440x900-video-edit-explanation-step-022.png) |
| 2 固定操作行 | 剪辑多处展开、保护证据造成滚动时，中间内容可滚动，标题与生成候选行仍完整可见；图片两个宿主底部按钮完整。 | [长内容](../../../../.reality/t162-explanation-r8/1440x900-video-edit-explanation-step-021.png)、[确认后](../../../../.reality/t162-explanation-r8/1440x900-video-edit-explanation-step-022.png)、[节点](../../../../.reality/t162-explanation-r8/1440x900-image-edit-explanation-node-step-07.png)、[工具箱](../../../../.reality/t162-explanation-r8/1440x900-image-edit-explanation-step-07.png) |
| 3 录制收起 | 开始和继续录制后审阅面板自动隐藏；命令带显示红点、计时、暂停和结束，录制不中断原作品操作。 | [剪辑开始](../../../../.reality/t162-explanation-r8/1440x900-video-edit-explanation-step-002.png)、[剪辑继续](../../../../.reality/t162-explanation-r8/1440x900-video-edit-explanation-step-013.png)、[节点开始](../../../../.reality/t162-explanation-r8/1440x900-image-edit-explanation-node-step-02.png)、[工具箱开始](../../../../.reality/t162-explanation-r8/1440x900-image-edit-explanation-step-02.png) |
| 4 独立确认 | 起点仍待确认时先选终点右侧成功；只提交本处禁用，不再给后面的独立指代禁用。源对象/终点本轮无先后依赖，因此不显示“先确认这里”的虚假依赖。 | [终点先确认](../../../../.reality/t162-explanation-r8/1440x900-video-edit-explanation-step-020.png)、[再确认起点](../../../../.reality/t162-explanation-r8/1440x900-video-edit-explanation-step-021.png)；ExplanationReview 的并行提交精确测试 |
| 5 正式移动候选 | 剪辑自动打开原超级关键帧候选，A/B、应用和撤销沿既有链；节点与工具箱自动打开原随手摆“按讲解移动”，实际位置变更并可一次撤销。没有新建候选界面。 | [MotionDraft](../../../../.reality/t162-explanation-r8/1440x900-video-edit-explanation-step-024.png)、[应用/A-B](../../../../.reality/t162-explanation-r8/1440x900-video-edit-explanation-step-025.png)、[撤销](../../../../.reality/t162-explanation-r8/1440x900-video-edit-explanation-step-026.png)、[节点移动候选](../../../../.reality/t162-explanation-r8/1440x900-image-edit-explanation-node-step-12.png)、[节点应用](../../../../.reality/t162-explanation-r8/1440x900-image-edit-explanation-node-step-13.png)、[节点撤销](../../../../.reality/t162-explanation-r8/1440x900-image-edit-explanation-node-step-14.png)、[工具箱候选](../../../../.reality/t162-explanation-r8/1440x900-image-edit-explanation-step-12.png)、[工具箱应用](../../../../.reality/t162-explanation-r8/1440x900-image-edit-explanation-step-13.png)、[工具箱撤销](../../../../.reality/t162-explanation-r8/1440x900-image-edit-explanation-step-14.png) |
| 6 夹具词稿 | 正式 src/electron 搜索“本地测试音流”0匹配；夹具非目标块为空词稿，最终可见自然语句“从这里到那边”“别动它”“这几个等距”“把这个放到那边”。这些是本地 ASR 替身，未声称真实识别质量。 | [剪辑词稿](../../../../.reality/t162-explanation-r8/1440x900-video-edit-explanation-step-015.png)、[节点词稿](../../../../.reality/t162-explanation-r8/1440x900-image-edit-explanation-node-step-06.png)、[工具箱移动词稿](../../../../.reality/t162-explanation-r8/1440x900-image-edit-explanation-step-11.png) |

**逐张目视记录（全部59张，未以脚本通过替代目视）**

以下每个链接均已打开原始 Electron 截图检查。剪辑截图 29 张；两图片宿主各15张。脚本额外记录帧/位置/撤销断言，视觉结论仅说明截图实际能证明的内容。

| 剪辑截图 | 目视结论 |
|---|---|
| [001](../../../../.reality/t162-explanation-r8/1440x900-video-edit-explanation-step-001.png) | 开始录制入口清晰，单一讲解浮层。 |
| [002](../../../../.reality/t162-explanation-r8/1440x900-video-edit-explanation-step-002.png) | 开始后浮层消失，命令带录制状态可见。 |
| [003](../../../../.reality/t162-explanation-r8/1440x900-video-edit-explanation-step-003.png) | 录制时调整节目时间，浮层保持收起。 |
| [004](../../../../.reality/t162-explanation-r8/1440x900-video-edit-explanation-step-004.png) | 录制中节目位置变化，计时与结束仍可见。 |
| [005](../../../../.reality/t162-explanation-r8/1440x900-video-edit-explanation-step-005.png) | 节目画面与时间线继续更新，无审阅遮挡。 |
| [006](../../../../.reality/t162-explanation-r8/1440x900-video-edit-explanation-step-006.png) | 录制中定位对象，命令带正常。 |
| [007](../../../../.reality/t162-explanation-r8/1440x900-video-edit-explanation-step-007.png) | 继续时间线/节目交互，浮层未挡住画面。 |
| [008](../../../../.reality/t162-explanation-r8/1440x900-video-edit-explanation-step-008.png) | 作品交互继续，录制状态可见。 |
| [009](../../../../.reality/t162-explanation-r8/1440x900-video-edit-explanation-step-009.png) | 播放/定位时仍沿原节目画面。 |
| [010](../../../../.reality/t162-explanation-r8/1440x900-video-edit-explanation-step-010.png) | 指向动作后作品仍正常呈现。 |
| [011](../../../../.reality/t162-explanation-r8/1440x900-video-edit-explanation-step-011.png) | 录制时节目时间可读，浮层保持隐藏。 |
| [012](../../../../.reality/t162-explanation-r8/1440x900-video-edit-explanation-step-012.png) | 暂停后由验收脚本主动打开浮层，显示继续与结束。 |
| [013](../../../../.reality/t162-explanation-r8/1440x900-video-edit-explanation-step-013.png) | 继续后浮层再次隐藏，红点/暂停/结束可见。 |
| [014](../../../../.reality/t162-explanation-r8/1440x900-video-edit-explanation-step-014.png) | 结束后显示转写并审阅入口。 |
| [015](../../../../.reality/t162-explanation-r8/1440x900-video-edit-explanation-step-015.png) | 自然词稿与3处待确认，生成按钮禁用有任务语义。 |
| [016](../../../../.reality/t162-explanation-r8/1440x900-video-edit-explanation-step-016.png) | 同名选项显示V2与V1，另有其他入口；底部行可见。 |
| [017](../../../../.reality/t162-explanation-r8/1440x900-video-edit-explanation-step-017.png) | 悬停V2轮廓匹配内层示范画面。 |
| [018](../../../../.reality/t162-explanation-r8/1440x900-video-edit-explanation-step-018.png) | 悬停V1轮廓匹配外层示范画面。 |
| [019](../../../../.reality/t162-explanation-r8/1440x900-video-edit-explanation-step-019.png) | 键盘聚焦V1轮廓仍可见。 |
| [020](../../../../.reality/t162-explanation-r8/1440x900-video-edit-explanation-step-020.png) | 终点右侧先确认，起点仍待确认；本帧缩略图尚在加载，不能据此声称此帧历史图已显示。 |
| [021](../../../../.reality/t162-explanation-r8/1440x900-video-edit-explanation-step-021.png) | 起点确认后保护指代待确认，中间内容滚动而操作行完整。 |
| [022](../../../../.reality/t162-explanation-r8/1440x900-video-edit-explanation-step-022.png) | 移动V1、保护V2摘要明确，生成候选可用。 |
| [023](../../../../.reality/t162-explanation-r8/1440x900-video-edit-explanation-step-023.png) | 重绑后回到同一已确认摘要，无重复禁用。 |
| [024](../../../../.reality/t162-explanation-r8/1440x900-video-edit-explanation-step-024.png) | 自动打开原超级关键帧面板与正式草稿，未新增界面。 |
| [025](../../../../.reality/t162-explanation-r8/1440x900-video-edit-explanation-step-025.png) | 原候选A/B区域及应用后位置关键帧可见。 |
| [026](../../../../.reality/t162-explanation-r8/1440x900-video-edit-explanation-step-026.png) | 撤销后位置回到原值，作品和命令带恢复。 |
| [027](../../../../.reality/t162-explanation-r8/1440x900-video-edit-explanation-step-027.png) | 删除讲解使用原确认弹窗，说明私密记录删除范围。 |
| [028](../../../../.reality/t162-explanation-r8/1440x900-video-edit-explanation-step-028.png) | 删除完成，审阅关闭，没有缺页误报。 |
| [最终](../../../../.reality/t162-explanation-r8/1440x900-video-edit-explanation.png) | 最终删除后宿主仍正常，作品保留。 |

| 节点截图 / 工具箱截图 | 两宿主分别目视结论 |
|---|---|
| [节点01](../../../../.reality/t162-explanation-r8/1440x900-image-edit-explanation-node-step-01.png) / [工具箱01](../../../../.reality/t162-explanation-r8/1440x900-image-edit-explanation-step-01.png) | 原作品与开始录制入口可见，工具箱首次提示符合设计。 |
| [节点02](../../../../.reality/t162-explanation-r8/1440x900-image-edit-explanation-node-step-02.png) / [工具箱02](../../../../.reality/t162-explanation-r8/1440x900-image-edit-explanation-step-02.png) | 录制自动收起，红点、计时、暂停、结束可见。 |
| [节点03](../../../../.reality/t162-explanation-r8/1440x900-image-edit-explanation-node-step-03.png) / [工具箱03](../../../../.reality/t162-explanation-r8/1440x900-image-edit-explanation-step-03.png) | 录制中选择主图，不打开审阅、不挡作品。 |
| [节点04](../../../../.reality/t162-explanation-r8/1440x900-image-edit-explanation-node-step-04.png) / [工具箱04](../../../../.reality/t162-explanation-r8/1440x900-image-edit-explanation-step-04.png) | 录制继续，原图层/作品可交互。 |
| [节点05](../../../../.reality/t162-explanation-r8/1440x900-image-edit-explanation-node-step-05.png) / [工具箱05](../../../../.reality/t162-explanation-r8/1440x900-image-edit-explanation-step-05.png) | 结束显示转写并审阅，标题和底部入口完整。 |
| [节点06](../../../../.reality/t162-explanation-r8/1440x900-image-edit-explanation-node-step-06.png) / [工具箱06](../../../../.reality/t162-explanation-r8/1440x900-image-edit-explanation-step-06.png) | 自然语句这几个等距及3张图片摘要。 |
| [节点07](../../../../.reality/t162-explanation-r8/1440x900-image-edit-explanation-node-step-07.png) / [工具箱07](../../../../.reality/t162-explanation-r8/1440x900-image-edit-explanation-step-07.png) | 点词显示原作品历史图和指向，不包含整窗界面；节点宿主容器不再误挡。 |
| [节点08](../../../../.reality/t162-explanation-r8/1440x900-image-edit-explanation-node-step-08.png) / [工具箱08](../../../../.reality/t162-explanation-r8/1440x900-image-edit-explanation-step-08.png) | 自动打开既有布局方案，等距排列预览保持镜像和旋转。 |
| [节点09](../../../../.reality/t162-explanation-r8/1440x900-image-edit-explanation-node-step-09.png) / [工具箱09](../../../../.reality/t162-explanation-r8/1440x900-image-edit-explanation-step-09.png) | 应用后3个对象等距，锁定对象保持位置；已应用可撤销。 |
| [节点10](../../../../.reality/t162-explanation-r8/1440x900-image-edit-explanation-node-step-10.png) / [工具箱10](../../../../.reality/t162-explanation-r8/1440x900-image-edit-explanation-step-10.png) | 撤销后排列还原原布局。 |
| [节点11](../../../../.reality/t162-explanation-r8/1440x900-image-edit-explanation-node-step-11.png) / [工具箱11](../../../../.reality/t162-explanation-r8/1440x900-image-edit-explanation-step-11.png) | 第二次录制审阅对象与右上目标，生成候选可用。 |
| [节点12](../../../../.reality/t162-explanation-r8/1440x900-image-edit-explanation-node-step-12.png) / [工具箱12](../../../../.reality/t162-explanation-r8/1440x900-image-edit-explanation-step-12.png) | 自动打开按讲解移动候选，主图预览移到记录的右侧边缘。 |
| [节点13](../../../../.reality/t162-explanation-r8/1440x900-image-edit-explanation-node-step-13.png) / [工具箱13](../../../../.reality/t162-explanation-r8/1440x900-image-edit-explanation-step-13.png) | 应用后主图 X=800、Y=125，目标点靠作品右边界，主图部分超出作品范围；没有自动夹紧或擅改目标，锁定/旋转/镜像对象保持。 |
| [节点14](../../../../.reality/t162-explanation-r8/1440x900-image-edit-explanation-node-step-14.png) / [工具箱14](../../../../.reality/t162-explanation-r8/1440x900-image-edit-explanation-step-14.png) | 撤销后主图 X=70、Y=110，原布局还原。 |
| [节点最终](../../../../.reality/t162-explanation-r8/1440x900-image-edit-explanation-node.png) / [工具箱最终](../../../../.reality/t162-explanation-r8/1440x900-image-edit-explanation.png) | 最终作品与图层状态正常，移动撤销已完成。 |

**交回范围与剩余边界**

本单没有改 main/preload，不需主进程重启；未启动/重启开发实例、未付费、未调用真实 ASR/意图模型，没有 Git 写操作。私密正文公共 C2 写入、一般差分执行与单会话历史隐私擦除仍是既有未闭环项，不因本轮候选桥接改成完成；跨进程重开历史轮廓和长词稿规模性能未在本轮验证。图片同名视觉专门场景未重拍，已有双宿主共享规则和精确测试；图片 GPU 全路径也未验收。总管理者应审查必要扩展文件、既有 CPU 回退日志及1条 lint warning，精确暂存本单文件，保留其他工作区改动。

**本单实际改动文件（29个）**

- `src/core/creativeIntent/intentPlan.ts`：统一校验已审阅移动计划与保护、冲突边界。
- `src/features/creativeIntent/ui/ExplanationPanel.tsx`：固定共享面板标题/操作行及手动校正缓存。
- `src/features/creativeIntent/ui/ExplanationPanel.test.tsx`：覆盖固定区域、摘要同名和缓存失效。
- `src/features/creativeIntent/ui/ExplanationReview.tsx`：独立提交指代并绘制悬停/聚焦轮廓。
- `src/features/creativeIntent/ui/ExplanationReview.test.tsx`：覆盖独立确认和主题轮廓交互。
- `src/features/videoEdit/application/videoEditExplanation.ts`：读取历史姿态、区分同名并连接正式移动候选。
- `src/features/videoEdit/application/videoEditExplanation.test.ts`：覆盖独立确认、历史画面及候选生成。
- `src/features/videoEdit/application/videoEditMotionDraft.ts`：将讲解移动转换为既有MotionDraft。
- `src/features/videoEdit/application/videoEditMotionDraft.test.ts`：覆盖正反帧顺序、同帧与候选应用。
- `src/features/videoEdit/panels/VideoEditExplanationControls.tsx`：私密版本刷新、生成和删除生命周期接线。
- `src/features/videoEdit/panels/VideoEditExplanationControls.test.tsx`：覆盖私密刷新及异步删除关闭动画。
- `src/features/videoEdit/panels/VideoEditMotionControls.tsx`：响应既有候选面板打开请求。
- `src/features/imageEdit/v3/application/imageEditExplanation.ts`：图片同名展示、正式候选生成和删除目录排序。
- `src/features/imageEdit/v3/application/imageEditExplanation.test.ts`：覆盖同名、混合计划、移动和删除。
- `src/features/imageEdit/v3/application/imageEditLayoutDraft.ts`：生成移动布局候选并复用资源/应用/撤销。
- `src/features/imageEdit/v3/application/imageEditLayoutDraft.test.ts`：覆盖单对象移动、保护与仿射姿态。
- `src/features/imageEdit/v3/application/imageEditLayoutGeometry.ts`：允许移动草稿采集单对象几何。
- `src/features/imageEdit/v3/application/imageEditCreativeIntentReflection.ts`：修复同源私密资源写入目录排序。
- `src/features/imageEdit/v3/editor/ImageEditorCommandBarV3.tsx`：连接讲解生成后的随手摆面板。
- `src/features/imageEdit/v3/editor/ImageEditorExplanationControlsV3.tsx`：使用正式移动生成与生成结束事件。
- `src/features/imageEdit/v3/editor/ImageEditorLayoutControlsV3.tsx`：打开既有面板并隐藏移动不适用的排列控件。
- `src/features/imageEdit/v3/editor/useImageEditorExplanationV3.ts`：采集时区分容器弹窗和外部遮挡。
- `src/features/imageEdit/v3/editor/useImageEditorExplanationV3.test.tsx`：覆盖图片节点容器内的作品采集。
- `scripts/lib/uiInspectionSceneImageEditExplanation.cjs`：图片双宿主正式移动与应用撤销验收夹具。
- `scripts/lib/uiInspectionSceneVideoEditExplanation.cjs`：剪辑同名轮廓、独立确认及候选全链验收。
- `docs/task/超级关键帧/任务/P3-image-host.md`：记录实现、六问题截图和逐张目视证据。
- `docs/task/超级关键帧/02-实施拆分.md`：仅更新本单t159/t162状态行。
- `docs/rules/assistant-status.md`：仅更新本单助手能力状态行。
- `src/features/creativeIntent/ui/explanationPresentation.ts`：让摘要使用宿主区分后的对象展示名。
