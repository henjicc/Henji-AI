# t119-A / t119-A2 / t119-A3：A 阶段集成与截图验收

日期：2026-10-09。最新状态：**t119-A3 已修复输入、源图重开、工具路由、Dockview 重建定位、弹窗层级及共享素材误删；真实 Electron 的“图片编辑”匹配全组、A 阶段全部登记场景、深浅色及受影响窄窗口矩阵均通过，253 张截图已逐张打开目视（包含 1 张被复拍替换的旧中间帧及 1 张预算后备诊断帧）。** 总管理者负责审查和 Git 提交；本轮没有 Git 写操作，没有手工修改 SDK、方案 00/01/02 或体检报告，没有启动、停止或重启开发实例，没有付费调用。以下 A/A2 记录保留历史；最新结果见末尾「t119-A3 真实 Electron 续验」。

## 接口请求处理结果

| 请求 | 本轮结果 |
| --- | --- |
| 01：旧全局 Space 与 overlay 键盘入口 | 删除导航 Hook 全局 Space 监听；选区 Enter、标注 Delete/Backspace/Arrow 经 `bindKeyboard` 注册到唯一工具路由；移动 Esc/blur 和编辑器撤销快捷键也归该入口。输入框、IME、外部菜单与临时导航避让保留。路由内文字冒泡保护只隔离外部页面快捷键，不分派第二套工具命令。 |
| 01：异步输入生命周期 | 修复新 pointerdown 错误取消上一笔异步提交；栅格画笔通过 `bindPointerAvailability` 在提交完成前拒绝新笔画，保留既有持久化、撤销与取消服务。 |
| 01：登记失败反馈 | 失败反馈放在完整工作面，用正式 `UiError` 和中英文文案；不挤进工具图标条。已有登记失败精确测试通过；正式 Electron 错误夹具与截图尚未完成。 |
| 02：布局记忆 | 正式编辑器接入应用会话内的工作区布局仓库，按 toolbox/canvas/viewer/mask 隔离，再按宿主 profile 隔离；同一工作区关闭重开保留布局，退出应用释放。使用用户允许的会话方案，不写作品、不另建 localStorage/schema，不新增助手业务操作。 |
| 02：中文/英文 | 补齐面板菜单、显示/关闭、浮动/停靠、默认布局、布局错误、最大化/恢复大小文案；清理被旧手写布局取代的文案。 |
| 02：面板接线 | 修复 Dockview 在 React 订阅建立前已完成布局的可见性状态遗漏，订阅后立即读回真实可见性与停靠位置。隐藏、折叠、浮动、切文档沿正式生命周期。 |
| 01/02/03：中央场景登记 | 在 `createUiInspectionScenes` 登记三个独立工厂；七个目标场景均唯一登记。原 release 场景旧手写拖动/resize 选择器改为 Dockview sash/tab/menu，保留其后既有功能与呈现断言。 |
| 03：遮罩自动保存异步导出 | 画布 `useLocalRedrawMaskAutosave` 改走现有 `exportMaskDocumentToPngAsync` Worker 分块导出；修改/卸载 AbortSignal 取消旧计算，迟到结果不落盘、不转移给节点；移除被替代同步 PNG 导出及公共出口。 |
| 03：剪辑/GPU/目标投影 | 未扩张到后续 06/07/18 的剪辑 effectMasks/smartRegions/engine、GPU RegionSource 消费与显式像素/mask 目标 UI；本轮不声称这些接线已经交付。 |

选型：沿用项目已有 `dockview-react`、DockviewHost、拖放与主题入口，未自研停靠布局算法；沿用 03 已有区域 Worker 和统一 float32 内核，未复制区域算法。布局会话仓库只保存视图偏好，正式注册、命令与领域服务保持唯一入口。没有为素材、图层、选区或历史数量新增上限。

应用能力覆盖分级：布局记忆、面板标签和键盘合流属于视图偏好与交互调整，沿现有编辑命令和实体操作；没有新增专用 MCP/HostCommand 工具，没有改变文档权限或业务实体契约。区域和导出继续沿已有领域端口，未改助手运行时台账。

## 删除清单

- `src/features/imageEdit/v3/editor/ImageEditorFloatingPanelsV3.tsx`：02 已删除，本轮确认无剩余运行引用。
- `src/features/imageEdit/v3/editor/imageEditorPanelLayoutV3.ts`：删除旧手写布局模型。
- `src/features/imageEdit/v3/editor/imageEditorPanelLayoutV3.test.ts`：02 已删除，本轮确认新布局测试替代。
- `src/features/imageEdit/v3/editor/useImageEditorDockResizeV3.ts`：删除旧手写 resize Hook。
- `src/features/imageEdit/v3/editor/useImageEditorHistoryShortcutsV3.ts`：删除被统一键盘路由替代的独立监听。
- `src/features/imageMark/render/tracePenPath.ts`：删除纯 core trace 转发包装；检索没有该包装的直接测试文件，core trace 及标注测试保留。
- `src/features/maskEditor/maskExport.ts` 的同步 `exportMaskDocumentToPng` 及 index 出口：唯一调用方已经接异步 Worker，不保留兼容分支。
- `scripts/ui-residue.allowlist.json`：删除旧 FloatingPanels 的过期宽度登记。
- `scripts/dependency-graph-baseline.json`：正常 `--write` 缩减 maskEditor→imageMark 两条已移除边，跨 feature 非 index 导入由 408 降至 406；没有 `--accept-new` 或新增例外。

## 门禁结果

验证选择 L2：共享工具输入/取消契约、Dockview Shell 与多宿主、区域 Worker 导出直接消费者改变；执行用户指定范围，不跑全量测试、不使用 related、不升级 electron:build。耗时命令用可轮询终端会话继续执行，不阻塞前台等候。

| 检查 | 实际结果 |
| --- | --- |
| `npx tsc -p tsconfig.json --noEmit` | 通过；最后一次包含异步自动保存接线。 |
| `npx tsc -p tsconfig.electron.json --noEmit` | 通过；本轮未随后修改 core 或 Electron 文件，复用有效结果。 |
| 本任务 TS/TSX 及五份改动场景 CJS 精确 ESLint | 通过。CJS 初次被 TS require 规则拒绝，补明正式巡检启动器使用 CommonJS 的文件级说明后通过，没有禁用其他规则。 |
| `check:dependency-graph` / `--write` | 通过并缩减基线：2 个存量静态值 SCC、0 冻结跨层边、406 跨 feature 非 index 导入、首屏 971 模块/0 重模块、11 动态值回边。初始 01/02 报的新环没有通过新增基线放行。 |
| `check:dead-code` | 通过：1 存量未使用文件、0 未使用依赖；2060 导出/类型仅报告。unlisted 包和 unresolved 原生 Worker 路径仍为脚本既有非阻断诊断，未宣称清零。 |
| `check:ui-residue` | 通过，无违规、无未登记、无过期登记。 |
| `check:surface` | 通过。 |
| `check:colors` | 通过。 |
| `check:icons` | 通过。 |
| `check:assistant-capabilities` | 通过：结构、13 项覆盖测试、31 文件/200 项不变量检查均通过；没有新增业务工具。 |
| `check:persistence-compat` | 通过，36 格式。没有新增持久 schema。 |
| `check:ipc-contract` | 通过，347 请求/2 ports/25 events。没有改 main，无需 main-imports。 |
| 三任务列出的精确测试及四个受影响目录 | 定向命令包含 imageEdit、maskEditor、imageMark、canvas/imageEditV3、core selection/regions 及 localRedraw autosave，初次 192 文件：922 通过、7 失败、1 条本机 GPU 性能测试条件跳过。没有隐藏初次失败。 |
| 上述失败文件修复后复验 | 图层变换、栅格画笔、Shell 合计 16 项通过；修复真实路由取消与面板订阅缺陷，补 Dockview DOM 尺寸、ResizeObserver 与 Konva 测试画布，不放宽行为断言。 |
| 根编辑器/Preview/注册与路由/Shell/布局集成复验 | 67 项全部通过，报告 `.reality/t119-A-integration-final.json`。 |
| core interaction/selection + 参数直接消费者补验 | 31 项全部通过，报告 `.reality/t119-A-core-consumers-final.json`；包含 03 指定的 DerivedMediaParamControl 6 项。 |
| 自动保存/遮罩导出/Worker/session 最终精确复验 | 18 项全部通过，报告 `.reality/t119-A-autosave-final.json`；含新增的修改取消及卸载迟到导出不落盘两项。 |
| 场景语法/登记 | 五份 CJS `node --check` 通过；正式中央工厂检查七个目标 id 均唯一。 |
| 正式 Reality | **失败/阻塞**，尚无截图与目视证据，详见下节。 |

相关 Vitest 均传 `--silent`；assistant-capabilities 聚合脚本没有将附加 `--silent` 透传给内部测试，内部日志仍打印，结果为 exit 0。没有重复执行已通过且未失效的目录套件。初次失败七项已在对应文件和集成精准复验中通过，但不将多次重叠测试数量相加冒充独立覆盖。

## 截图与目视验收

按用户要求创建 `.reality/ui-lock` 取得锁后，实际执行：

```powershell
npm run test:reality -- --suite ui --build --only image-edit-tool-lifecycle,image-edit-docking,image-edit-region-hosts,toolbox-image-edit,canvas-multi-layer-document-editor,canvas-gpt-mask-editor --size 1440x900 --theme-preset graphite --out .reality/t119-A
```

正式 `electron:bundle` 安全保护返回 exit 1：

> 检测到当前仓库 electron:dev 正在运行（PID 33112）。构建会改写其正在加载的 out/；请先结束该开发实例，再重新运行。

已请求总管理者协调暂停该实例。本轮没有绕过保护、停止实例、使用旧产物或另开浏览器冒充 Electron。截图尝试结束后已删除本轮取得的空 `.reality/ui-lock`，没有遗留占锁。**截图数量为 0，下面全部待拍，路径为空；没有目视通过结论。** 未跑成功的原 release 及矩阵留在续跑清单，不冒充首条命令已经覆盖。

限制来源：skill [henji-ui-surface](../../../../.codex/skills/henji-ui-surface/SKILL.md) 引用的 [review.md 第 4 节](../../../../.codex/skills/henji-ui-surface/references/review.md) 明确规定“不操作、不静音、不结束用户自己的开发实例”。因此不能为了绕开构建保护自主停止正在运行的实例；用户本任务另明确禁止启动或重启开发环境。交接前用正式构建器相同的 `readElectronDevState` 只读入口复核，仍检测到 PID 33112。

| 场景/截图标签 | 实际截图路径 | 结论 | 修复/待补 |
| --- | --- | --- | --- |
| image-edit-tool-lifecycle：registered-tools、selection-group、temporary-hand、temporary-zoom、navigation-restored | 无 | 构建前阻塞，未目视 | 输入已合流，待正式截图确认图标、选中态与临时恢复。 |
| 同场景：selection-draft、selection-cancelled、options-closed、annotation-group、ime-text-priority、text-cancelled | 无 | 未运行 | 待验证手势取消、工具选项和真实输入法态。 |
| 工具登记失败 | 无 | 正式隔离 fixture 未接，未截图 | 错误工作面及精确测试已接；不能用伪造 DOM 冒充故障截图。 |
| image-edit-docking：toolbox-empty | 无 | 未运行 | 待空态目视。 |
| 同场景：toolbox/canvas 各 default、collapsed、reopened、tabs、floating、restored、resized、panels-hidden | 无 | 未运行 | Dockview 可见性订阅遗漏已修；待 1440×900/960×640 × graphite/paper 四组合逐图检查。 |
| 布局 load/save 失败与恢复 | 无 | 正式隔离 fixture 未接，未截图 | Shell 真实错误恢复精确测试已过；仍需正式 Electron fixture。 |
| image-edit-region-hosts：parameter-empty、parameter-region、parameter-soft-edge、parameter-solve-failed、parameter-recovered、parameter-cancel-reopen、parameter-confirm-reopen | 无 | 未运行 | 区域场景已中央登记；Worker 单次错误替身沿实际边界注入。 |
| toolbox-image-edit / image-editor-v3-release | 无 | 未运行 | release 旧选择器已改 Dockview，保留原功能断言；真实路径尚未验收。 |
| canvas-multi-layer-document-editor | 无 | 未运行 | 必须用实际节点编辑器，不能用工具箱替代。 |
| canvas-gpt-mask-editor | 无 | 未运行 | 参数蒙版主场景待拍。 |
| 像素/mask 编辑目标、画外覆盖、剪辑遮罩对齐 | 无 | 相关后续宿主尚未接线/验收 | 参数蒙版截图不能证明这些宿主已完成。 |

续跑需先由总管理者安全协调开发实例与共享构建，再重新取 `.reality/ui-lock`。仍使用正式 Reality `--build`，将 `image-editor-v3-release` 加入上述 only 清单；停靠矩阵增加 `--size 960x640 --theme-preset paper`，已构建成功且产物未变化的后续矩阵可复用产物。每张实际截图必须逐张打开，检查：条带数≤2、没有卡片套卡片、对齐/padding、标签与折叠/浮动/重新停靠、工具图标/选中态、中英文与深浅主题、空态/错误态、窄窗口。发现问题修完复拍，再填写路径和逐图结论。

## 本轮实际修改文件

下列为在 01–03 已有工作区实现之上本轮新增改动；01–03 原实现文件清单仍见三份原任务记录，本轮未改它们。所有继承任务代码共同纳入上面的指定门禁。

| 文件 | 本轮作用 |
| --- | --- |
| `toolFramework/types.ts` | 增加 overlay 键盘与指针可用性端口。 |
| `toolFramework/useToolInputRouter.ts` | 收口键盘、取消、历史和忙中输入，修复异步提交被下一笔取消。 |
| `toolFramework/useToolInputRouter.test.tsx` | 验证 overlay 键盘命令的焦点、修饰键和 IME 避让。 |
| `toolEntries/legacy.tsx` | 标注 overlay 注册唯一键盘端口。 |
| `editor/ImageEditorPreviewV3.tsx` | 向登记 overlay 传递两个输入端口。 |
| `editor/useImageEditorViewportNavigationGestureV3.ts` | 删除全局 Space 导航监听。 |
| `editor/ImageEditorAnnotationOverlayV3.tsx` | 标注删除/移动键盘命令经统一路由。 |
| `editor/ImageEditorSelectionOverlayV3.tsx` | 选区 Enter 经统一路由，移除全局键盘监听。 |
| `editor/ImageEditorSelectionOverlayV3.test.tsx` | 测试使用明确键盘端口，不引入生产 fallback。 |
| `editor/useImageEditorLayerMoveGestureV3.ts` | 移除独立全局 Esc/blur 监听。 |
| `editor/ImageEditorRasterBrushOverlayV3.tsx` | 注册异步提交期间的输入可用性。 |
| `editor/ImageEditorRasterBrushOverlayV3.test.tsx` | 补真实 Dockview 尺寸环境及布局会话隔离。 |
| `editor/ImageEditorLayerTransformV3.test.tsx` | 补真实面板初始化等待与画布环境，验证作用域内 Esc。 |
| `editor/ImageEditorV3.tsx` | 注入工作区布局会话仓库，工具登记失败显示完整错误工作面。 |
| `editor/ImageEditorToolRailV3.tsx` | 移除狭窄图标条内的登记失败错误块。 |
| `editor/types.ts` | 增加可选布局工作区标识。 |
| `panelFramework/layout.ts` | 实现按工作区/profile 隔离的会话布局仓库。 |
| `panelFramework/layout.test.ts` | 验证关闭重开、工作区隔离和快照独立。 |
| `shell/ImageEditorDockV3.tsx` | 订阅后读回真实可见性和位置，修复空面板。 |
| `src/features/imageMark/standalone/ImageMarkToolV3Host.tsx` | 接工具箱布局工作区。 |
| `src/features/imageMark/viewer/ViewerMarkEditor.tsx` | 接查看器布局工作区。 |
| `src/features/canvas/imageEditV3/CanvasEditToolEditorV3Host.tsx` | 接画布布局工作区。 |
| `src/features/maskEditor/v3/MaskEditorV3Host.tsx` | 接蒙版布局工作区。 |
| `src/features/canvas/nodes/localRedraw/useLocalRedrawMaskAutosave.ts` | 接 Worker 异步导出及修改/卸载取消。 |
| `src/features/canvas/nodes/localRedraw/useLocalRedrawMaskAutosave.test.tsx` | 更新替身并验证两类迟到计算不落盘。 |
| `src/features/maskEditor/maskExport.ts` | 删除被替代同步 PNG 导出。 |
| `src/features/maskEditor/index.ts` | 移除同步 PNG 公共出口。 |
| `src/i18n/locales/zh-CN/ui.json` | 补中文面板与登记失败文案，移除旧布局文案。 |
| `src/i18n/locales/en-US/ui.json` | 补对应英文文案。 |
| `scripts/lib/uiInspectionScenes.cjs` | 登记三个独立场景工厂。 |
| `scripts/lib/uiInspectionSceneCatalogToolbox.cjs` | 原 release 场景改用 Dockview 选择器。 |
| `scripts/lib/uiInspectionSceneImageEditToolLifecycle.cjs` | 说明正式 CommonJS 场景脚本格式。 |
| `scripts/lib/uiInspectionSceneImageEditRegionHosts.cjs` | 说明正式 CommonJS 场景脚本格式。 |
| `scripts/ui-residue.allowlist.json` | 清理过期 FloatingPanels 登记。 |
| `scripts/dependency-graph-baseline.json` | 缩减两条被区域统一内核替代的旧跨 feature 边。 |
| 本文件 | 记录集成、实际门禁、截图阻塞和续验要求。 |

表中未带 `src/` 的路径均相对 `src/features/imageEdit/v3/`；删除文件见上方删除清单。`.reality/` 中 JSON/诊断输出为忽略的测试产物，不应加入提交。运行期间 SDK 与 videoEdit 文档目录有其他任务改动，本轮没有编辑、还原或暂存它们。

## 设计自查

