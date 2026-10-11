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