1. **助手只凭名称和说明能否用对？** 本轮沿正式工具登记/编辑命令、选区与蒙版领域端口执行，不新增布局专用助手工具；同一个输入端口决定当前工具和可编辑目标，助手仍可读回文档与既有撤销状态。后续像素/mask 显式目标和剪辑实体说明未在本轮补齐，不宣称未来目标已覆盖。
2. **能否 AI 先做、人只确认？** 原有主体选择、修补与移除继续沿现有服务；本轮使键盘和手势只协调一次，取消及异步导出不把旧结果写回。没有把算法能力改成让用户手动调内部状态。
3. **产物能否直接流进其他工作区？** 正式图片文档与参数 PNG 继续走原资源入库和节点/查看器/工具箱端口；布局只属于会话视图，不污染作品。剪辑区域消费尚待后续集成与真实验收。

## t119-A2 续验（2026-10-09）

### 实际执行与阻塞证据

按本任务明确授权取到 `.reality/ui-lock` 后，执行以下正式入口；`--build` 只运行 `electron:bundle`，对应 testing.md「真实性测试统一入口」的新产物要求，没有升级全量构建或测试。

```powershell
npm run test:reality -- --suite ui --build --only image-edit-tool-lifecycle,image-edit-docking,image-edit-region-hosts,toolbox-image-edit,image-editor-v3-release,canvas-multi-layer-document-editor,canvas-gpt-mask-editor --size 1440x900 --theme-preset graphite --out .reality/t119-A2/graphite-wide
npm run test:reality -- --suite ui --only image-edit-registration-failure --size 1440x900 --theme-preset graphite --out .reality/t119-A2/fixture-probe
```

- 第一轮 `electron:bundle` **成功**，总耗时约 145 秒；新产物生成后正式巡检启动失败。主进程日志两次报告 `window.render_process.gone`，`reason=launch-failed`、`exitCode=49`。随后临时目录清理报 `EPERM`，挂起实例已按本次确知 PID 退出；正式命令最后 exit 1，内部巡检被结束时退出码 4294967295。没有按进程名称结束其他实例。
- 第二轮复用新产物，仅启用 `DEBUG=pw:browser` 收集启动诊断，没有改应用启动器、关闭 sandbox 或降级 GPU 验收。GPU 子进程连续以 `-1073741515` 退出，最终 `GPU process isn't usable. Goodbye.`；同样出现渲染 `launch-failed/49`。只退出本次已知巡检进程，正式命令 exit 1。此数值可能涉及 Windows 子进程/DLL 启动环境，**没有证明具体缺失项，也没有归因成图片编辑业务缺陷**。
- 诊断原日志已复制到 `.reality/t119-A2/initial-launch.log` 与 `.reality/t119-A2/fixture-launch.log`；忽略的本机验收产物不要提交。没有成功进入场景 setup，因此没有截图，没有 DOM/关键路径通过结论，没有目视修复或复拍结果。相同启动阻塞下未机械重复四个主题尺寸组合。
- 原任务的“开发实例阻挡构建”已解除；新的阻塞是上述巡检子进程启动失败。任务仍不能标完成。锁在本轮巡检退出后释放；不启动 `electron:dev`，由总管理者维护开发环境。
- 官方构建入口会运行目录索引生成器、SDK 构建及运行产物生成；本轮未手工编辑 `packages/ai-sdk`。该目录在开始时已有其他任务改动，没有还原、删除或暂存其文件；总管理者审查时应按各任务所有权处理生成结果。

### Fixture 与场景接线

| 场景 | 实际边界与恢复方式 | 状态 |
| --- | --- | --- |
| `image-edit-registration-failure` | 巡检渲染启动时，一次性拦截带 overlay 的 `select-rect` 工具实现登记，使真实 ToolRegistry 抛错；清单不变、不伪造 DOM。命中即还原 Map.set；刷新恢复正式登记。断言错误工作面与工具不可点击。 | 语法/ESLint/中央登记通过；Electron setup 未执行，fixture 行为仍待正式验证。 |
| `image-edit-layout-failure` | 在本次渲染实例拦截会话布局 Map 的 `full` 快照读取，以及只针对 `{ dock, collapsed }` 的 structuredClone 写入；替换图片走正式文件选择/导入，面板变化走正式菜单。所有替身在 finally 还原，并分别点击恢复默认布局验证恢复。 | 语法/ESLint/中央登记通过；load/save 错误、恢复截图尚未执行。 |
| `image-edit-quick-mark-viewer` | 沿生成页上传仓库图片→实际图片查看器→V3 quick 宿主；驱动箭头标注、裁剪预览、关闭保存并回到查看器，不点生成。替代仅存在于旧步骤文件、没有纳入本次正式 Reality 的快速标记续验入口。 | 中央唯一登记通过；箭头、裁剪与返回行为尚未执行。 |

选型沿用既有 Playwright/Electron 正式巡检、文件选择替身、Dockview 与原错误 UI，不引入新库、不自研停靠算法、不加生产调试入口。上述是测试边界注入，不改变图片领域操作、助手能力、文档 schema 或数量约束。

### 最新截图表

下面每项路径为空，表示没有实际截图。上方 t119-A 的旧表是历史阻塞记录；以下表替代其续跑状态。

| 场景/截图标签 | 实际截图路径 | 目视结论 | 修复内容 | 复拍结果 |
| --- | --- | --- | --- | --- |
| `image-edit-tool-lifecycle`：registered-tools、selection-group、temporary-hand、temporary-zoom、navigation-restored、selection-draft、selection-cancelled、options-closed、annotation-group、ime-text-priority、text-cancelled | 无 | Electron 启动失败，未目视 | 本轮没有视觉证据支持的 UI 修复 | 未复拍 |
| `image-edit-docking`：toolbox-empty；toolbox/canvas 各 default、collapsed、reopened、tabs、floating、restored、resized、panels-hidden | 无 | 未进入 setup | 未改停靠实现 | 未复拍；1440×900 / 960×640 × graphite/paper 待跑 |
| `image-edit-region-hosts`：parameter-empty、parameter-region、parameter-soft-edge、parameter-solve-failed、parameter-recovered、parameter-cancel-reopen、parameter-confirm-reopen | 无 | 未进入 setup | 未改区域实现 | 未复拍 |
| `toolbox-image-edit` / `image-editor-v3-release` | 无 | 未进入 setup | 保留原 release 核心路径，未放宽断言 | 未复拍 |
| `canvas-multi-layer-document-editor` | 无 | 实际画布节点宿主未打开 | 未用工具箱替代节点宿主 | 未复拍 |
| `canvas-gpt-mask-editor` | 无 | 蒙版主场景未打开 | 未改蒙版实现 | 未复拍 |
| `image-edit-registration-failure`：registration-failed、registration-recovered | 无 | 定向重试仍在 Electron 启动阶段失败 | 已补正式登记边界 fixture | fixture/复拍待验证 |
| `image-edit-layout-failure`：layout-load-failed、layout-load-recovered、layout-save-failed、layout-save-recovered | 无 | 未运行 | 已补正式会话存取边界 fixture | fixture/复拍待验证 |
| `image-edit-quick-mark-viewer`：viewer、quick-default、quick-arrow、quick-crop、quick-returned-to-viewer | 无 | 未运行 | 已补正式查看器关键路径场景 | fixture/复拍待验证 |

条带数、卡片层级、对齐与 padding、Dockview 标签/折叠/浮动/重新停靠、工具图标与选中态、随工具切换的选项、文案、深浅色、空态/错误态、窄窗口裁切/溢出均**尚无本轮目视结论**；静态门禁不替代截图。

### 关键路径结果与真人验收

| 关键路径 | 本轮真实 Electron 结果 | 后续范围 |
| --- | --- | --- |
| 选区 | 未进入 setup | 生命周期场景及 release；正式复跑后核对取消/临时工具恢复。 |
| 标注 | 未进入 setup | release 与新增实际查看器 quick 场景；原位文字和原生输入法需用户真人体验验收。 |
| 裁剪 | 未进入 setup | release 的拖动/应用和 quick 裁剪预览；导出尺寸应核对实际产物。 |
| 调整层 | 未进入 setup | 原 release 场景未被本轮证明覆盖完整调整层链路，需补定向驱动或列为用户真人验收。 |
| 移除/修补 | 未运行，无付费调用 | 需用户真人验收实际算法质量；仍应先在正式实例验证无付费的工具切换/选区/取消入口。 |
| 主体选择 | 未运行 | 本轮没有下载/启用算法模型，效果与边缘质量需用户真人验收；不以单测冒充结果。 |
| 导出 | 未进入 setup，无新导出产物 | release 与 quick 关闭保存路径需正式复跑，并核对文件/画面/工作区往返。 |

需用户真人验收：压感设备、原生 IME、连续 Space/Z 导航体验、实际模型的主体边缘与移除/修补效果、软边遮罩对齐和导出结果。**这些不是把 Agent 必须做的截图转交用户**：总管理者应先解决正式实例启动，再续跑 Agent 截图与关键路径，跑不到的算法质量/硬件条件才留给真人。

### 本轮新增改动文件与检查

| 文件 | t119-A2 作用 |
| --- | --- |
| `scripts/lib/uiInspectionSceneImageEditToolLifecycle.cjs` | 新增工具登记故障/恢复 fixture 与实际快速标记查看器场景。 |
| `scripts/lib/uiInspectionSceneImageEditDocking.cjs` | 新增布局读取/写入故障及恢复 fixture。 |
| `scripts/lib/uiInspectionScenes.cjs` | 唯一登记新增三场景；不改其他任务工厂。 |
| 本文件 | 更新最新阻塞、截图表、关键路径、检查与续验范围。 |

| 检查 | 本轮结果 |
| --- | --- |
| 三份 CJS `node --check` | 通过。 |
| 三份 CJS 精确 ESLint（`--report-unused-disable-directives --max-warnings 0`） | 通过；新增 quick 场景后重新验证。 |
| 正式中央工厂构造检查 | 七个原目标 + 两个失败 fixture + quick 查看器，共 10 个目标 id 均唯一，setup 均存在。只证明登记，不证明执行成功。 |
| `check:dependency-graph` | 通过：2 存量静态值 SCC、0 冻结跨层边、406 跨 feature 非 index 导入、971 首屏模块/0 重模块、11 动态值回边。 |
| `check:dead-code` | 通过：1 存量未使用文件/0 未使用依赖；2060 导出/类型仅报告。esbuild/nanoid unlisted、vite-node binary 与三个原生 Worker unresolved 是既有非阻断诊断，未清零。 |
| `check:ui-residue` | 通过，无违规、未登记、过期登记。 |
| `check:surface` | 通过。 |
| TypeScript / Vitest | 本轮只改 CJS 场景与 Markdown，不改 TS/TSX/core/main；没有为脚本改动重复两套 tsc 或业务单测。原 t119-A 对应有效结果保留。没有全量测试、related、付费调用或开发实例启动。 |
| `electron:bundle`（正式 Reality `--build`） | 通过，生成新运行产物。 |
| 正式 Reality（两次） | 失败，子进程启动阻塞；截图 0，未目视，不能认定 A 阶段通过。 |

设计自查逐问回答：①助手只凭名称和说明能否用对？本轮只补测试场景，正式操作继续走已有工具/实体命令，没有新增助手专用工具或界面内调试入口。②能否 AI 先做、人只确认？原算法路径未改；Agent 应先完成自动截图、取消/恢复与导出验证，真人只检查算法质量和设备体验；当前启动阻塞未解决，不能宣称这部分已完成。③产物能否直接流进其他工作区？原文档/素材/节点/查看器端口未改，新场景走实际宿主保存；本轮没有新产物，跨工作区往返仍待真实验证。

续跑：在可正常启动 Electron 渲染/GPU 子进程的环境中重新取锁，正式 `--only` 七个原目标加 `image-edit-registration-failure,image-edit-layout-failure,image-edit-quick-mark-viewer`；先完成石墨宽窗口，再按受影响状态补 paper 与 960×640。仅改 CJS 不需要重建，后续运行时代码发生变化时加 `--build`。逐张打开截图按 skill 检查并修复复拍，不能仅凭退出码标通过。旧 `.ui-tour` 步骤里的快速标记场景没有当作本轮已执行证据。

## 原 t119-A 剩余问题与真人验收（历史）

- 首要阻塞：总管理者协调运行中的当前仓库开发实例后，完成正式新产物构建、全部截图、逐图目视和必要复拍；当前不能标 A 阶段完成。
- 工具登记失败、布局加载/保存失败的正式隔离 fixture 仍待接线，不能用单元测试代替截图。
- 选区、标注、裁剪、调整层、移除/修补、主体选择、导出已有受影响目录测试证据；真实 Electron 关键路径尚未跑，不宣称全部真实路径均可用。需逐项实际走通并核对导出产物。
- 03 的后续剪辑/GPU/显式目标消费未交付；真实极大 PNG 编码限制、GPU 性能及物理屏幕呈现没有被本轮证明。
- 真人验收重点：实际输入法、Space/Z 临时工具恢复、浮动/重新停靠及窄窗口体验、软边遮罩对齐、导出结果与工作区往返。真人体验不能替代 Agent 必做截图，先由 Agent 补完再交用户。
- 不需要主进程重启的新增代码没有在本轮引入；构建被旧开发实例阻挡，恢复/维护开发环境由总管理者负责，本轮没有操作该实例。

## t119-A3 真实 Electron 续验（2026-10-09）

本节为最新结果；上方 A/A2 状态仅保留历史。主分支共享脏工作区，总管理者负责 Git 审查与提交。本轮没有 Git 写操作、没有手工修改 SDK/方案 00/01/02、没有启动开发实例或付费调用。巡检期间持有 `.reality/ui-lock`，结束后释放。

### 根因与修复

1. **初始打不开的直接根因为巡检输入无效**：A2 新场景写死了不存在且未入仓的 `docs/ref/test01.jpg`。正式停靠单场景复现与 `.reality/t119-A3/probe/evidence.json` 同时记录 `source.ingest.failed`、`source_ingest.failed`、`image_document_toolbox_action_failed`，错误为 `ENOENT / realpath`。因此一直留在图片文档空态。后续有效输入还确认了源图重开与 Dockview 重建定位两个真实产品缺陷，分别见第 7、19 项。本轮全部 A 场景引用改用已有 `tests/fixtures/image-inpainting/face-scratch-source.png`，涵盖工具箱、画布文档、开发导航与快速标记查看器。
2. **场景契约过时**：辉光场景须先返回图片文档列表并确认“不保存”，再返回工具；布局替换图片同样须处理正式草稿离开确认。Dockview 标签可访问名称包含内部按钮，不等于纯“图层”；点击其真实标题内容，仍严格断言拖入编组、唯一实例和尺寸改变。输入场景等待菜单正式隐藏与 React 状态提交，不删临时工具恢复断言。
3. **工具组菜单真实视觉缺陷**：触发器未登记 `data-panel-trigger-button`，共享 PanelTrigger 无法测量标签宽度，退回图标按钮宽度，文字竖排且被遮挡。补共享触发器契约与单选菜单档位；所有折叠工具组共用同一处修复。选区选项禁止收缩/短标签换行，空间不足仍沿既有命令带从属选项栏处理。
4. **登记失败日志契约错误**：`logger.error(message, { event, error })` 把事件记录成 `error.event`，正式故障场景无法按指定事件识别。实现登记、清单登记与手势失败三处同源调用统一改为 `logger.error(message, error, { event })`，精确测试增加事件参数断言；不放宽故障白名单。
5. **空态重复拖入说明**：中英文图片编辑空态去掉自有拖入句，复用文档列表已提供的拖入说明。
6. **发布候选目标作用域**：初始呈现等待绑定当前 editor DOM，避免用整个 document 的第一个预览（可为停驻的其他宿主）判断当前图片；仍要求原有 viewport、已就绪源、前/安全表面契约。
7. **文档重开源图 URL 为空**：`resourceMediaUrl` 依赖 `resources.describe(resourceId).mediaType`，但 CAS 描述的 MIME 只来自调用时传参，不会落盘。重开/刷新时得到 null，渲染层把空 `src` 解析为应用 HTML，`naturalWidth=0`，真实 release 与登记恢复都不能就绪。统一从已有 SharpSourceProvider 的权威文件头读取类型，再生成受管 URL；提取包导入已存在的类型映射作为共享函数，不改落盘格式、不猜扩展名、不新增依赖。资源 URL 回归与原包往返精确测试均通过。
8. **关闭中菜单误阻断快捷键**：输入路由只看 role 和布局矩形，PanelTrigger 退出动画期间已经 inert/aria-hidden 的菜单仍会拦截 Space/Z。排除关闭态、隐藏态菜单，打开态仍保留输入优先权；补三态精确回归。真实临时导航恢复结果以复跑为准。
9. **Dockview 分隔条拖动被工具路由截断**：真实指针日志证明 pointerdown 正确命中 `dv-sash dv-enabled`，后续移动进入预览后由工具路由阻断冒泡，Dockview 的 document 监听收不到移动/松手。因此产品宽度不变，与分隔条坐标无关。没有工具租约时放行宿主事件，持有租约仍拒绝第二指针；取消后的旧指针单独拦截迟到 move/up，保留“取消不提交”契约。输入桥四项精确回归通过。折叠工具组补同一 Tooltip 入口，不用原生 title 替代正式工具提示。
10. **场景间误关面板导致连锁失败**：共享清理器用 `/关闭|Close/` 取最后一个按钮，新增 Dockview 后实际命中“关闭属性面板”而非“关闭编辑器”。改精确宿主关闭名称；保留失败现场、只关闭一次与 30 秒预算，三项 Node 精确回归通过。剪辑回填入口实际已更名“替换回剪辑（原位置一帧）”，只更新场景文案选择器，仍核对原位置、尺寸与图片文档链接。相关导入夹具按正式文档列表拖入契约接线（GPU 的非空列表接线见第 15 项）；空态专用虚线样式不再当作输入能力契约。已有草稿的 GPU 场景明确处理“不保存”确认。

11. **画布弹窗的面板菜单被遮罩挡住**：DockChrome 手写 dropdown 层级低于 modal，工具箱通过而画布同源菜单点击命中遮罩。删除局部层级覆盖，复用共享 PanelTrigger 的 popover 层级；Shell 精确断言菜单高于 modal，真实工具箱与画布的折叠、编组、浮动、停靠与尺寸调整均走正式菜单。
12. **替换节点预览误删共享输入素材**：`.henjiimg` 往返显示 `missing=1`，真实主进程删除调用栈定位到投影适配器仅凭本地路径释放旧预览，实际删除全景输入，影响另一节点及后续参数蒙版。投影更新不拥有旧路径，删除这段无所有权的释放；导出失败仍按 `ownedFilePaths` 回滚，受管文档像素仍走引用 GC。精确回归涵盖另一个 upload 节点和撤销历史；真实包往返复拍 `missing=0`，蒙版与区域场景不再被前一场景污染。旧本地投影文件没有删除所有权时保留，后续如需磁盘回收应接正式资源所有权，不能再按路径猜测。
13. **快速查看器操作未翻译**：查看器使用 ui namespace 查询 common.save，显示了内部 key。改从 common namespace 读取保存/关闭，精确四项测试和真实截图检查已翻译按钮；参考图场景按新追加的索引打开并等待 decode，避免误点前一场景的辉光图。
14. **补齐关键路径与截图稳定性**：生命周期场景增加正式调整层/撤销、细小区域移除、取样修补、人像选择，分别等待文档 revision 或有效选区，而非只找按钮。停靠截图等待源图就绪、加载结束、布局稳定，修复默认加载与关面板后中间帧被误当最终截图。三维回填场景按现有菜单选择“加入播放头”，保持来源、时间位置与成片断言。
15. **长串 GPU 场景的两类误报**：原子回退查询从 fixture 创建前开始，计入前一文档异步收尾的导出会话；改按当前文档及真实请求 ID 关联，保持一次故障/一次重试/两会话/取消与发布分离的严格断言。画笔和标注只在空列表里寻找 `data-project-library-drop`，已有草稿时等待超时；失败截图显示正常的非空列表。改用实际承载 `dropHandlers` 的 `data-project-library-state` 根节点，保留输入失败截图，不放大超时、不改产品来迁就选择器。
16. **裁切像素判定混入控件**：浅色宽窗口的变换旋转手柄、窄窗口的缩放浮层都可合法出现在文档外。失败前后 RGB 与截图证明它们被误当成合成越界。只在前后像素采样时临时隐藏这两种交互控件，并等待两帧样式提交，全部呈现画布保持可见，文档外零变化断言保持原值；正式截图立即恢复控件。没有放宽像素容差。
17. **登记失败缺少退出入口**：逐图目视发现“请关闭后重新打开”却没有返回按钮。错误工作面保留宿主注入的唯一命令工具栏，不展示失效工具；精确回归验证关闭操作可用，正式故障场景实际点击返回并重开恢复。
18. **移除参数短标签竖排**：与选区参数同源的 flex 收缩使“大小”断为两行。统一修复修补参数根容器的最小内容宽度、收缩与短标签换行契约，窄窗口仍走已有从属参数带，不新增条带或卡片。
19. **恢复默认布局后属性持续隐藏**：加强截图前的真实字段可见断言后，宽/窄都持续失败；诊断 `.reality/t119-A3-dock-diagnostic19.log` 显示属性 `dv-render-overlay` 的 `visibility:hidden` 且坐标落在工作区外。对照当前 Dockview `overlayRenderContainer` 源码发现定位 RAF 的 `pendingUpdates` 按 ID 去重，同帧移除重建同名面板时新定位被旧帧抑制。Shell 在面板新增后合并预约下一帧，通过正式 `api.layout(width,height,true)` 通知当前面板；卸载取消待执行帧。不改第三方源码、不手工清 visibility、不换 renderer 档位，保留 always DOM 与预览/GPU 实例。新精确回归同帧连续重置，断言真实 overlay 可见与预览实例不变。恢复截图严格等属性字段可见。
20. **登记失败退出仍需正常草稿决策**：保留返回入口后实际点击，带内容的临时文档按产品规则弹出保存/不保存/取消。场景选择“不保存”再断言已离开，未删除草稿保护或放宽退出断言。
21. **剪辑打开截图过早**：全组场景虽完成回填与导出，但打开编辑器截图截到了加载中间帧。在当前可见编辑器内严格等待已就绪源图与加载提示消失后截图，定向复跑取得真实 4K 源画面；不改产品加载行为或放宽产物断言。

选型：继续使用项目已有 dockview-react、PanelTrigger、Ui 控件、SharpSourceProvider 及正式图片文档运行时，不自研停靠、菜单布局、文件头解析或输入算法，也不新增依赖或数量限制。应用能力覆盖为原有视图/测试修复，未新增业务实体、权限、MCP 工具或 SDK 行为。

### 验证过程

- 初次定向停靠复现失败，证据准确指向缺失图片；换夹具后可见编辑器并取得实际截图。
- 首次 bundle 因当前终端缺少 C++ INCLUDE/LIB 环境失败（`stdio.h` 找不到）。经 Visual Studio 官方 `Launch-VsDevShell.ps1` 仅初始化本次进程后正式 bundle 成功，不修改构建脚本，不跳过原生步骤；SDK 步骤复用既有 dist。
- 一次巡检在 bundle 尚未完成时被源码新鲜度保护拒绝，未进入场景，未绕过保护。
- 首轮四场景复验暴露旧标签选择器、菜单关闭/状态等待、登记事件参数与草稿确认问题；全部保留原始日志 `.reality/t119-A3-fixtures.log`，未把截图成功当成场景成功。
- Shell、layout、工具箱选源、宿主四份精确测试：25 项通过；登记和输入路由两份精确测试：5 项通过，均 `--silent`。
- 两套 tsc、精确 ESLint 与专项门禁通过；最后一次运行时代码变更后的结果、场景及逐图结论见下方最终验收表。

### t119-A3 实际文件范围

本表仅列 A3 在共享工作区上实际编辑的文件，不把继承的 01–03 全部文件或其他任务改动归入本轮。

| 文件 | A3 改动 |
| --- | --- |
| `electron/main/ipc/image-editor-v3.ts` | 文档载入改从权威源元数据恢复媒体 URL。 |
| `electron/main/services/image-editor-v3/resource-media-url.ts` | 增加元数据到受管源图 URL 的唯一入口。 |
| 同目录 `resource-media-url.test.ts` | 验证 MIME 不落盘时的重开与未知类型拒绝。 |
| 同目录 `source-metadata.ts` | 提取包导入已存在的 MIME 映射。 |
| 同目录 `package-import.ts` | 复用 MIME 映射，保持包验证契约。 |
| `src/features/imageEdit/v3/toolFramework/builtInRegistry.ts` | 修正登记失败日志事件参数。 |
| 同目录 `toolManifest.ts` | 修正清单失败的同源日志调用。 |
| 同目录 `builtInRegistry.test.ts` | 断言正式失败事件参数。 |
| 同目录 `useToolInputRouter.ts` | 排除关闭态菜单、放行无租约宿主指针、阻断取消后迟到事件。 |
| 同目录 `useToolInputRouter.test.tsx` | 增加菜单三态与指针租约回归。 |
| `src/features/imageEdit/v3/editor/ImageEditorToolRailV3.tsx` | 修复分组菜单测量并复用 Tooltip。 |
| 同目录 `ImageEditorSelectionParametersV3.tsx` | 保持参数标签完整、避免收缩换行。 |
| 同目录 `ImageEditorRepairParametersV3.tsx` | 修复移除参数“大小”竖排，沿既有窄窗口从属带排布。 |
| 同目录 `ImageEditorV3.tsx` | 工具登记失败时保留宿主命令栏和退出入口。 |
| 同目录 `ImageEditorV3.test.tsx` | 验证登记失败不展示工具且可实际关闭编辑器。 |
| `src/features/imageEdit/v3/shell/ImageEditorDockChromeV3.tsx` | 删除低于 modal 的局部菜单层级。 |
| 同目录 `ImageEditorDockV3.tsx` | 在同帧重建后通知正式布局重新定位，并取消卸载后的待执行帧。 |
| 同目录 `ImageEditorShellV3.test.tsx` | 断言菜单高于 modal、同帧连续恢复布局后 overlay 可见且预览不重挂。 |
| `src/features/imageMark/viewer/ViewerMarkEditor.tsx` | 从 common namespace 读取保存/关闭文案。 |
| 同目录 `ViewerMarkEditor.test.tsx` | 用翻译后的真实操作名称验证保存、取消与失败恢复。 |
| `src/features/canvas/application/multiLayerDocumentNodeCanvasAdapter.ts` | 删除无所有权的旧预览路径释放。 |
| 同目录 `multiLayerDocumentNodeCanvasAdapter.test.ts` | 验证其他节点和撤销历史的共享素材保留。 |
| `src/tests/imageEditAttachedPersistenceFixture.ts` | 移除已删除的释放依赖替身。 |
| `src/i18n/locales/zh-CN/ui.json` | 去掉空态重复拖入句。 |
| `src/i18n/locales/en-US/ui.json` | 同步英文空态说明。 |
| `scripts/lib/uiInspectionSceneImageEditDocking.cjs` | 使用已入仓夹具、真实 Dockview 契约、草稿确认与稳定截图等待。 |
| 同目录 `uiInspectionSceneImageEditToolLifecycle.cjs` | 修正输入等待、查看器目标，并补调整层/移除/修补/人像路径。 |
| 同目录 `uiInspectionSceneCatalogToolbox.cjs` | 修正返回入口、当前宿主呈现等待及排除交互控件的裁切像素采样。 |
| 同目录 `uiInspectionScenes.cjs` | 给生命周期工厂传入已有正式巡检上下文。 |
| 同目录 `uiInspectionSceneCommon.cjs` | 精确选择宿主关闭按钮，避免误关面板。 |
| 同目录 `uiInspection.test.cjs` | 增加清理回归，保留捕获缩放与失败现场断言。 |
| 同目录 `uiInspectionSceneVideoEditCreativeResults.cjs` | 更新回填菜单并等待当前源图完成加载再截图，保持产物契约。 |
| 同目录 `uiInspectionSceneCatalogGpuBrush.cjs` | 改正式拖入目标、草稿确认与输入失败诊断。 |
| 同目录 `uiInspectionSceneCatalogGpuAnnotation.cjs` | 同步共享导入路径与失败截图诊断。 |
| 同目录 `uiInspectionSceneCatalogGpuExport.cjs` | 增加原子回退事件诊断，移除未使用解构变量。 |
| 同目录 `uiInspectionSceneCanvasEditing.cjs` | 包往返失败结果附缺失路径诊断，没有放宽资源完整性断言。 |
| 本文件 | 记录根因、修复、验证、逐图结论与真人验收边界。 |

`.reality/t119-A3/**` 与相应日志均为忽略的验收产物，交给总管理者本机查看，不加入提交。

### 设计自查

1. **助手只凭名称和说明能否用对？** 正式编辑命令与实体读写保持原入口；修复工具名称呈现、菜单宽度和事件日志可观察性，不新增仅供 Agent 的第二套操作。
2. **能否 AI 先做、人只确认？** 由 Agent 执行可自动驱动的真实 Electron 路径、故障恢复与截图检查；主体/修补等既有算法先给结果，人确认质量。本轮不执行付费生成。
3. **产物能否直接流进其他工作区？** 图片文档仍沿原资源/画布/查看器/剪辑端口；实际完成画布包往返、查看器快速标记返回、图片原剪辑位置回填与 4K60 导出/重开，保留来源与位置断言。会话布局不写进作品。


### 最终检查与正式复跑

本任务明确要求真实 Electron 布局/合成与故障恢复验证，符合 testing.md 的 L2 真实宿主升级条件；构建仅用 electron:bundle，未跑 electron:build、全量 test、related 或启动开发环境。所有耗时步骤输出重定向到忽略的 .reality 日志并后台执行。以下均为最终有效结果；中间失败没有被覆盖成通过。

| 检查 | 结果与证据 |
| --- | --- |
| 精确 Vitest（--silent） | Shell/布局/工具箱选源/宿主 25 项；登记/输入 5 项；源 URL/原包往返/输入 13 项；之后输入 4 项、查看器 4 项、画布适配/附着持久化 8 项、编辑器 20 项、最终 Shell 4 项均通过，重叠用例不累计。见 t119-A3-exact/tools/source-input-tests/input8/viewer10/canvas11-fixed/editor18/shell19.json。 |
| Node 精确清理回归 | uiInspection.test.cjs 中宿主关闭、面板避让与失败保留 3 项通过；t119-A3-close-test2.log。 |
| npx tsc -p tsconfig.json --noEmit | 通过，t119-A3-tsc19.log。 |
| npx tsc -p tsconfig.electron.json --noEmit | 通过，t119-A3-tsc-electron19.log。 |
| 改动文件 ESLint | 各轮精确文件通过；最后运行时代码为 eslint19，之后仅剪辑 CJS 就绪等待为 eslint20，未改的工程不重复检查。 |
| check:main-imports | 通过，608 个 main/preload 文件；t119-A3-main-imports.log。 |
| check:colors | 通过，无新增硬编码颜色；t119-A3-colors18.log。 |
| check:icons | 通过；t119-A3-icons-final.log。 |
| check:dependency-graph（最终） | 通过；2 个存量 SCC、0 冻结跨层边，t119-A3-dependency-graph19.log。 |
| check:dead-code（最终） | 退出 0；1 存量未使用文件、0 存量未使用依赖；导出/类型及 unlisted/binaries/原生 worker unresolved 仍为脚本报告项，不声称这些存量项已清理；t119-A3-dead-code19.log。 |
| check:ui-residue（最终） | 通过，无违规、无未登记、无过期登记；t119-A3-ui-residue19.log。 |
| check:surface（最终） | 通过；t119-A3-surface19.log。 |
| check:assistant-capabilities（最终） | 通过，覆盖扫描及 31 文件 / 200 精确覆盖断言；t119-A3-assistant-capabilities19.log。 |
| npm run electron:bundle（最新运行时代码） | 通过，146.21 秒；t119-A3-bundle19.log。最后剪辑改动为外部 CJS 场景，直接复用新运行产物。 |

日志均位于仓库 .reality/，截图和各轮 evidence.json 位于下表目录。每轮均使用临时测试 profile，不改真实用户数据。

| 正式命令范围 | 结果 | 截图目录 |
| --- | --- | --- |
| --only "图片编辑" --size 1440x900 | 15/15 通过、0 失败；包括分块导出、原子回退、GPU 画笔/标注/预算/初始化后备及剪辑 4K60。 | .reality/t119-A3/broad19（65 张） |
| A 全部 10 个登记 ID，--size 1440x900 --theme-preset paper | 实际匹配 11/11 通过、0 失败（toolbox-image-edit 同时匹配辉光）；见 t119-A3-A-paper19.log。 | .reality/t119-A3/A-paper19（64 张） |
| 6 个受影响场景，--size 960x640 --theme-preset graphite,paper | 12/12 通过、0 失败，涵盖 Shell/生命周期/登记错误/布局错误/快速标记/release。 | .reality/t119-A3/narrow19（102 张） |
| A 中宽窗口其他宿主补齐：region-hosts、quick-mark-viewer、canvas-multi-layer-document-editor、canvas-gpt-mask-editor，另复拍 video-edit-creative-results | 5/5 通过、0 失败；剪辑打开截图源图真实就绪，t119-A3-A-extra20.log。 | .reality/t119-A3/A-extra20（22 张） |

A 全部登记 ID：
`image-edit-tool-lifecycle,image-edit-docking,image-edit-region-hosts,toolbox-image-edit,image-editor-v3-release,canvas-multi-layer-document-editor,canvas-gpt-mask-editor,image-edit-registration-failure,image-edit-layout-failure,image-edit-quick-mark-viewer`。
宽窗口 graphite 由 broad19 加 A-extra20 覆盖，paper 全组独立跑完；窄窗口按实际受影响的 6 场景裁剪，没有将未跑的其余宿主窄尺寸冒充已验收。

### 关键路径实际结果

| 路径 | 正式结果与边界 |
| --- | --- |
| 选区 | 工具组、矩形草稿、Esc 取消、Space/Z 临时工具及恢复通过；已有 region 场景验证软边、失败重试、取消/确认后重开。 |
| 标注 | 实际箭头、文字编辑优先与取消、快速标记返回查看器、GPU 标注缓存通过；原生 IME 真人手感仍待验。 |
| 裁剪 | release 实际比例/自由裁剪、合成范围与导出通过；查看器裁剪入口正常。 |
| 调整层 | 正式图层菜单创建全能调色，检查层类型及文档变更，撤销通过；release 的模糊/柔光与辉光 Pro 通过。 |
| 移除 | 无付费的细小胸部选区完成移除，文档修订确实增加且操作结束；不是脸颊粉色划痕修复质量验收，截图粉色划痕原样保留。 |
| 修补 | 正式选区拖到取样区域后提交，文档修订增加并有可见取样痕迹；蓝色小块是测试取样结果，不宣称自然融合效果合格。 |
| 主体选择 | 现有本地人像算法得到有效选区、忙态退出，真实截图可见主体轮廓；发丝/衣摆精度需真人质量评估，未调用付费模型。 |
| 导出/流转 | 工具箱导出、画布分块/原子回退、包往返 missing=0、查看器返回及原位置图片回填通过；剪辑保持来源/时间位置并完成 3840×2160、60 fps 导出及重开。 |

### 逐图目视与复拍

下面 253 条为实际逐张打开的截图记录，不是拼图或只读退出码。图路径含场景和状态；所有稳定图片编辑 Shell 帧核对命令条带≤2、平铺面板（无卡片套卡片）、间距/对齐、工具和参数文案。折叠/标签/浮动/隐藏/尺寸/恢复分别有状态截图，正式失败截图核对说明和退出/恢复入口。

登记失败无退出、移除标签竖排、恢复布局属性隐藏均在目视/加强真实字段断言后修复并重新拍摄。broad19 的剪辑打开中间帧以 A-extra20 替换；预算后备 screenshot 是刻意保留 CPU 后备准备中的诊断帧，仍有原图像素，不能当稳定完成截图，稳定呈现另见 gpu-fit 帧与场景断言。


#### broad19

| 场景/状态 | 路径 | 目视结论 | 复拍结果 |
| --- | --- | --- | --- |
| image-edit-docking-canvas-collapsed | [.reality/t119-A3/broad19/1440x900-image-edit-docking-canvas-collapsed.png](../../../../.reality/t119-A3/broad19/1440x900-image-edit-docking-canvas-collapsed.png) | 折叠后仅保留标签与操作，中央作品可见 | 复拍通过 |
| image-edit-docking-canvas-default | [.reality/t119-A3/broad19/1440x900-image-edit-docking-canvas-default.png](../../../../.reality/t119-A3/broad19/1440x900-image-edit-docking-canvas-default.png) | 目标作品/宿主可见，工具和面板平铺，对齐正常 | 复拍通过 |
| image-edit-docking-canvas-floating | [.reality/t119-A3/broad19/1440x900-image-edit-docking-canvas-floating.png](../../../../.reality/t119-A3/broad19/1440x900-image-edit-docking-canvas-floating.png) | 浮动面板标签与参数可见，遮挡符合用户主动位置 | 复拍通过 |
| image-edit-docking-canvas-panels-hidden | [.reality/t119-A3/broad19/1440x900-image-edit-docking-canvas-panels-hidden.png](../../../../.reality/t119-A3/broad19/1440x900-image-edit-docking-canvas-panels-hidden.png) | 面板隐藏，工具与作品保持可用 | 复拍通过 |
| image-edit-docking-canvas-reopened | [.reality/t119-A3/broad19/1440x900-image-edit-docking-canvas-reopened.png](../../../../.reality/t119-A3/broad19/1440x900-image-edit-docking-canvas-reopened.png) | 重开保留目标布局/作品或正式回填结果 | 复拍通过 |
| image-edit-docking-canvas-resized | [.reality/t119-A3/broad19/1440x900-image-edit-docking-canvas-resized.png](../../../../.reality/t119-A3/broad19/1440x900-image-edit-docking-canvas-resized.png) | 尺寸实际改变，内容沿既有滚动容器可达 | 修复指针冒泡后复拍通过 |
| image-edit-docking-canvas-restored | [.reality/t119-A3/broad19/1440x900-image-edit-docking-canvas-restored.png](../../../../.reality/t119-A3/broad19/1440x900-image-edit-docking-canvas-restored.png) | 恢复后图层/属性与实际字段可见，画面未丢失 | 修复定位/恢复后复拍通过 |
| image-edit-docking-canvas-tabs | [.reality/t119-A3/broad19/1440x900-image-edit-docking-canvas-tabs.png](../../../../.reality/t119-A3/broad19/1440x900-image-edit-docking-canvas-tabs.png) | 同组标签清晰，活动图层正常，另一标签可切换 | 复拍通过 |
| image-edit-docking-toolbox-collapsed | [.reality/t119-A3/broad19/1440x900-image-edit-docking-toolbox-collapsed.png](../../../../.reality/t119-A3/broad19/1440x900-image-edit-docking-toolbox-collapsed.png) | 折叠后仅保留标签与操作，中央作品可见 | 复拍通过 |
| image-edit-docking-toolbox-default | [.reality/t119-A3/broad19/1440x900-image-edit-docking-toolbox-default.png](../../../../.reality/t119-A3/broad19/1440x900-image-edit-docking-toolbox-default.png) | 目标作品/宿主可见，工具和面板平铺，对齐正常 | 复拍通过 |
| image-edit-docking-toolbox-empty | [.reality/t119-A3/broad19/1440x900-image-edit-docking-toolbox-empty.png](../../../../.reality/t119-A3/broad19/1440x900-image-edit-docking-toolbox-empty.png) | 空态清晰，拖入说明只出现一次 | 删除重复文案后复拍通过 |
| image-edit-docking-toolbox-floating | [.reality/t119-A3/broad19/1440x900-image-edit-docking-toolbox-floating.png](../../../../.reality/t119-A3/broad19/1440x900-image-edit-docking-toolbox-floating.png) | 浮动面板标签与参数可见，遮挡符合用户主动位置 | 复拍通过 |
| image-edit-docking-toolbox-panels-hidden | [.reality/t119-A3/broad19/1440x900-image-edit-docking-toolbox-panels-hidden.png](../../../../.reality/t119-A3/broad19/1440x900-image-edit-docking-toolbox-panels-hidden.png) | 面板隐藏，工具与作品保持可用 | 复拍通过 |
| image-edit-docking-toolbox-reopened | [.reality/t119-A3/broad19/1440x900-image-edit-docking-toolbox-reopened.png](../../../../.reality/t119-A3/broad19/1440x900-image-edit-docking-toolbox-reopened.png) | 重开保留目标布局/作品或正式回填结果 | 复拍通过 |
| image-edit-docking-toolbox-resized | [.reality/t119-A3/broad19/1440x900-image-edit-docking-toolbox-resized.png](../../../../.reality/t119-A3/broad19/1440x900-image-edit-docking-toolbox-resized.png) | 尺寸实际改变，内容沿既有滚动容器可达 | 修复指针冒泡后复拍通过 |
| image-edit-docking-toolbox-restored | [.reality/t119-A3/broad19/1440x900-image-edit-docking-toolbox-restored.png](../../../../.reality/t119-A3/broad19/1440x900-image-edit-docking-toolbox-restored.png) | 恢复后图层/属性与实际字段可见，画面未丢失 | 修复定位/恢复后复拍通过 |
| image-edit-docking-toolbox-tabs | [.reality/t119-A3/broad19/1440x900-image-edit-docking-toolbox-tabs.png](../../../../.reality/t119-A3/broad19/1440x900-image-edit-docking-toolbox-tabs.png) | 同组标签清晰，活动图层正常，另一标签可切换 | 复拍通过 |
| image-edit-docking | [.reality/t119-A3/broad19/1440x900-image-edit-docking.png](../../../../.reality/t119-A3/broad19/1440x900-image-edit-docking.png) | 目标作品/宿主可见，工具和面板平铺，对齐正常 | 复拍通过 |
| image-edit-layout-failure-layout-load-failed | [.reality/t119-A3/broad19/1440x900-image-edit-layout-failure-layout-load-failed.png](../../../../.reality/t119-A3/broad19/1440x900-image-edit-layout-failure-layout-load-failed.png) | 布局失败提示可读，作品仍可见，恢复入口可用 | 故障注入复拍通过 |
| image-edit-layout-failure-layout-load-recovered | [.reality/t119-A3/broad19/1440x900-image-edit-layout-failure-layout-load-recovered.png](../../../../.reality/t119-A3/broad19/1440x900-image-edit-layout-failure-layout-load-recovered.png) | 恢复后图层/属性与实际字段可见，画面未丢失 | 修复定位/恢复后复拍通过 |
| image-edit-layout-failure-layout-save-failed | [.reality/t119-A3/broad19/1440x900-image-edit-layout-failure-layout-save-failed.png](../../../../.reality/t119-A3/broad19/1440x900-image-edit-layout-failure-layout-save-failed.png) | 布局失败提示可读，作品仍可见，恢复入口可用 | 故障注入复拍通过 |
| image-edit-layout-failure-layout-save-recovered | [.reality/t119-A3/broad19/1440x900-image-edit-layout-failure-layout-save-recovered.png](../../../../.reality/t119-A3/broad19/1440x900-image-edit-layout-failure-layout-save-recovered.png) | 恢复后图层/属性与实际字段可见，画面未丢失 | 修复定位/恢复后复拍通过 |
| image-edit-layout-failure | [.reality/t119-A3/broad19/1440x900-image-edit-layout-failure.png](../../../../.reality/t119-A3/broad19/1440x900-image-edit-layout-failure.png) | 目标作品/宿主可见，工具和面板平铺，对齐正常 | 复拍通过 |
| image-edit-registration-failure-registration-failed | [.reality/t119-A3/broad19/1440x900-image-edit-registration-failure-registration-failed.png](../../../../.reality/t119-A3/broad19/1440x900-image-edit-registration-failure-registration-failed.png) | 故障说明清楚，保留正式返回命令，可退出后重开 | 修复退出入口后复拍通过 |
| image-edit-registration-failure-registration-recovered | [.reality/t119-A3/broad19/1440x900-image-edit-registration-failure-registration-recovered.png](../../../../.reality/t119-A3/broad19/1440x900-image-edit-registration-failure-registration-recovered.png) | 恢复后图层/属性与实际字段可见，画面未丢失 | 修复定位/恢复后复拍通过 |
| image-edit-registration-failure | [.reality/t119-A3/broad19/1440x900-image-edit-registration-failure.png](../../../../.reality/t119-A3/broad19/1440x900-image-edit-registration-failure.png) | 目标作品/宿主可见，工具和面板平铺，对齐正常 | 复拍通过 |
| image-edit-tool-lifecycle-adjustment-layer | [.reality/t119-A3/broad19/1440x900-image-edit-tool-lifecycle-adjustment-layer.png](../../../../.reality/t119-A3/broad19/1440x900-image-edit-tool-lifecycle-adjustment-layer.png) | 调色层与属性控件可见，层级平铺 | 路径复拍通过 |
| image-edit-tool-lifecycle-annotation-group | [.reality/t119-A3/broad19/1440x900-image-edit-tool-lifecycle-annotation-group.png](../../../../.reality/t119-A3/broad19/1440x900-image-edit-tool-lifecycle-annotation-group.png) | 工具组菜单宽度正常，文字不竖排，弹窗内菜单可用 | 修复共享触发器/层级后复拍通过 |
| image-edit-tool-lifecycle-ime-text-priority | [.reality/t119-A3/broad19/1440x900-image-edit-tool-lifecycle-ime-text-priority.png](../../../../.reality/t119-A3/broad19/1440x900-image-edit-tool-lifecycle-ime-text-priority.png) | 文字编辑态可见，文本与工具优先权保留 | 复拍通过；原生 IME 待真人 |
| image-edit-tool-lifecycle-navigation-restored | [.reality/t119-A3/broad19/1440x900-image-edit-tool-lifecycle-navigation-restored.png](../../../../.reality/t119-A3/broad19/1440x900-image-edit-tool-lifecycle-navigation-restored.png) | 恢复后图层/属性与实际字段可见，画面未丢失 | 修复定位/恢复后复拍通过 |
| image-edit-tool-lifecycle-options-closed | [.reality/t119-A3/broad19/1440x900-image-edit-tool-lifecycle-options-closed.png](../../../../.reality/t119-A3/broad19/1440x900-image-edit-tool-lifecycle-options-closed.png) | 目标作品/宿主可见，工具和面板平铺，对齐正常 | 复拍通过 |
| image-edit-tool-lifecycle-registered-tools | [.reality/t119-A3/broad19/1440x900-image-edit-tool-lifecycle-registered-tools.png](../../../../.reality/t119-A3/broad19/1440x900-image-edit-tool-lifecycle-registered-tools.png) | 目标作品/宿主可见，工具和面板平铺，对齐正常 | 复拍通过 |
| image-edit-tool-lifecycle-remove-result | [.reality/t119-A3/broad19/1440x900-image-edit-tool-lifecycle-remove-result.png](../../../../.reality/t119-A3/broad19/1440x900-image-edit-tool-lifecycle-remove-result.png) | 细小区域移除完成，标签不再竖排；不评价划痕修复 | 路径复拍通过 |
| image-edit-tool-lifecycle-repair-result | [.reality/t119-A3/broad19/1440x900-image-edit-tool-lifecycle-repair-result.png](../../../../.reality/t119-A3/broad19/1440x900-image-edit-tool-lifecycle-repair-result.png) | 取样修补完成，蓝色小块为夹具结果；不评价融合质量 | 路径复拍通过 |
| image-edit-tool-lifecycle-selection-cancelled | [.reality/t119-A3/broad19/1440x900-image-edit-tool-lifecycle-selection-cancelled.png](../../../../.reality/t119-A3/broad19/1440x900-image-edit-tool-lifecycle-selection-cancelled.png) | 取消后草稿清除，工作面与导航恢复 | 复拍通过 |
| image-edit-tool-lifecycle-selection-draft | [.reality/t119-A3/broad19/1440x900-image-edit-tool-lifecycle-selection-draft.png](../../../../.reality/t119-A3/broad19/1440x900-image-edit-tool-lifecycle-selection-draft.png) | 矩形选区草稿与选项清晰，画面完整 | 复拍通过 |
| image-edit-tool-lifecycle-selection-group | [.reality/t119-A3/broad19/1440x900-image-edit-tool-lifecycle-selection-group.png](../../../../.reality/t119-A3/broad19/1440x900-image-edit-tool-lifecycle-selection-group.png) | 工具组菜单宽度正常，文字不竖排，弹窗内菜单可用 | 修复共享触发器/层级后复拍通过 |
| image-edit-tool-lifecycle-subject-result | [.reality/t119-A3/broad19/1440x900-image-edit-tool-lifecycle-subject-result.png](../../../../.reality/t119-A3/broad19/1440x900-image-edit-tool-lifecycle-subject-result.png) | 主体选区覆盖人像；边缘质量仍需真人判断 | 路径复拍通过 |
| image-edit-tool-lifecycle-temporary-hand | [.reality/t119-A3/broad19/1440x900-image-edit-tool-lifecycle-temporary-hand.png](../../../../.reality/t119-A3/broad19/1440x900-image-edit-tool-lifecycle-temporary-hand.png) | 临时导航工具高亮与对应选项正常 | 复拍通过 |
| image-edit-tool-lifecycle-temporary-zoom | [.reality/t119-A3/broad19/1440x900-image-edit-tool-lifecycle-temporary-zoom.png](../../../../.reality/t119-A3/broad19/1440x900-image-edit-tool-lifecycle-temporary-zoom.png) | 临时导航工具高亮与对应选项正常 | 复拍通过 |
| image-edit-tool-lifecycle-text-cancelled | [.reality/t119-A3/broad19/1440x900-image-edit-tool-lifecycle-text-cancelled.png](../../../../.reality/t119-A3/broad19/1440x900-image-edit-tool-lifecycle-text-cancelled.png) | 取消后草稿清除，工作面与导航恢复 | 复拍通过 |
| image-edit-tool-lifecycle | [.reality/t119-A3/broad19/1440x900-image-edit-tool-lifecycle.png](../../../../.reality/t119-A3/broad19/1440x900-image-edit-tool-lifecycle.png) | 目标作品/宿主可见，工具和面板平铺，对齐正常 | 复拍通过 |
| image-editor-gpu-annotation-cache | [.reality/t119-A3/broad19/1440x900-image-editor-gpu-annotation-cache.png](../../../../.reality/t119-A3/broad19/1440x900-image-editor-gpu-annotation-cache.png) | GPU/后备相关真实作品和目标宿主可见 | 正式场景复拍通过 |
| image-editor-gpu-brush-redo | [.reality/t119-A3/broad19/1440x900-image-editor-gpu-brush-redo.png](../../../../.reality/t119-A3/broad19/1440x900-image-editor-gpu-brush-redo.png) | GPU/后备相关真实作品和目标宿主可见 | 正式场景复拍通过 |
| image-editor-gpu-brush | [.reality/t119-A3/broad19/1440x900-image-editor-gpu-brush.png](../../../../.reality/t119-A3/broad19/1440x900-image-editor-gpu-brush.png) | GPU/后备相关真实作品和目标宿主可见 | 正式场景复拍通过 |
| image-editor-gpu-budget-fallback-gpu-fit | [.reality/t119-A3/broad19/1440x900-image-editor-gpu-budget-fallback-gpu-fit.png](../../../../.reality/t119-A3/broad19/1440x900-image-editor-gpu-budget-fallback-gpu-fit.png) | GPU/后备相关真实作品和目标宿主可见 | 正式场景复拍通过 |
| image-editor-gpu-budget-fallback | [.reality/t119-A3/broad19/1440x900-image-editor-gpu-budget-fallback.png](../../../../.reality/t119-A3/broad19/1440x900-image-editor-gpu-budget-fallback.png) | 后备准备诊断帧仍有原图，加载提示为过渡状态 | 保留诊断；稳定帧另见 gpu-fit |
| image-editor-gpu-export-editor | [.reality/t119-A3/broad19/1440x900-image-editor-gpu-export-editor.png](../../../../.reality/t119-A3/broad19/1440x900-image-editor-gpu-export-editor.png) | GPU/后备相关真实作品和目标宿主可见 | 正式场景复拍通过 |
| image-editor-gpu-export-transactional-fallback-canvas | [.reality/t119-A3/broad19/1440x900-image-editor-gpu-export-transactional-fallback-canvas.png](../../../../.reality/t119-A3/broad19/1440x900-image-editor-gpu-export-transactional-fallback-canvas.png) | GPU/后备相关真实作品和目标宿主可见 | 正式场景复拍通过 |
| image-editor-gpu-export-transactional-fallback | [.reality/t119-A3/broad19/1440x900-image-editor-gpu-export-transactional-fallback.png](../../../../.reality/t119-A3/broad19/1440x900-image-editor-gpu-export-transactional-fallback.png) | GPU/后备相关真实作品和目标宿主可见 | 正式场景复拍通过 |
| image-editor-gpu-export | [.reality/t119-A3/broad19/1440x900-image-editor-gpu-export.png](../../../../.reality/t119-A3/broad19/1440x900-image-editor-gpu-export.png) | GPU/后备相关真实作品和目标宿主可见 | 正式场景复拍通过 |
| image-editor-gpu-initialization-fallback-editor | [.reality/t119-A3/broad19/1440x900-image-editor-gpu-initialization-fallback-editor.png](../../../../.reality/t119-A3/broad19/1440x900-image-editor-gpu-initialization-fallback-editor.png) | GPU/后备相关真实作品和目标宿主可见 | 正式场景复拍通过 |
| image-editor-gpu-initialization-fallback | [.reality/t119-A3/broad19/1440x900-image-editor-gpu-initialization-fallback.png](../../../../.reality/t119-A3/broad19/1440x900-image-editor-gpu-initialization-fallback.png) | GPU/后备相关真实作品和目标宿主可见 | 正式场景复拍通过 |
| image-editor-gpu-raster-diagnostic-editor | [.reality/t119-A3/broad19/1440x900-image-editor-gpu-raster-diagnostic-editor.png](../../../../.reality/t119-A3/broad19/1440x900-image-editor-gpu-raster-diagnostic-editor.png) | GPU/后备相关真实作品和目标宿主可见 | 正式场景复拍通过 |
| image-editor-gpu-raster-diagnostic | [.reality/t119-A3/broad19/1440x900-image-editor-gpu-raster-diagnostic.png](../../../../.reality/t119-A3/broad19/1440x900-image-editor-gpu-raster-diagnostic.png) | GPU/后备相关真实作品和目标宿主可见 | 正式场景复拍通过 |
| image-editor-v3-release-move-baseline | [.reality/t119-A3/broad19/1440x900-image-editor-v3-release-move-baseline.png](../../../../.reality/t119-A3/broad19/1440x900-image-editor-v3-release-move-baseline.png) | 目标作品/宿主可见，工具和面板平铺，对齐正常 | 复拍通过 |
| image-editor-v3-release-properties-floating | [.reality/t119-A3/broad19/1440x900-image-editor-v3-release-properties-floating.png](../../../../.reality/t119-A3/broad19/1440x900-image-editor-v3-release-properties-floating.png) | 浮动面板标签与参数可见，遮挡符合用户主动位置 | 复拍通过 |
| image-editor-v3-release | [.reality/t119-A3/broad19/1440x900-image-editor-v3-release.png](../../../../.reality/t119-A3/broad19/1440x900-image-editor-v3-release.png) | 裁剪工具和比例入口完整，作品与图层可见 | 复拍通过 |
| toolbox-image-edit-vgpu-glow | [.reality/t119-A3/broad19/1440x900-toolbox-image-edit-vgpu-glow.png](../../../../.reality/t119-A3/broad19/1440x900-toolbox-image-edit-vgpu-glow.png) | 辉光结果及参数可见，效果层不可移动提示为任务文案 | 复拍通过 |
| toolbox-image-edit | [.reality/t119-A3/broad19/1440x900-toolbox-image-edit.png](../../../../.reality/t119-A3/broad19/1440x900-toolbox-image-edit.png) | 空态清晰，拖入说明只出现一次 | 删除重复文案后复拍通过 |
| video-edit-creative-results-creative-camera-stage-sent | [.reality/t119-A3/broad19/1440x900-video-edit-creative-results-creative-camera-stage-sent.png](../../../../.reality/t119-A3/broad19/1440x900-video-edit-creative-results-creative-camera-stage-sent.png) | 三维图片与加入剪辑反馈可见 | 复拍通过 |
| video-edit-creative-results-creative-image-backfilled-4k | [.reality/t119-A3/broad19/1440x900-video-edit-creative-results-creative-image-backfilled-4k.png](../../../../.reality/t119-A3/broad19/1440x900-video-edit-creative-results-creative-image-backfilled-4k.png) | 4K60 剪辑和原位置图片回填实际可见 | 复拍通过 |
| video-edit-creative-results-creative-image-editor-opened | [.reality/t119-A3/broad19/1440x900-video-edit-creative-results-creative-image-editor-opened.png](../../../../.reality/t119-A3/broad19/1440x900-video-edit-creative-results-creative-image-editor-opened.png) | 加载中间帧，不能作为就绪验收 | A-extra20 同名截图已替换 |
| video-edit-creative-results-creative-results-reopened-4k60 | [.reality/t119-A3/broad19/1440x900-video-edit-creative-results-creative-results-reopened-4k60.png](../../../../.reality/t119-A3/broad19/1440x900-video-edit-creative-results-creative-results-reopened-4k60.png) | 重开保留目标布局/作品或正式回填结果 | 复拍通过 |
| video-edit-creative-results | [.reality/t119-A3/broad19/1440x900-video-edit-creative-results.png](../../../../.reality/t119-A3/broad19/1440x900-video-edit-creative-results.png) | 目标作品/宿主可见，工具和面板平铺，对齐正常 | 复拍通过 |

#### A-paper19

| 场景/状态 | 路径 | 目视结论 | 复拍结果 |
| --- | --- | --- | --- |
| canvas-gpt-mask-editor | [.reality/t119-A3/A-paper19/1440x900-canvas-gpt-mask-editor.png](../../../../.reality/t119-A3/A-paper19/1440x900-canvas-gpt-mask-editor.png) | 参数遮罩正式宿主与源图可见，现有工具平铺 | 复拍通过；未做网络生成 |
| canvas-multi-layer-document-editor-editor | [.reality/t119-A3/A-paper19/1440x900-canvas-multi-layer-document-editor-editor.png](../../../../.reality/t119-A3/A-paper19/1440x900-canvas-multi-layer-document-editor-editor.png) | 正式画布文档/编辑弹窗与多层作品可见 | 复拍通过；包缺失断言为零 |
| canvas-multi-layer-document-editor | [.reality/t119-A3/A-paper19/1440x900-canvas-multi-layer-document-editor.png](../../../../.reality/t119-A3/A-paper19/1440x900-canvas-multi-layer-document-editor.png) | 正式画布文档/编辑弹窗与多层作品可见 | 复拍通过；包缺失断言为零 |
| image-edit-docking-canvas-collapsed | [.reality/t119-A3/A-paper19/1440x900-image-edit-docking-canvas-collapsed.png](../../../../.reality/t119-A3/A-paper19/1440x900-image-edit-docking-canvas-collapsed.png) | 折叠后仅保留标签与操作，中央作品可见 | 复拍通过 |
| image-edit-docking-canvas-default | [.reality/t119-A3/A-paper19/1440x900-image-edit-docking-canvas-default.png](../../../../.reality/t119-A3/A-paper19/1440x900-image-edit-docking-canvas-default.png) | 目标作品/宿主可见，工具和面板平铺，对齐正常 | 复拍通过 |
| image-edit-docking-canvas-floating | [.reality/t119-A3/A-paper19/1440x900-image-edit-docking-canvas-floating.png](../../../../.reality/t119-A3/A-paper19/1440x900-image-edit-docking-canvas-floating.png) | 浮动面板标签与参数可见，遮挡符合用户主动位置 | 复拍通过 |
| image-edit-docking-canvas-panels-hidden | [.reality/t119-A3/A-paper19/1440x900-image-edit-docking-canvas-panels-hidden.png](../../../../.reality/t119-A3/A-paper19/1440x900-image-edit-docking-canvas-panels-hidden.png) | 面板隐藏，工具与作品保持可用 | 复拍通过 |
| image-edit-docking-canvas-reopened | [.reality/t119-A3/A-paper19/1440x900-image-edit-docking-canvas-reopened.png](../../../../.reality/t119-A3/A-paper19/1440x900-image-edit-docking-canvas-reopened.png) | 重开保留目标布局/作品或正式回填结果 | 复拍通过 |
| image-edit-docking-canvas-resized | [.reality/t119-A3/A-paper19/1440x900-image-edit-docking-canvas-resized.png](../../../../.reality/t119-A3/A-paper19/1440x900-image-edit-docking-canvas-resized.png) | 尺寸实际改变，内容沿既有滚动容器可达 | 修复指针冒泡后复拍通过 |
| image-edit-docking-canvas-restored | [.reality/t119-A3/A-paper19/1440x900-image-edit-docking-canvas-restored.png](../../../../.reality/t119-A3/A-paper19/1440x900-image-edit-docking-canvas-restored.png) | 恢复后图层/属性与实际字段可见，画面未丢失 | 修复定位/恢复后复拍通过 |
| image-edit-docking-canvas-tabs | [.reality/t119-A3/A-paper19/1440x900-image-edit-docking-canvas-tabs.png](../../../../.reality/t119-A3/A-paper19/1440x900-image-edit-docking-canvas-tabs.png) | 同组标签清晰，活动图层正常，另一标签可切换 | 复拍通过 |
| image-edit-docking-toolbox-collapsed | [.reality/t119-A3/A-paper19/1440x900-image-edit-docking-toolbox-collapsed.png](../../../../.reality/t119-A3/A-paper19/1440x900-image-edit-docking-toolbox-collapsed.png) | 折叠后仅保留标签与操作，中央作品可见 | 复拍通过 |
| image-edit-docking-toolbox-default | [.reality/t119-A3/A-paper19/1440x900-image-edit-docking-toolbox-default.png](../../../../.reality/t119-A3/A-paper19/1440x900-image-edit-docking-toolbox-default.png) | 目标作品/宿主可见，工具和面板平铺，对齐正常 | 复拍通过 |
| image-edit-docking-toolbox-empty | [.reality/t119-A3/A-paper19/1440x900-image-edit-docking-toolbox-empty.png](../../../../.reality/t119-A3/A-paper19/1440x900-image-edit-docking-toolbox-empty.png) | 空态清晰，拖入说明只出现一次 | 删除重复文案后复拍通过 |
| image-edit-docking-toolbox-floating | [.reality/t119-A3/A-paper19/1440x900-image-edit-docking-toolbox-floating.png](../../../../.reality/t119-A3/A-paper19/1440x900-image-edit-docking-toolbox-floating.png) | 浮动面板标签与参数可见，遮挡符合用户主动位置 | 复拍通过 |
| image-edit-docking-toolbox-panels-hidden | [.reality/t119-A3/A-paper19/1440x900-image-edit-docking-toolbox-panels-hidden.png](../../../../.reality/t119-A3/A-paper19/1440x900-image-edit-docking-toolbox-panels-hidden.png) | 面板隐藏，工具与作品保持可用 | 复拍通过 |
| image-edit-docking-toolbox-reopened | [.reality/t119-A3/A-paper19/1440x900-image-edit-docking-toolbox-reopened.png](../../../../.reality/t119-A3/A-paper19/1440x900-image-edit-docking-toolbox-reopened.png) | 重开保留目标布局/作品或正式回填结果 | 复拍通过 |
| image-edit-docking-toolbox-resized | [.reality/t119-A3/A-paper19/1440x900-image-edit-docking-toolbox-resized.png](../../../../.reality/t119-A3/A-paper19/1440x900-image-edit-docking-toolbox-resized.png) | 尺寸实际改变，内容沿既有滚动容器可达 | 修复指针冒泡后复拍通过 |
| image-edit-docking-toolbox-restored | [.reality/t119-A3/A-paper19/1440x900-image-edit-docking-toolbox-restored.png](../../../../.reality/t119-A3/A-paper19/1440x900-image-edit-docking-toolbox-restored.png) | 恢复后图层/属性与实际字段可见，画面未丢失 | 修复定位/恢复后复拍通过 |
| image-edit-docking-toolbox-tabs | [.reality/t119-A3/A-paper19/1440x900-image-edit-docking-toolbox-tabs.png](../../../../.reality/t119-A3/A-paper19/1440x900-image-edit-docking-toolbox-tabs.png) | 同组标签清晰，活动图层正常，另一标签可切换 | 复拍通过 |
| image-edit-docking | [.reality/t119-A3/A-paper19/1440x900-image-edit-docking.png](../../../../.reality/t119-A3/A-paper19/1440x900-image-edit-docking.png) | 目标作品/宿主可见，工具和面板平铺，对齐正常 | 复拍通过 |
| image-edit-layout-failure-layout-load-failed | [.reality/t119-A3/A-paper19/1440x900-image-edit-layout-failure-layout-load-failed.png](../../../../.reality/t119-A3/A-paper19/1440x900-image-edit-layout-failure-layout-load-failed.png) | 布局失败提示可读，作品仍可见，恢复入口可用 | 故障注入复拍通过 |
| image-edit-layout-failure-layout-load-recovered | [.reality/t119-A3/A-paper19/1440x900-image-edit-layout-failure-layout-load-recovered.png](../../../../.reality/t119-A3/A-paper19/1440x900-image-edit-layout-failure-layout-load-recovered.png) | 恢复后图层/属性与实际字段可见，画面未丢失 | 修复定位/恢复后复拍通过 |
| image-edit-layout-failure-layout-save-failed | [.reality/t119-A3/A-paper19/1440x900-image-edit-layout-failure-layout-save-failed.png](../../../../.reality/t119-A3/A-paper19/1440x900-image-edit-layout-failure-layout-save-failed.png) | 布局失败提示可读，作品仍可见，恢复入口可用 | 故障注入复拍通过 |
| image-edit-layout-failure-layout-save-recovered | [.reality/t119-A3/A-paper19/1440x900-image-edit-layout-failure-layout-save-recovered.png](../../../../.reality/t119-A3/A-paper19/1440x900-image-edit-layout-failure-layout-save-recovered.png) | 恢复后图层/属性与实际字段可见，画面未丢失 | 修复定位/恢复后复拍通过 |
| image-edit-layout-failure | [.reality/t119-A3/A-paper19/1440x900-image-edit-layout-failure.png](../../../../.reality/t119-A3/A-paper19/1440x900-image-edit-layout-failure.png) | 目标作品/宿主可见，工具和面板平铺，对齐正常 | 复拍通过 |
| image-edit-quick-mark-viewer-quick-arrow | [.reality/t119-A3/A-paper19/1440x900-image-edit-quick-mark-viewer-quick-arrow.png](../../../../.reality/t119-A3/A-paper19/1440x900-image-edit-quick-mark-viewer-quick-arrow.png) | 实际箭头及图层可见，保存/关闭已翻译 | 复拍通过 |
| image-edit-quick-mark-viewer-quick-crop | [.reality/t119-A3/A-paper19/1440x900-image-edit-quick-mark-viewer-quick-crop.png](../../../../.reality/t119-A3/A-paper19/1440x900-image-edit-quick-mark-viewer-quick-crop.png) | 裁剪工具和比例入口完整，作品与图层可见 | 复拍通过 |
| image-edit-quick-mark-viewer-quick-default | [.reality/t119-A3/A-paper19/1440x900-image-edit-quick-mark-viewer-quick-default.png](../../../../.reality/t119-A3/A-paper19/1440x900-image-edit-quick-mark-viewer-quick-default.png) | 查看器或快速编辑源画面完整，文案已翻译 | 复拍通过 |
| image-edit-quick-mark-viewer-quick-returned-to-viewer | [.reality/t119-A3/A-paper19/1440x900-image-edit-quick-mark-viewer-quick-returned-to-viewer.png](../../../../.reality/t119-A3/A-paper19/1440x900-image-edit-quick-mark-viewer-quick-returned-to-viewer.png) | 查看器或快速编辑源画面完整，文案已翻译 | 复拍通过 |
| image-edit-quick-mark-viewer-viewer | [.reality/t119-A3/A-paper19/1440x900-image-edit-quick-mark-viewer-viewer.png](../../../../.reality/t119-A3/A-paper19/1440x900-image-edit-quick-mark-viewer-viewer.png) | 查看器或快速编辑源画面完整，文案已翻译 | 复拍通过 |
| image-edit-quick-mark-viewer | [.reality/t119-A3/A-paper19/1440x900-image-edit-quick-mark-viewer.png](../../../../.reality/t119-A3/A-paper19/1440x900-image-edit-quick-mark-viewer.png) | 查看器或快速编辑源画面完整，文案已翻译 | 复拍通过 |
| image-edit-region-hosts-parameter-cancel-reopen | [.reality/t119-A3/A-paper19/1440x900-image-edit-region-hosts-parameter-cancel-reopen.png](../../../../.reality/t119-A3/A-paper19/1440x900-image-edit-region-hosts-parameter-cancel-reopen.png) | 目标蒙版/软边/确认或取消状态与源图对应，控件对齐 | 复拍通过 |
| image-edit-region-hosts-parameter-confirm-reopen | [.reality/t119-A3/A-paper19/1440x900-image-edit-region-hosts-parameter-confirm-reopen.png](../../../../.reality/t119-A3/A-paper19/1440x900-image-edit-region-hosts-parameter-confirm-reopen.png) | 目标蒙版/软边/确认或取消状态与源图对应，控件对齐 | 复拍通过 |
| image-edit-region-hosts-parameter-empty | [.reality/t119-A3/A-paper19/1440x900-image-edit-region-hosts-parameter-empty.png](../../../../.reality/t119-A3/A-paper19/1440x900-image-edit-region-hosts-parameter-empty.png) | 目标蒙版/软边/确认或取消状态与源图对应，控件对齐 | 复拍通过 |
| image-edit-region-hosts-parameter-recovered | [.reality/t119-A3/A-paper19/1440x900-image-edit-region-hosts-parameter-recovered.png](../../../../.reality/t119-A3/A-paper19/1440x900-image-edit-region-hosts-parameter-recovered.png) | 恢复后图层/属性与实际字段可见，画面未丢失 | 修复定位/恢复后复拍通过 |
| image-edit-region-hosts-parameter-region | [.reality/t119-A3/A-paper19/1440x900-image-edit-region-hosts-parameter-region.png](../../../../.reality/t119-A3/A-paper19/1440x900-image-edit-region-hosts-parameter-region.png) | 目标蒙版/软边/确认或取消状态与源图对应，控件对齐 | 复拍通过 |
| image-edit-region-hosts-parameter-soft-edge | [.reality/t119-A3/A-paper19/1440x900-image-edit-region-hosts-parameter-soft-edge.png](../../../../.reality/t119-A3/A-paper19/1440x900-image-edit-region-hosts-parameter-soft-edge.png) | 目标蒙版/软边/确认或取消状态与源图对应，控件对齐 | 复拍通过 |
| image-edit-region-hosts-parameter-solve-failed | [.reality/t119-A3/A-paper19/1440x900-image-edit-region-hosts-parameter-solve-failed.png](../../../../.reality/t119-A3/A-paper19/1440x900-image-edit-region-hosts-parameter-solve-failed.png) | 预览失败说明、重试与取消入口可见 | 故障注入复拍通过 |
| image-edit-region-hosts | [.reality/t119-A3/A-paper19/1440x900-image-edit-region-hosts.png](../../../../.reality/t119-A3/A-paper19/1440x900-image-edit-region-hosts.png) | 目标作品/宿主可见，工具和面板平铺，对齐正常 | 复拍通过 |
| image-edit-registration-failure-registration-failed | [.reality/t119-A3/A-paper19/1440x900-image-edit-registration-failure-registration-failed.png](../../../../.reality/t119-A3/A-paper19/1440x900-image-edit-registration-failure-registration-failed.png) | 故障说明清楚，保留正式返回命令，可退出后重开 | 修复退出入口后复拍通过 |
| image-edit-registration-failure-registration-recovered | [.reality/t119-A3/A-paper19/1440x900-image-edit-registration-failure-registration-recovered.png](../../../../.reality/t119-A3/A-paper19/1440x900-image-edit-registration-failure-registration-recovered.png) | 恢复后图层/属性与实际字段可见，画面未丢失 | 修复定位/恢复后复拍通过 |
| image-edit-registration-failure | [.reality/t119-A3/A-paper19/1440x900-image-edit-registration-failure.png](../../../../.reality/t119-A3/A-paper19/1440x900-image-edit-registration-failure.png) | 目标作品/宿主可见，工具和面板平铺，对齐正常 | 复拍通过 |
| image-edit-tool-lifecycle-adjustment-layer | [.reality/t119-A3/A-paper19/1440x900-image-edit-tool-lifecycle-adjustment-layer.png](../../../../.reality/t119-A3/A-paper19/1440x900-image-edit-tool-lifecycle-adjustment-layer.png) | 调色层与属性控件可见，层级平铺 | 路径复拍通过 |
| image-edit-tool-lifecycle-annotation-group | [.reality/t119-A3/A-paper19/1440x900-image-edit-tool-lifecycle-annotation-group.png](../../../../.reality/t119-A3/A-paper19/1440x900-image-edit-tool-lifecycle-annotation-group.png) | 工具组菜单宽度正常，文字不竖排，弹窗内菜单可用 | 修复共享触发器/层级后复拍通过 |
| image-edit-tool-lifecycle-ime-text-priority | [.reality/t119-A3/A-paper19/1440x900-image-edit-tool-lifecycle-ime-text-priority.png](../../../../.reality/t119-A3/A-paper19/1440x900-image-edit-tool-lifecycle-ime-text-priority.png) | 文字编辑态可见，文本与工具优先权保留 | 复拍通过；原生 IME 待真人 |
| image-edit-tool-lifecycle-navigation-restored | [.reality/t119-A3/A-paper19/1440x900-image-edit-tool-lifecycle-navigation-restored.png](../../../../.reality/t119-A3/A-paper19/1440x900-image-edit-tool-lifecycle-navigation-restored.png) | 恢复后图层/属性与实际字段可见，画面未丢失 | 修复定位/恢复后复拍通过 |
| image-edit-tool-lifecycle-options-closed | [.reality/t119-A3/A-paper19/1440x900-image-edit-tool-lifecycle-options-closed.png](../../../../.reality/t119-A3/A-paper19/1440x900-image-edit-tool-lifecycle-options-closed.png) | 目标作品/宿主可见，工具和面板平铺，对齐正常 | 复拍通过 |
| image-edit-tool-lifecycle-registered-tools | [.reality/t119-A3/A-paper19/1440x900-image-edit-tool-lifecycle-registered-tools.png](../../../../.reality/t119-A3/A-paper19/1440x900-image-edit-tool-lifecycle-registered-tools.png) | 目标作品/宿主可见，工具和面板平铺，对齐正常 | 复拍通过 |
| image-edit-tool-lifecycle-remove-result | [.reality/t119-A3/A-paper19/1440x900-image-edit-tool-lifecycle-remove-result.png](../../../../.reality/t119-A3/A-paper19/1440x900-image-edit-tool-lifecycle-remove-result.png) | 细小区域移除完成，标签不再竖排；不评价划痕修复 | 路径复拍通过 |
| image-edit-tool-lifecycle-repair-result | [.reality/t119-A3/A-paper19/1440x900-image-edit-tool-lifecycle-repair-result.png](../../../../.reality/t119-A3/A-paper19/1440x900-image-edit-tool-lifecycle-repair-result.png) | 取样修补完成，蓝色小块为夹具结果；不评价融合质量 | 路径复拍通过 |
| image-edit-tool-lifecycle-selection-cancelled | [.reality/t119-A3/A-paper19/1440x900-image-edit-tool-lifecycle-selection-cancelled.png](../../../../.reality/t119-A3/A-paper19/1440x900-image-edit-tool-lifecycle-selection-cancelled.png) | 取消后草稿清除，工作面与导航恢复 | 复拍通过 |
| image-edit-tool-lifecycle-selection-draft | [.reality/t119-A3/A-paper19/1440x900-image-edit-tool-lifecycle-selection-draft.png](../../../../.reality/t119-A3/A-paper19/1440x900-image-edit-tool-lifecycle-selection-draft.png) | 矩形选区草稿与选项清晰，画面完整 | 复拍通过 |
| image-edit-tool-lifecycle-selection-group | [.reality/t119-A3/A-paper19/1440x900-image-edit-tool-lifecycle-selection-group.png](../../../../.reality/t119-A3/A-paper19/1440x900-image-edit-tool-lifecycle-selection-group.png) | 工具组菜单宽度正常，文字不竖排，弹窗内菜单可用 | 修复共享触发器/层级后复拍通过 |
| image-edit-tool-lifecycle-subject-result | [.reality/t119-A3/A-paper19/1440x900-image-edit-tool-lifecycle-subject-result.png](../../../../.reality/t119-A3/A-paper19/1440x900-image-edit-tool-lifecycle-subject-result.png) | 主体选区覆盖人像；边缘质量仍需真人判断 | 路径复拍通过 |
| image-edit-tool-lifecycle-temporary-hand | [.reality/t119-A3/A-paper19/1440x900-image-edit-tool-lifecycle-temporary-hand.png](../../../../.reality/t119-A3/A-paper19/1440x900-image-edit-tool-lifecycle-temporary-hand.png) | 临时导航工具高亮与对应选项正常 | 复拍通过 |
| image-edit-tool-lifecycle-temporary-zoom | [.reality/t119-A3/A-paper19/1440x900-image-edit-tool-lifecycle-temporary-zoom.png](../../../../.reality/t119-A3/A-paper19/1440x900-image-edit-tool-lifecycle-temporary-zoom.png) | 临时导航工具高亮与对应选项正常 | 复拍通过 |
| image-edit-tool-lifecycle-text-cancelled | [.reality/t119-A3/A-paper19/1440x900-image-edit-tool-lifecycle-text-cancelled.png](../../../../.reality/t119-A3/A-paper19/1440x900-image-edit-tool-lifecycle-text-cancelled.png) | 取消后草稿清除，工作面与导航恢复 | 复拍通过 |
| image-edit-tool-lifecycle | [.reality/t119-A3/A-paper19/1440x900-image-edit-tool-lifecycle.png](../../../../.reality/t119-A3/A-paper19/1440x900-image-edit-tool-lifecycle.png) | 目标作品/宿主可见，工具和面板平铺，对齐正常 | 复拍通过 |
| image-editor-v3-release-move-baseline | [.reality/t119-A3/A-paper19/1440x900-image-editor-v3-release-move-baseline.png](../../../../.reality/t119-A3/A-paper19/1440x900-image-editor-v3-release-move-baseline.png) | 目标作品/宿主可见，工具和面板平铺，对齐正常 | 复拍通过 |
| image-editor-v3-release-properties-floating | [.reality/t119-A3/A-paper19/1440x900-image-editor-v3-release-properties-floating.png](../../../../.reality/t119-A3/A-paper19/1440x900-image-editor-v3-release-properties-floating.png) | 浮动面板标签与参数可见，遮挡符合用户主动位置 | 复拍通过 |
| image-editor-v3-release | [.reality/t119-A3/A-paper19/1440x900-image-editor-v3-release.png](../../../../.reality/t119-A3/A-paper19/1440x900-image-editor-v3-release.png) | 裁剪工具和比例入口完整，作品与图层可见 | 复拍通过 |
| toolbox-image-edit-vgpu-glow | [.reality/t119-A3/A-paper19/1440x900-toolbox-image-edit-vgpu-glow.png](../../../../.reality/t119-A3/A-paper19/1440x900-toolbox-image-edit-vgpu-glow.png) | 辉光结果及参数可见，效果层不可移动提示为任务文案 | 复拍通过 |
| toolbox-image-edit | [.reality/t119-A3/A-paper19/1440x900-toolbox-image-edit.png](../../../../.reality/t119-A3/A-paper19/1440x900-toolbox-image-edit.png) | 空态清晰，拖入说明只出现一次 | 删除重复文案后复拍通过 |

#### narrow19

| 场景/状态 | 路径 | 目视结论 | 复拍结果 |
| --- | --- | --- | --- |
| image-edit-docking-toolbox-collapsed | [.reality/t119-A3/narrow19/graphite/960x640-image-edit-docking-toolbox-collapsed.png](../../../../.reality/t119-A3/narrow19/graphite/960x640-image-edit-docking-toolbox-collapsed.png) | 折叠后仅保留标签与操作，中央作品可见 | 复拍通过 |
| image-edit-docking-toolbox-default | [.reality/t119-A3/narrow19/graphite/960x640-image-edit-docking-toolbox-default.png](../../../../.reality/t119-A3/narrow19/graphite/960x640-image-edit-docking-toolbox-default.png) | 目标作品/宿主可见，工具和面板平铺，对齐正常 | 复拍通过 |
| image-edit-docking-toolbox-empty | [.reality/t119-A3/narrow19/graphite/960x640-image-edit-docking-toolbox-empty.png](../../../../.reality/t119-A3/narrow19/graphite/960x640-image-edit-docking-toolbox-empty.png) | 空态清晰，拖入说明只出现一次 | 删除重复文案后复拍通过 |
| image-edit-docking-toolbox-floating | [.reality/t119-A3/narrow19/graphite/960x640-image-edit-docking-toolbox-floating.png](../../../../.reality/t119-A3/narrow19/graphite/960x640-image-edit-docking-toolbox-floating.png) | 浮动面板标签与参数可见，遮挡符合用户主动位置 | 复拍通过 |
| image-edit-docking-toolbox-panels-hidden | [.reality/t119-A3/narrow19/graphite/960x640-image-edit-docking-toolbox-panels-hidden.png](../../../../.reality/t119-A3/narrow19/graphite/960x640-image-edit-docking-toolbox-panels-hidden.png) | 面板隐藏，工具与作品保持可用 | 复拍通过 |
| image-edit-docking-toolbox-reopened | [.reality/t119-A3/narrow19/graphite/960x640-image-edit-docking-toolbox-reopened.png](../../../../.reality/t119-A3/narrow19/graphite/960x640-image-edit-docking-toolbox-reopened.png) | 重开保留目标布局/作品或正式回填结果 | 复拍通过 |
| image-edit-docking-toolbox-resized | [.reality/t119-A3/narrow19/graphite/960x640-image-edit-docking-toolbox-resized.png](../../../../.reality/t119-A3/narrow19/graphite/960x640-image-edit-docking-toolbox-resized.png) | 尺寸实际改变，内容沿既有滚动容器可达 | 修复指针冒泡后复拍通过 |
| image-edit-docking-toolbox-restored | [.reality/t119-A3/narrow19/graphite/960x640-image-edit-docking-toolbox-restored.png](../../../../.reality/t119-A3/narrow19/graphite/960x640-image-edit-docking-toolbox-restored.png) | 恢复后图层/属性与实际字段可见，画面未丢失 | 修复定位/恢复后复拍通过 |
| image-edit-docking-toolbox-tabs | [.reality/t119-A3/narrow19/graphite/960x640-image-edit-docking-toolbox-tabs.png](../../../../.reality/t119-A3/narrow19/graphite/960x640-image-edit-docking-toolbox-tabs.png) | 同组标签清晰，活动图层正常，另一标签可切换 | 复拍通过 |
| image-edit-quick-mark-viewer-quick-arrow | [.reality/t119-A3/narrow19/graphite/960x640-image-edit-quick-mark-viewer-quick-arrow.png](../../../../.reality/t119-A3/narrow19/graphite/960x640-image-edit-quick-mark-viewer-quick-arrow.png) | 实际箭头及图层可见，保存/关闭已翻译 | 复拍通过 |
| image-edit-quick-mark-viewer-quick-crop | [.reality/t119-A3/narrow19/graphite/960x640-image-edit-quick-mark-viewer-quick-crop.png](../../../../.reality/t119-A3/narrow19/graphite/960x640-image-edit-quick-mark-viewer-quick-crop.png) | 裁剪工具和比例入口完整，作品与图层可见 | 复拍通过 |
| image-edit-quick-mark-viewer-quick-default | [.reality/t119-A3/narrow19/graphite/960x640-image-edit-quick-mark-viewer-quick-default.png](../../../../.reality/t119-A3/narrow19/graphite/960x640-image-edit-quick-mark-viewer-quick-default.png) | 查看器或快速编辑源画面完整，文案已翻译 | 复拍通过 |
| image-edit-quick-mark-viewer-quick-returned-to-viewer | [.reality/t119-A3/narrow19/graphite/960x640-image-edit-quick-mark-viewer-quick-returned-to-viewer.png](../../../../.reality/t119-A3/narrow19/graphite/960x640-image-edit-quick-mark-viewer-quick-returned-to-viewer.png) | 查看器或快速编辑源画面完整，文案已翻译 | 复拍通过 |
| image-edit-quick-mark-viewer-viewer | [.reality/t119-A3/narrow19/graphite/960x640-image-edit-quick-mark-viewer-viewer.png](../../../../.reality/t119-A3/narrow19/graphite/960x640-image-edit-quick-mark-viewer-viewer.png) | 查看器或快速编辑源画面完整，文案已翻译 | 复拍通过 |
| image-edit-quick-mark-viewer | [.reality/t119-A3/narrow19/graphite/960x640-image-edit-quick-mark-viewer.png](../../../../.reality/t119-A3/narrow19/graphite/960x640-image-edit-quick-mark-viewer.png) | 查看器或快速编辑源画面完整，文案已翻译 | 复拍通过 |
| image-editor-v3-release | [.reality/t119-A3/narrow19/graphite/960x640-image-editor-v3-release.png](../../../../.reality/t119-A3/narrow19/graphite/960x640-image-editor-v3-release.png) | 裁剪工具和比例入口完整，作品与图层可见 | 复拍通过 |
| image-edit-docking-canvas-collapsed | [.reality/t119-A3/narrow19/graphite/960x640-image-edit-docking-canvas-collapsed.png](../../../../.reality/t119-A3/narrow19/graphite/960x640-image-edit-docking-canvas-collapsed.png) | 折叠后仅保留标签与操作，中央作品可见 | 复拍通过 |
| image-edit-docking-canvas-default | [.reality/t119-A3/narrow19/graphite/960x640-image-edit-docking-canvas-default.png](../../../../.reality/t119-A3/narrow19/graphite/960x640-image-edit-docking-canvas-default.png) | 目标作品/宿主可见，工具和面板平铺，对齐正常 | 复拍通过 |
| image-edit-docking-canvas-floating | [.reality/t119-A3/narrow19/graphite/960x640-image-edit-docking-canvas-floating.png](../../../../.reality/t119-A3/narrow19/graphite/960x640-image-edit-docking-canvas-floating.png) | 浮动面板标签与参数可见，遮挡符合用户主动位置 | 复拍通过 |
| image-edit-docking-canvas-panels-hidden | [.reality/t119-A3/narrow19/graphite/960x640-image-edit-docking-canvas-panels-hidden.png](../../../../.reality/t119-A3/narrow19/graphite/960x640-image-edit-docking-canvas-panels-hidden.png) | 面板隐藏，工具与作品保持可用 | 复拍通过 |
| image-edit-docking-canvas-reopened | [.reality/t119-A3/narrow19/graphite/960x640-image-edit-docking-canvas-reopened.png](../../../../.reality/t119-A3/narrow19/graphite/960x640-image-edit-docking-canvas-reopened.png) | 重开保留目标布局/作品或正式回填结果 | 复拍通过 |
| image-edit-docking-canvas-resized | [.reality/t119-A3/narrow19/graphite/960x640-image-edit-docking-canvas-resized.png](../../../../.reality/t119-A3/narrow19/graphite/960x640-image-edit-docking-canvas-resized.png) | 尺寸实际改变，内容沿既有滚动容器可达 | 修复指针冒泡后复拍通过 |
| image-edit-docking-canvas-restored | [.reality/t119-A3/narrow19/graphite/960x640-image-edit-docking-canvas-restored.png](../../../../.reality/t119-A3/narrow19/graphite/960x640-image-edit-docking-canvas-restored.png) | 恢复后图层/属性与实际字段可见，画面未丢失 | 修复定位/恢复后复拍通过 |
| image-edit-docking-canvas-tabs | [.reality/t119-A3/narrow19/graphite/960x640-image-edit-docking-canvas-tabs.png](../../../../.reality/t119-A3/narrow19/graphite/960x640-image-edit-docking-canvas-tabs.png) | 同组标签清晰，活动图层正常，另一标签可切换 | 复拍通过 |
| image-edit-tool-lifecycle-adjustment-layer | [.reality/t119-A3/narrow19/graphite/960x640-image-edit-tool-lifecycle-adjustment-layer.png](../../../../.reality/t119-A3/narrow19/graphite/960x640-image-edit-tool-lifecycle-adjustment-layer.png) | 调色层与属性控件可见，层级平铺 | 路径复拍通过 |
| image-edit-tool-lifecycle-annotation-group | [.reality/t119-A3/narrow19/graphite/960x640-image-edit-tool-lifecycle-annotation-group.png](../../../../.reality/t119-A3/narrow19/graphite/960x640-image-edit-tool-lifecycle-annotation-group.png) | 工具组菜单宽度正常，文字不竖排，弹窗内菜单可用 | 修复共享触发器/层级后复拍通过 |
| image-edit-tool-lifecycle-ime-text-priority | [.reality/t119-A3/narrow19/graphite/960x640-image-edit-tool-lifecycle-ime-text-priority.png](../../../../.reality/t119-A3/narrow19/graphite/960x640-image-edit-tool-lifecycle-ime-text-priority.png) | 文字编辑态可见，文本与工具优先权保留 | 复拍通过；原生 IME 待真人 |
| image-edit-tool-lifecycle-navigation-restored | [.reality/t119-A3/narrow19/graphite/960x640-image-edit-tool-lifecycle-navigation-restored.png](../../../../.reality/t119-A3/narrow19/graphite/960x640-image-edit-tool-lifecycle-navigation-restored.png) | 恢复后图层/属性与实际字段可见，画面未丢失 | 修复定位/恢复后复拍通过 |
| image-edit-tool-lifecycle-options-closed | [.reality/t119-A3/narrow19/graphite/960x640-image-edit-tool-lifecycle-options-closed.png](../../../../.reality/t119-A3/narrow19/graphite/960x640-image-edit-tool-lifecycle-options-closed.png) | 目标作品/宿主可见，工具和面板平铺，对齐正常 | 复拍通过 |
| image-edit-tool-lifecycle-registered-tools | [.reality/t119-A3/narrow19/graphite/960x640-image-edit-tool-lifecycle-registered-tools.png](../../../../.reality/t119-A3/narrow19/graphite/960x640-image-edit-tool-lifecycle-registered-tools.png) | 目标作品/宿主可见，工具和面板平铺，对齐正常 | 复拍通过 |
| image-edit-tool-lifecycle-remove-result | [.reality/t119-A3/narrow19/graphite/960x640-image-edit-tool-lifecycle-remove-result.png](../../../../.reality/t119-A3/narrow19/graphite/960x640-image-edit-tool-lifecycle-remove-result.png) | 细小区域移除完成，标签不再竖排；不评价划痕修复 | 路径复拍通过 |
| image-edit-tool-lifecycle-repair-result | [.reality/t119-A3/narrow19/graphite/960x640-image-edit-tool-lifecycle-repair-result.png](../../../../.reality/t119-A3/narrow19/graphite/960x640-image-edit-tool-lifecycle-repair-result.png) | 取样修补完成，蓝色小块为夹具结果；不评价融合质量 | 路径复拍通过 |
| image-edit-tool-lifecycle-selection-cancelled | [.reality/t119-A3/narrow19/graphite/960x640-image-edit-tool-lifecycle-selection-cancelled.png](../../../../.reality/t119-A3/narrow19/graphite/960x640-image-edit-tool-lifecycle-selection-cancelled.png) | 取消后草稿清除，工作面与导航恢复 | 复拍通过 |
| image-edit-tool-lifecycle-selection-draft | [.reality/t119-A3/narrow19/graphite/960x640-image-edit-tool-lifecycle-selection-draft.png](../../../../.reality/t119-A3/narrow19/graphite/960x640-image-edit-tool-lifecycle-selection-draft.png) | 矩形选区草稿与选项清晰，画面完整 | 复拍通过 |
| image-edit-tool-lifecycle-selection-group | [.reality/t119-A3/narrow19/graphite/960x640-image-edit-tool-lifecycle-selection-group.png](../../../../.reality/t119-A3/narrow19/graphite/960x640-image-edit-tool-lifecycle-selection-group.png) | 工具组菜单宽度正常，文字不竖排，弹窗内菜单可用 | 修复共享触发器/层级后复拍通过 |
| image-edit-tool-lifecycle-subject-result | [.reality/t119-A3/narrow19/graphite/960x640-image-edit-tool-lifecycle-subject-result.png](../../../../.reality/t119-A3/narrow19/graphite/960x640-image-edit-tool-lifecycle-subject-result.png) | 主体选区覆盖人像；边缘质量仍需真人判断 | 路径复拍通过 |
| image-edit-tool-lifecycle-temporary-hand | [.reality/t119-A3/narrow19/graphite/960x640-image-edit-tool-lifecycle-temporary-hand.png](../../../../.reality/t119-A3/narrow19/graphite/960x640-image-edit-tool-lifecycle-temporary-hand.png) | 临时导航工具高亮与对应选项正常 | 复拍通过 |
| image-edit-tool-lifecycle-temporary-zoom | [.reality/t119-A3/narrow19/graphite/960x640-image-edit-tool-lifecycle-temporary-zoom.png](../../../../.reality/t119-A3/narrow19/graphite/960x640-image-edit-tool-lifecycle-temporary-zoom.png) | 临时导航工具高亮与对应选项正常 | 复拍通过 |
| image-edit-tool-lifecycle-text-cancelled | [.reality/t119-A3/narrow19/graphite/960x640-image-edit-tool-lifecycle-text-cancelled.png](../../../../.reality/t119-A3/narrow19/graphite/960x640-image-edit-tool-lifecycle-text-cancelled.png) | 取消后草稿清除，工作面与导航恢复 | 复拍通过 |
| image-edit-tool-lifecycle | [.reality/t119-A3/narrow19/graphite/960x640-image-edit-tool-lifecycle.png](../../../../.reality/t119-A3/narrow19/graphite/960x640-image-edit-tool-lifecycle.png) | 目标作品/宿主可见，工具和面板平铺，对齐正常 | 复拍通过 |
| image-edit-docking | [.reality/t119-A3/narrow19/graphite/960x640-image-edit-docking.png](../../../../.reality/t119-A3/narrow19/graphite/960x640-image-edit-docking.png) | 目标作品/宿主可见，工具和面板平铺，对齐正常 | 复拍通过 |
| image-edit-layout-failure-layout-load-failed | [.reality/t119-A3/narrow19/graphite/960x640-image-edit-layout-failure-layout-load-failed.png](../../../../.reality/t119-A3/narrow19/graphite/960x640-image-edit-layout-failure-layout-load-failed.png) | 布局失败提示可读，作品仍可见，恢复入口可用 | 故障注入复拍通过 |
| image-edit-layout-failure-layout-load-recovered | [.reality/t119-A3/narrow19/graphite/960x640-image-edit-layout-failure-layout-load-recovered.png](../../../../.reality/t119-A3/narrow19/graphite/960x640-image-edit-layout-failure-layout-load-recovered.png) | 恢复后图层/属性与实际字段可见，画面未丢失 | 修复定位/恢复后复拍通过 |
| image-edit-layout-failure-layout-save-failed | [.reality/t119-A3/narrow19/graphite/960x640-image-edit-layout-failure-layout-save-failed.png](../../../../.reality/t119-A3/narrow19/graphite/960x640-image-edit-layout-failure-layout-save-failed.png) | 布局失败提示可读，作品仍可见，恢复入口可用 | 故障注入复拍通过 |
| image-edit-layout-failure-layout-save-recovered | [.reality/t119-A3/narrow19/graphite/960x640-image-edit-layout-failure-layout-save-recovered.png](../../../../.reality/t119-A3/narrow19/graphite/960x640-image-edit-layout-failure-layout-save-recovered.png) | 恢复后图层/属性与实际字段可见，画面未丢失 | 修复定位/恢复后复拍通过 |
| image-edit-layout-failure | [.reality/t119-A3/narrow19/graphite/960x640-image-edit-layout-failure.png](../../../../.reality/t119-A3/narrow19/graphite/960x640-image-edit-layout-failure.png) | 目标作品/宿主可见，工具和面板平铺，对齐正常 | 复拍通过 |
| image-edit-registration-failure-registration-failed | [.reality/t119-A3/narrow19/graphite/960x640-image-edit-registration-failure-registration-failed.png](../../../../.reality/t119-A3/narrow19/graphite/960x640-image-edit-registration-failure-registration-failed.png) | 故障说明清楚，保留正式返回命令，可退出后重开 | 修复退出入口后复拍通过 |
| image-edit-registration-failure-registration-recovered | [.reality/t119-A3/narrow19/graphite/960x640-image-edit-registration-failure-registration-recovered.png](../../../../.reality/t119-A3/narrow19/graphite/960x640-image-edit-registration-failure-registration-recovered.png) | 恢复后图层/属性与实际字段可见，画面未丢失 | 修复定位/恢复后复拍通过 |
| image-edit-registration-failure | [.reality/t119-A3/narrow19/graphite/960x640-image-edit-registration-failure.png](../../../../.reality/t119-A3/narrow19/graphite/960x640-image-edit-registration-failure.png) | 目标作品/宿主可见，工具和面板平铺，对齐正常 | 复拍通过 |
| image-editor-v3-release-move-baseline | [.reality/t119-A3/narrow19/graphite/960x640-image-editor-v3-release-move-baseline.png](../../../../.reality/t119-A3/narrow19/graphite/960x640-image-editor-v3-release-move-baseline.png) | 目标作品/宿主可见，工具和面板平铺，对齐正常 | 复拍通过 |
| image-editor-v3-release-properties-floating | [.reality/t119-A3/narrow19/graphite/960x640-image-editor-v3-release-properties-floating.png](../../../../.reality/t119-A3/narrow19/graphite/960x640-image-editor-v3-release-properties-floating.png) | 浮动面板标签与参数可见，遮挡符合用户主动位置 | 复拍通过 |
| image-edit-docking-canvas-collapsed | [.reality/t119-A3/narrow19/paper/960x640-image-edit-docking-canvas-collapsed.png](../../../../.reality/t119-A3/narrow19/paper/960x640-image-edit-docking-canvas-collapsed.png) | 折叠后仅保留标签与操作，中央作品可见 | 复拍通过 |
| image-edit-docking-canvas-default | [.reality/t119-A3/narrow19/paper/960x640-image-edit-docking-canvas-default.png](../../../../.reality/t119-A3/narrow19/paper/960x640-image-edit-docking-canvas-default.png) | 目标作品/宿主可见，工具和面板平铺，对齐正常 | 复拍通过 |
| image-edit-docking-canvas-floating | [.reality/t119-A3/narrow19/paper/960x640-image-edit-docking-canvas-floating.png](../../../../.reality/t119-A3/narrow19/paper/960x640-image-edit-docking-canvas-floating.png) | 浮动面板标签与参数可见，遮挡符合用户主动位置 | 复拍通过 |
| image-edit-docking-canvas-panels-hidden | [.reality/t119-A3/narrow19/paper/960x640-image-edit-docking-canvas-panels-hidden.png](../../../../.reality/t119-A3/narrow19/paper/960x640-image-edit-docking-canvas-panels-hidden.png) | 面板隐藏，工具与作品保持可用 | 复拍通过 |
| image-edit-docking-canvas-reopened | [.reality/t119-A3/narrow19/paper/960x640-image-edit-docking-canvas-reopened.png](../../../../.reality/t119-A3/narrow19/paper/960x640-image-edit-docking-canvas-reopened.png) | 重开保留目标布局/作品或正式回填结果 | 复拍通过 |
| image-edit-docking-canvas-resized | [.reality/t119-A3/narrow19/paper/960x640-image-edit-docking-canvas-resized.png](../../../../.reality/t119-A3/narrow19/paper/960x640-image-edit-docking-canvas-resized.png) | 尺寸实际改变，内容沿既有滚动容器可达 | 修复指针冒泡后复拍通过 |
| image-edit-docking-canvas-restored | [.reality/t119-A3/narrow19/paper/960x640-image-edit-docking-canvas-restored.png](../../../../.reality/t119-A3/narrow19/paper/960x640-image-edit-docking-canvas-restored.png) | 恢复后图层/属性与实际字段可见，画面未丢失 | 修复定位/恢复后复拍通过 |
| image-edit-docking-canvas-tabs | [.reality/t119-A3/narrow19/paper/960x640-image-edit-docking-canvas-tabs.png](../../../../.reality/t119-A3/narrow19/paper/960x640-image-edit-docking-canvas-tabs.png) | 同组标签清晰，活动图层正常，另一标签可切换 | 复拍通过 |
| image-edit-docking-toolbox-collapsed | [.reality/t119-A3/narrow19/paper/960x640-image-edit-docking-toolbox-collapsed.png](../../../../.reality/t119-A3/narrow19/paper/960x640-image-edit-docking-toolbox-collapsed.png) | 折叠后仅保留标签与操作，中央作品可见 | 复拍通过 |
| image-edit-docking-toolbox-default | [.reality/t119-A3/narrow19/paper/960x640-image-edit-docking-toolbox-default.png](../../../../.reality/t119-A3/narrow19/paper/960x640-image-edit-docking-toolbox-default.png) | 目标作品/宿主可见，工具和面板平铺，对齐正常 | 复拍通过 |
| image-edit-docking-toolbox-empty | [.reality/t119-A3/narrow19/paper/960x640-image-edit-docking-toolbox-empty.png](../../../../.reality/t119-A3/narrow19/paper/960x640-image-edit-docking-toolbox-empty.png) | 空态清晰，拖入说明只出现一次 | 删除重复文案后复拍通过 |
| image-edit-docking-toolbox-floating | [.reality/t119-A3/narrow19/paper/960x640-image-edit-docking-toolbox-floating.png](../../../../.reality/t119-A3/narrow19/paper/960x640-image-edit-docking-toolbox-floating.png) | 浮动面板标签与参数可见，遮挡符合用户主动位置 | 复拍通过 |
| image-edit-docking-toolbox-panels-hidden | [.reality/t119-A3/narrow19/paper/960x640-image-edit-docking-toolbox-panels-hidden.png](../../../../.reality/t119-A3/narrow19/paper/960x640-image-edit-docking-toolbox-panels-hidden.png) | 面板隐藏，工具与作品保持可用 | 复拍通过 |
| image-edit-docking-toolbox-reopened | [.reality/t119-A3/narrow19/paper/960x640-image-edit-docking-toolbox-reopened.png](../../../../.reality/t119-A3/narrow19/paper/960x640-image-edit-docking-toolbox-reopened.png) | 重开保留目标布局/作品或正式回填结果 | 复拍通过 |
| image-edit-docking-toolbox-resized | [.reality/t119-A3/narrow19/paper/960x640-image-edit-docking-toolbox-resized.png](../../../../.reality/t119-A3/narrow19/paper/960x640-image-edit-docking-toolbox-resized.png) | 尺寸实际改变，内容沿既有滚动容器可达 | 修复指针冒泡后复拍通过 |
| image-edit-docking-toolbox-restored | [.reality/t119-A3/narrow19/paper/960x640-image-edit-docking-toolbox-restored.png](../../../../.reality/t119-A3/narrow19/paper/960x640-image-edit-docking-toolbox-restored.png) | 恢复后图层/属性与实际字段可见，画面未丢失 | 修复定位/恢复后复拍通过 |
| image-edit-docking-toolbox-tabs | [.reality/t119-A3/narrow19/paper/960x640-image-edit-docking-toolbox-tabs.png](../../../../.reality/t119-A3/narrow19/paper/960x640-image-edit-docking-toolbox-tabs.png) | 同组标签清晰，活动图层正常，另一标签可切换 | 复拍通过 |
| image-edit-docking | [.reality/t119-A3/narrow19/paper/960x640-image-edit-docking.png](../../../../.reality/t119-A3/narrow19/paper/960x640-image-edit-docking.png) | 目标作品/宿主可见，工具和面板平铺，对齐正常 | 复拍通过 |
| image-edit-layout-failure-layout-load-failed | [.reality/t119-A3/narrow19/paper/960x640-image-edit-layout-failure-layout-load-failed.png](../../../../.reality/t119-A3/narrow19/paper/960x640-image-edit-layout-failure-layout-load-failed.png) | 布局失败提示可读，作品仍可见，恢复入口可用 | 故障注入复拍通过 |
| image-edit-layout-failure-layout-load-recovered | [.reality/t119-A3/narrow19/paper/960x640-image-edit-layout-failure-layout-load-recovered.png](../../../../.reality/t119-A3/narrow19/paper/960x640-image-edit-layout-failure-layout-load-recovered.png) | 恢复后图层/属性与实际字段可见，画面未丢失 | 修复定位/恢复后复拍通过 |
| image-edit-layout-failure-layout-save-failed | [.reality/t119-A3/narrow19/paper/960x640-image-edit-layout-failure-layout-save-failed.png](../../../../.reality/t119-A3/narrow19/paper/960x640-image-edit-layout-failure-layout-save-failed.png) | 布局失败提示可读，作品仍可见，恢复入口可用 | 故障注入复拍通过 |
| image-edit-layout-failure-layout-save-recovered | [.reality/t119-A3/narrow19/paper/960x640-image-edit-layout-failure-layout-save-recovered.png](../../../../.reality/t119-A3/narrow19/paper/960x640-image-edit-layout-failure-layout-save-recovered.png) | 恢复后图层/属性与实际字段可见，画面未丢失 | 修复定位/恢复后复拍通过 |
| image-edit-layout-failure | [.reality/t119-A3/narrow19/paper/960x640-image-edit-layout-failure.png](../../../../.reality/t119-A3/narrow19/paper/960x640-image-edit-layout-failure.png) | 目标作品/宿主可见，工具和面板平铺，对齐正常 | 复拍通过 |
| image-edit-quick-mark-viewer-quick-arrow | [.reality/t119-A3/narrow19/paper/960x640-image-edit-quick-mark-viewer-quick-arrow.png](../../../../.reality/t119-A3/narrow19/paper/960x640-image-edit-quick-mark-viewer-quick-arrow.png) | 实际箭头及图层可见，保存/关闭已翻译 | 复拍通过 |
| image-edit-quick-mark-viewer-quick-crop | [.reality/t119-A3/narrow19/paper/960x640-image-edit-quick-mark-viewer-quick-crop.png](../../../../.reality/t119-A3/narrow19/paper/960x640-image-edit-quick-mark-viewer-quick-crop.png) | 裁剪工具和比例入口完整，作品与图层可见 | 复拍通过 |
| image-edit-quick-mark-viewer-quick-default | [.reality/t119-A3/narrow19/paper/960x640-image-edit-quick-mark-viewer-quick-default.png](../../../../.reality/t119-A3/narrow19/paper/960x640-image-edit-quick-mark-viewer-quick-default.png) | 查看器或快速编辑源画面完整，文案已翻译 | 复拍通过 |
| image-edit-quick-mark-viewer-quick-returned-to-viewer | [.reality/t119-A3/narrow19/paper/960x640-image-edit-quick-mark-viewer-quick-returned-to-viewer.png](../../../../.reality/t119-A3/narrow19/paper/960x640-image-edit-quick-mark-viewer-quick-returned-to-viewer.png) | 查看器或快速编辑源画面完整，文案已翻译 | 复拍通过 |
| image-edit-quick-mark-viewer-viewer | [.reality/t119-A3/narrow19/paper/960x640-image-edit-quick-mark-viewer-viewer.png](../../../../.reality/t119-A3/narrow19/paper/960x640-image-edit-quick-mark-viewer-viewer.png) | 查看器或快速编辑源画面完整，文案已翻译 | 复拍通过 |
| image-edit-quick-mark-viewer | [.reality/t119-A3/narrow19/paper/960x640-image-edit-quick-mark-viewer.png](../../../../.reality/t119-A3/narrow19/paper/960x640-image-edit-quick-mark-viewer.png) | 查看器或快速编辑源画面完整，文案已翻译 | 复拍通过 |
| image-edit-registration-failure-registration-failed | [.reality/t119-A3/narrow19/paper/960x640-image-edit-registration-failure-registration-failed.png](../../../../.reality/t119-A3/narrow19/paper/960x640-image-edit-registration-failure-registration-failed.png) | 故障说明清楚，保留正式返回命令，可退出后重开 | 修复退出入口后复拍通过 |
| image-edit-registration-failure-registration-recovered | [.reality/t119-A3/narrow19/paper/960x640-image-edit-registration-failure-registration-recovered.png](../../../../.reality/t119-A3/narrow19/paper/960x640-image-edit-registration-failure-registration-recovered.png) | 恢复后图层/属性与实际字段可见，画面未丢失 | 修复定位/恢复后复拍通过 |
| image-edit-registration-failure | [.reality/t119-A3/narrow19/paper/960x640-image-edit-registration-failure.png](../../../../.reality/t119-A3/narrow19/paper/960x640-image-edit-registration-failure.png) | 目标作品/宿主可见，工具和面板平铺，对齐正常 | 复拍通过 |
| image-edit-tool-lifecycle-adjustment-layer | [.reality/t119-A3/narrow19/paper/960x640-image-edit-tool-lifecycle-adjustment-layer.png](../../../../.reality/t119-A3/narrow19/paper/960x640-image-edit-tool-lifecycle-adjustment-layer.png) | 调色层与属性控件可见，层级平铺 | 路径复拍通过 |
| image-edit-tool-lifecycle-annotation-group | [.reality/t119-A3/narrow19/paper/960x640-image-edit-tool-lifecycle-annotation-group.png](../../../../.reality/t119-A3/narrow19/paper/960x640-image-edit-tool-lifecycle-annotation-group.png) | 工具组菜单宽度正常，文字不竖排，弹窗内菜单可用 | 修复共享触发器/层级后复拍通过 |
| image-edit-tool-lifecycle-ime-text-priority | [.reality/t119-A3/narrow19/paper/960x640-image-edit-tool-lifecycle-ime-text-priority.png](../../../../.reality/t119-A3/narrow19/paper/960x640-image-edit-tool-lifecycle-ime-text-priority.png) | 文字编辑态可见，文本与工具优先权保留 | 复拍通过；原生 IME 待真人 |
| image-edit-tool-lifecycle-navigation-restored | [.reality/t119-A3/narrow19/paper/960x640-image-edit-tool-lifecycle-navigation-restored.png](../../../../.reality/t119-A3/narrow19/paper/960x640-image-edit-tool-lifecycle-navigation-restored.png) | 恢复后图层/属性与实际字段可见，画面未丢失 | 修复定位/恢复后复拍通过 |
| image-edit-tool-lifecycle-options-closed | [.reality/t119-A3/narrow19/paper/960x640-image-edit-tool-lifecycle-options-closed.png](../../../../.reality/t119-A3/narrow19/paper/960x640-image-edit-tool-lifecycle-options-closed.png) | 目标作品/宿主可见，工具和面板平铺，对齐正常 | 复拍通过 |
| image-edit-tool-lifecycle-registered-tools | [.reality/t119-A3/narrow19/paper/960x640-image-edit-tool-lifecycle-registered-tools.png](../../../../.reality/t119-A3/narrow19/paper/960x640-image-edit-tool-lifecycle-registered-tools.png) | 目标作品/宿主可见，工具和面板平铺，对齐正常 | 复拍通过 |
| image-edit-tool-lifecycle-remove-result | [.reality/t119-A3/narrow19/paper/960x640-image-edit-tool-lifecycle-remove-result.png](../../../../.reality/t119-A3/narrow19/paper/960x640-image-edit-tool-lifecycle-remove-result.png) | 细小区域移除完成，标签不再竖排；不评价划痕修复 | 路径复拍通过 |
| image-edit-tool-lifecycle-repair-result | [.reality/t119-A3/narrow19/paper/960x640-image-edit-tool-lifecycle-repair-result.png](../../../../.reality/t119-A3/narrow19/paper/960x640-image-edit-tool-lifecycle-repair-result.png) | 取样修补完成，蓝色小块为夹具结果；不评价融合质量 | 路径复拍通过 |
| image-edit-tool-lifecycle-selection-cancelled | [.reality/t119-A3/narrow19/paper/960x640-image-edit-tool-lifecycle-selection-cancelled.png](../../../../.reality/t119-A3/narrow19/paper/960x640-image-edit-tool-lifecycle-selection-cancelled.png) | 取消后草稿清除，工作面与导航恢复 | 复拍通过 |
| image-edit-tool-lifecycle-selection-draft | [.reality/t119-A3/narrow19/paper/960x640-image-edit-tool-lifecycle-selection-draft.png](../../../../.reality/t119-A3/narrow19/paper/960x640-image-edit-tool-lifecycle-selection-draft.png) | 矩形选区草稿与选项清晰，画面完整 | 复拍通过 |
| image-edit-tool-lifecycle-selection-group | [.reality/t119-A3/narrow19/paper/960x640-image-edit-tool-lifecycle-selection-group.png](../../../../.reality/t119-A3/narrow19/paper/960x640-image-edit-tool-lifecycle-selection-group.png) | 工具组菜单宽度正常，文字不竖排，弹窗内菜单可用 | 修复共享触发器/层级后复拍通过 |
| image-edit-tool-lifecycle-subject-result | [.reality/t119-A3/narrow19/paper/960x640-image-edit-tool-lifecycle-subject-result.png](../../../../.reality/t119-A3/narrow19/paper/960x640-image-edit-tool-lifecycle-subject-result.png) | 主体选区覆盖人像；边缘质量仍需真人判断 | 路径复拍通过 |
| image-edit-tool-lifecycle-temporary-hand | [.reality/t119-A3/narrow19/paper/960x640-image-edit-tool-lifecycle-temporary-hand.png](../../../../.reality/t119-A3/narrow19/paper/960x640-image-edit-tool-lifecycle-temporary-hand.png) | 临时导航工具高亮与对应选项正常 | 复拍通过 |
| image-edit-tool-lifecycle-temporary-zoom | [.reality/t119-A3/narrow19/paper/960x640-image-edit-tool-lifecycle-temporary-zoom.png](../../../../.reality/t119-A3/narrow19/paper/960x640-image-edit-tool-lifecycle-temporary-zoom.png) | 临时导航工具高亮与对应选项正常 | 复拍通过 |
| image-edit-tool-lifecycle-text-cancelled | [.reality/t119-A3/narrow19/paper/960x640-image-edit-tool-lifecycle-text-cancelled.png](../../../../.reality/t119-A3/narrow19/paper/960x640-image-edit-tool-lifecycle-text-cancelled.png) | 取消后草稿清除，工作面与导航恢复 | 复拍通过 |
| image-edit-tool-lifecycle | [.reality/t119-A3/narrow19/paper/960x640-image-edit-tool-lifecycle.png](../../../../.reality/t119-A3/narrow19/paper/960x640-image-edit-tool-lifecycle.png) | 目标作品/宿主可见，工具和面板平铺，对齐正常 | 复拍通过 |
| image-editor-v3-release-move-baseline | [.reality/t119-A3/narrow19/paper/960x640-image-editor-v3-release-move-baseline.png](../../../../.reality/t119-A3/narrow19/paper/960x640-image-editor-v3-release-move-baseline.png) | 目标作品/宿主可见，工具和面板平铺，对齐正常 | 复拍通过 |
| image-editor-v3-release-properties-floating | [.reality/t119-A3/narrow19/paper/960x640-image-editor-v3-release-properties-floating.png](../../../../.reality/t119-A3/narrow19/paper/960x640-image-editor-v3-release-properties-floating.png) | 浮动面板标签与参数可见，遮挡符合用户主动位置 | 复拍通过 |
| image-editor-v3-release | [.reality/t119-A3/narrow19/paper/960x640-image-editor-v3-release.png](../../../../.reality/t119-A3/narrow19/paper/960x640-image-editor-v3-release.png) | 裁剪工具和比例入口完整，作品与图层可见 | 复拍通过 |

#### A-extra20

| 场景/状态 | 路径 | 目视结论 | 复拍结果 |
| --- | --- | --- | --- |
| canvas-gpt-mask-editor | [.reality/t119-A3/A-extra20/1440x900-canvas-gpt-mask-editor.png](../../../../.reality/t119-A3/A-extra20/1440x900-canvas-gpt-mask-editor.png) | 参数遮罩正式宿主与源图可见，现有工具平铺 | 复拍通过；未做网络生成 |
| canvas-multi-layer-document-editor-editor | [.reality/t119-A3/A-extra20/1440x900-canvas-multi-layer-document-editor-editor.png](../../../../.reality/t119-A3/A-extra20/1440x900-canvas-multi-layer-document-editor-editor.png) | 正式画布文档/编辑弹窗与多层作品可见 | 复拍通过；包缺失断言为零 |
| canvas-multi-layer-document-editor | [.reality/t119-A3/A-extra20/1440x900-canvas-multi-layer-document-editor.png](../../../../.reality/t119-A3/A-extra20/1440x900-canvas-multi-layer-document-editor.png) | 正式画布文档/编辑弹窗与多层作品可见 | 复拍通过；包缺失断言为零 |
| image-edit-quick-mark-viewer-quick-arrow | [.reality/t119-A3/A-extra20/1440x900-image-edit-quick-mark-viewer-quick-arrow.png](../../../../.reality/t119-A3/A-extra20/1440x900-image-edit-quick-mark-viewer-quick-arrow.png) | 实际箭头及图层可见，保存/关闭已翻译 | 复拍通过 |
| image-edit-quick-mark-viewer-quick-crop | [.reality/t119-A3/A-extra20/1440x900-image-edit-quick-mark-viewer-quick-crop.png](../../../../.reality/t119-A3/A-extra20/1440x900-image-edit-quick-mark-viewer-quick-crop.png) | 裁剪工具和比例入口完整，作品与图层可见 | 复拍通过 |
| image-edit-quick-mark-viewer-quick-default | [.reality/t119-A3/A-extra20/1440x900-image-edit-quick-mark-viewer-quick-default.png](../../../../.reality/t119-A3/A-extra20/1440x900-image-edit-quick-mark-viewer-quick-default.png) | 查看器或快速编辑源画面完整，文案已翻译 | 复拍通过 |
| image-edit-quick-mark-viewer-quick-returned-to-viewer | [.reality/t119-A3/A-extra20/1440x900-image-edit-quick-mark-viewer-quick-returned-to-viewer.png](../../../../.reality/t119-A3/A-extra20/1440x900-image-edit-quick-mark-viewer-quick-returned-to-viewer.png) | 查看器或快速编辑源画面完整，文案已翻译 | 复拍通过 |
| image-edit-quick-mark-viewer-viewer | [.reality/t119-A3/A-extra20/1440x900-image-edit-quick-mark-viewer-viewer.png](../../../../.reality/t119-A3/A-extra20/1440x900-image-edit-quick-mark-viewer-viewer.png) | 查看器或快速编辑源画面完整，文案已翻译 | 复拍通过 |
| image-edit-quick-mark-viewer | [.reality/t119-A3/A-extra20/1440x900-image-edit-quick-mark-viewer.png](../../../../.reality/t119-A3/A-extra20/1440x900-image-edit-quick-mark-viewer.png) | 查看器或快速编辑源画面完整，文案已翻译 | 复拍通过 |
| image-edit-region-hosts-parameter-cancel-reopen | [.reality/t119-A3/A-extra20/1440x900-image-edit-region-hosts-parameter-cancel-reopen.png](../../../../.reality/t119-A3/A-extra20/1440x900-image-edit-region-hosts-parameter-cancel-reopen.png) | 目标蒙版/软边/确认或取消状态与源图对应，控件对齐 | 复拍通过 |
| image-edit-region-hosts-parameter-confirm-reopen | [.reality/t119-A3/A-extra20/1440x900-image-edit-region-hosts-parameter-confirm-reopen.png](../../../../.reality/t119-A3/A-extra20/1440x900-image-edit-region-hosts-parameter-confirm-reopen.png) | 目标蒙版/软边/确认或取消状态与源图对应，控件对齐 | 复拍通过 |
| image-edit-region-hosts-parameter-empty | [.reality/t119-A3/A-extra20/1440x900-image-edit-region-hosts-parameter-empty.png](../../../../.reality/t119-A3/A-extra20/1440x900-image-edit-region-hosts-parameter-empty.png) | 目标蒙版/软边/确认或取消状态与源图对应，控件对齐 | 复拍通过 |
| image-edit-region-hosts-parameter-recovered | [.reality/t119-A3/A-extra20/1440x900-image-edit-region-hosts-parameter-recovered.png](../../../../.reality/t119-A3/A-extra20/1440x900-image-edit-region-hosts-parameter-recovered.png) | 恢复后图层/属性与实际字段可见，画面未丢失 | 修复定位/恢复后复拍通过 |
| image-edit-region-hosts-parameter-region | [.reality/t119-A3/A-extra20/1440x900-image-edit-region-hosts-parameter-region.png](../../../../.reality/t119-A3/A-extra20/1440x900-image-edit-region-hosts-parameter-region.png) | 目标蒙版/软边/确认或取消状态与源图对应，控件对齐 | 复拍通过 |
| image-edit-region-hosts-parameter-soft-edge | [.reality/t119-A3/A-extra20/1440x900-image-edit-region-hosts-parameter-soft-edge.png](../../../../.reality/t119-A3/A-extra20/1440x900-image-edit-region-hosts-parameter-soft-edge.png) | 目标蒙版/软边/确认或取消状态与源图对应，控件对齐 | 复拍通过 |
| image-edit-region-hosts-parameter-solve-failed | [.reality/t119-A3/A-extra20/1440x900-image-edit-region-hosts-parameter-solve-failed.png](../../../../.reality/t119-A3/A-extra20/1440x900-image-edit-region-hosts-parameter-solve-failed.png) | 预览失败说明、重试与取消入口可见 | 故障注入复拍通过 |
| image-edit-region-hosts | [.reality/t119-A3/A-extra20/1440x900-image-edit-region-hosts.png](../../../../.reality/t119-A3/A-extra20/1440x900-image-edit-region-hosts.png) | 目标作品/宿主可见，工具和面板平铺，对齐正常 | 复拍通过 |
| video-edit-creative-results-creative-camera-stage-sent | [.reality/t119-A3/A-extra20/1440x900-video-edit-creative-results-creative-camera-stage-sent.png](../../../../.reality/t119-A3/A-extra20/1440x900-video-edit-creative-results-creative-camera-stage-sent.png) | 三维图片与加入剪辑反馈可见 | 复拍通过 |
| video-edit-creative-results-creative-image-backfilled-4k | [.reality/t119-A3/A-extra20/1440x900-video-edit-creative-results-creative-image-backfilled-4k.png](../../../../.reality/t119-A3/A-extra20/1440x900-video-edit-creative-results-creative-image-backfilled-4k.png) | 4K60 剪辑和原位置图片回填实际可见 | 复拍通过 |
| video-edit-creative-results-creative-image-editor-opened | [.reality/t119-A3/A-extra20/1440x900-video-edit-creative-results-creative-image-editor-opened.png](../../../../.reality/t119-A3/A-extra20/1440x900-video-edit-creative-results-creative-image-editor-opened.png) | 4K 源画面实际可见，加载结束，命令与属性完整 | 已复拍通过 |
| video-edit-creative-results-creative-results-reopened-4k60 | [.reality/t119-A3/A-extra20/1440x900-video-edit-creative-results-creative-results-reopened-4k60.png](../../../../.reality/t119-A3/A-extra20/1440x900-video-edit-creative-results-creative-results-reopened-4k60.png) | 重开保留目标布局/作品或正式回填结果 | 复拍通过 |
| video-edit-creative-results | [.reality/t119-A3/A-extra20/1440x900-video-edit-creative-results.png](../../../../.reality/t119-A3/A-extra20/1440x900-video-edit-creative-results.png) | 目标作品/宿主可见，工具和面板平铺，对齐正常 | 复拍通过 |

### 真人验收与交接风险

- 算法效果：人像发丝/衣摆边界、真实大区域/复杂背景移除与修补、软边遮罩和成片观感。自动路径已实际执行，但本轮小选区与蓝色取样块不代表生产效果合格。
- 硬件/手感：原生中文 IME、数位笔压感、连续 Space/Z 导航、不同显卡及长时间运行。窄窗口极小面板可滚动和重新调宽，具体舒适度留真人体验。
- 范围：共享 Shell/input/Menu 与调用方覆盖工具箱、真实画布节点、查看器、参数蒙版、剪辑回填；没有做全项目审计或后续阶段未接线的剪辑遮罩/GPU RegionSource 交付。
- 所有权：已阻止删除其他节点/撤销历史的输入资源。无所有权的旧本地投影文件保留，若后续要回收，须接正式资源所有权而不是按路径删除。
- 构建/提交：主进程媒体 URL 修复已进入 bundle19，总管理者之后启动旧开发实例时需使用新产物/重启该实例。本轮按要求没有启动开发环境，也没有 Git 写操作；只精确审查上方 37 个文件，继承的 01–03 与其他任务改动不得混归 A3。
- 结束检查：巡检进程均已退出，Get-CimInstance 检查本仓库只有 Codex 自身 node 进程，无巡检 Electron；释放空的 .reality/ui-lock。忽略的截图和日志保留本机供审查，不加入提交。
