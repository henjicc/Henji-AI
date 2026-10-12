# u4：超级关键帧面板重排与 UiSegmented

- 工作区：`D:/VibeCode/henji-wt-u4`，分支 `codex/u4`；审查与 Git 操作交总管理者。
- 状态：实现、精确检查与真实 Electron 截图复验通过，待总管理者审查。
- 本工作区没有 `docs/task/界面统一` 的既有总览，因此只建立指定的 u4 任务文件，不改其他任务总览。

## 范围与设计决定

1. `UiSegmented` 负责等宽容器、受控单选、禁用项和方向键导航；内部仍使用 `UiOptionButton`，不引入另一套按钮实现。只迁移超级关键帧的方式与指针用途两行，其他分段维持现状。
2. 比较已有的 `UiOptionButton variant="segment"`、`UI_SEGMENTED_TRACK_CLASS`、`UiSwitch appearance="segmented"`：前两者没有组级键盘与统一尺寸，最后一个只表达布尔开关。选择组合现有 primitive，新增容器职责；复用现有 React 与 lucide，不新增依赖或自行制作底层控件。
3. `UiFormRow labelColumn="panel"` 是有限枚举：72px 右对齐标签、12px 间隔、余宽控件。72px 不属于 Tailwind 默认尺寸档，在 residue 清单登记唯一几何例外。
4. 用户指定的 ghost 使用现有 `quiet` 档；动作占满控件列用现有 `className="w-full"`。不新增重复的按钮枚举。
5. 当前仓库的颜色规范已去掉旧别名；内嵌底、hover、辅助文字分别用 `bg-gap`、`bg-hover`、`text-text3`。本任务明确要求的强实底单选通过 `UiOptionButton segmentFrame="inset"` 实现，其他分段保留原选中态。实底文字用随主题求解的 `text-on-accent`。
6. 所有分组采用 compact 标题与 divided；参照区由剪辑宿主注入共享面板，Dropdown 自带标签全部移到表单行。下拉显式填满控件列，避免继承工具栏的紧凑宽度。
7. 风格读数放在标签同行的控件列右端，端点提示在滑杆下；速度只在录制轨迹显示。钉住区只在可钉或已有钉点时出现，两个钉住按钮等宽且同档，去掉按钮里的图标以保证窄列中文不挤压。
8. 镜头参考继续使用共享组件及原机位/视线/焦距、录制和预览回调；没有伪造二维指针、标注、相对片段参照或保真业务。图片布局档也复用同一行骨架，原候选、钉住、保真和保存语义保留，精确测试覆盖。
9. 相对参照的“不使用”需要正式领域入口接受空选择；只删除参照，保留标注约束与原持久化/通知链。没有新实体、能力或 MCP 工具，覆盖分级为既有操作的界面修正。
10. 文案进入中英 i18n。候选、示范和钉点继续使用现有列表语义，不新增产品数量上限。

## 设计自查

- 助手只凭名称和说明能否用对？能。操作仍委托原有示范、整理、候选预览、应用、钉点和约束领域入口；本次只统一人用的参数名称、布局及分组，没有第二份业务执行路径。
- 能否 AI 先做、人只确认？能。沿用现有整理与候选对照：本地算法或已授权的讲解流程先整理，人检查候选并应用；本次验收仅使用本地算法，没有模型或付费调用。
- 产物能否直接流进其他工作区？能。保留原文档应用、素材和导出链路，不新增临时产品格式；本次不改变跨工作区流转契约。

## 排查范围

- 查过 `CreativeIntentControls` 的 motion、camera、layout 三档及直接宿主。
- 修复剪辑参照行与共享面板的排布、条件显示、分段语义。
- 新 primitive 的尺寸/状态变体默认保持其他已有 UiOptionButton 调用不变；其余分段迁移留后续任务。
- 原分段、表单行和样张覆盖精确测试通过。未跑其他工作区的窗口验收。

## 验证

- `npx vitest run src/components/ui/UiSegmented.test.tsx src/components/ui/layout.test.tsx src/components/ui/primitives.selection.test.tsx src/features/creativeIntent/ui/CreativeIntentControls.test.tsx src/features/videoEdit/application/videoEditMotionDraft.test.ts src/features/devGallery/uiGalleryCoverage.test.ts --silent`：52 项最终通过。首次失败为测试环境默认英语及新夹具选错片段，修正后仅重跑失败文件，29 项通过。
- `npx tsc -p tsconfig.json --noEmit`：通过；首轮新测试未窄化联合类型，修正测试工厂返回类型后通过。
- 改动 TS/TSX 文件 ESLint：通过。改动的 CJS 脚本 ESLint 也通过；首次命中 CommonJS 的 require 语法，补充与现有巡检工厂一致的、有理由的 no-var-requires 声明后通过。
- `npm run check:surface`、`check:colors`、`check:icons`、`check:ui-residue`、`check:skill-sync`：通过。
- 场景 CJS 的 `node --check` 与 `git diff --check`：通过。
- `npx electron-vite build`：通过，保留既有动态/静态混合导入和第三方未使用导入告警。没有跑 `electron:bundle` 前置 SDK 生成，因为它会写本任务明确禁止的 SDK 目录与主仓 junction 缓存。复用现有公共 SDK 依赖，只生成本 worktree 的 out 产物。
- 本任务按用户明确要求运行最小 `ui:tour`；不跑 Reality，不启停 electron:dev，不操作 Git，不跑 Electron tsc，因为没有修改共享 core 或主进程。

## 真实 Electron 截图与目视检查

副屏通过 Windows 查询确认为右侧 `DISPLAY1`（2560,0 起点），巡检使用 `--display-point 2561,1`；声音由正式巡检启动器静音，使用隔离临时资料。

首轮截图发现 Dropdown 未填满列宽与动画中间态，已修正并重新打包；首轮图不作为最终验收证据。候选面板采用现有滚动，不把超高内容硬塞进固定浮层；最终分别检查上部与底部。

最终命令：

`npm run ui:tour -- --only super-keyframe-panel --theme-preset graphite,paper --size 1440x900 --out .ui-tour/u4-super-keyframe-final --display-point 2561,1`

两主题各两个场景均通过；14 张均由代理打开目视。每个场景的 `browserErrors`、`logErrors` 均为空，`setupError` 为 null。没有运行像素对比度专项，因此结论是目视可读性与实际布局，不能宣称量化对比度已审计。

| 主题 | 截图路径 | 逐张目视结论 |
|---|---|---|
| graphite | [.ui-tour/u4-super-keyframe-final/graphite/1440x900-super-keyframe-panel-motion-idle.png](../../../.ui-tour/u4-super-keyframe-final/graphite/1440x900-super-keyframe-panel-motion-idle.png) | idle：72px 标签与整列下拉对齐；没有速度行和全灰钉住区。底部动作在现有滚动区内，禁用与 title 由精确测试验证。 |
| graphite | [.ui-tour/u4-super-keyframe-final/graphite/1440x900-super-keyframe-panel-motion-record-selected.png](../../../.ui-tour/u4-super-keyframe-final/graphite/1440x900-super-keyframe-panel-motion-record-selected.png) | 录制轨迹选中：仅录制段实底，速度行显示并与属性对齐，指针用途为独立单选组。 |
| graphite | [.ui-tour/u4-super-keyframe-final/graphite/1440x900-super-keyframe-panel-motion-candidates-top.png](../../../.ui-tour/u4-super-keyframe-final/graphite/1440x900-super-keyframe-panel-motion-candidates-top.png) | 候选状态上部：参数列、风格读数、端点提示及两枚钉住按钮对齐；采用现有浮层滚动。 |
| graphite | [.ui-tour/u4-super-keyframe-final/graphite/1440x900-super-keyframe-panel-motion-candidates-bottom.png](../../../.ui-tour/u4-super-keyframe-final/graphite/1440x900-super-keyframe-panel-motion-candidates-bottom.png) | 候选状态底部：menu 候选完整可见，钉住同档等宽，重新整理静默，应用为唯一 primary，未裁切。 |
| graphite | [.ui-tour/u4-super-keyframe-final/graphite/1440x900-super-keyframe-panel-motion.png](../../../.ui-tour/u4-super-keyframe-final/graphite/1440x900-super-keyframe-panel-motion.png) | 巡检结束态：底部候选和应用仍稳定，与上一张布局一致。 |
| graphite | [.ui-tour/u4-super-keyframe-final/graphite/1440x900-super-keyframe-panel-camera-camera.png](../../../.ui-tour/u4-super-keyframe-final/graphite/1440x900-super-keyframe-panel-camera-camera.png) | 镜头参考：机位属性填满控件列，开始示范同左缘，idle 整理禁用，无空钉住区。 |
| graphite | [.ui-tour/u4-super-keyframe-final/graphite/1440x900-super-keyframe-panel-camera.png](../../../.ui-tour/u4-super-keyframe-final/graphite/1440x900-super-keyframe-panel-camera.png) | 镜头参考结束态：浮层、属性及底部动作完整，动画结束后布局稳定。 |
| paper | [.ui-tour/u4-super-keyframe-final/paper/1440x900-super-keyframe-panel-motion-idle.png](../../../.ui-tour/u4-super-keyframe-final/paper/1440x900-super-keyframe-panel-motion-idle.png) | idle：72px 标签与整列下拉对齐；没有速度行和全灰钉住区。底部动作在现有滚动区内，禁用与 title 由精确测试验证。 |
| paper | [.ui-tour/u4-super-keyframe-final/paper/1440x900-super-keyframe-panel-motion-record-selected.png](../../../.ui-tour/u4-super-keyframe-final/paper/1440x900-super-keyframe-panel-motion-record-selected.png) | 录制轨迹选中：仅录制段实底，速度行显示并与属性对齐，指针用途为独立单选组。 |
| paper | [.ui-tour/u4-super-keyframe-final/paper/1440x900-super-keyframe-panel-motion-candidates-top.png](../../../.ui-tour/u4-super-keyframe-final/paper/1440x900-super-keyframe-panel-motion-candidates-top.png) | 候选状态上部：参数列、风格读数、端点提示及两枚钉住按钮对齐；采用现有浮层滚动。 |
| paper | [.ui-tour/u4-super-keyframe-final/paper/1440x900-super-keyframe-panel-motion-candidates-bottom.png](../../../.ui-tour/u4-super-keyframe-final/paper/1440x900-super-keyframe-panel-motion-candidates-bottom.png) | 候选状态底部：menu 候选完整可见，钉住同档等宽，重新整理静默，应用为唯一 primary，未裁切。 |
| paper | [.ui-tour/u4-super-keyframe-final/paper/1440x900-super-keyframe-panel-motion.png](../../../.ui-tour/u4-super-keyframe-final/paper/1440x900-super-keyframe-panel-motion.png) | 巡检结束态：底部候选和应用仍稳定，与上一张布局一致。 |
| paper | [.ui-tour/u4-super-keyframe-final/paper/1440x900-super-keyframe-panel-camera-camera.png](../../../.ui-tour/u4-super-keyframe-final/paper/1440x900-super-keyframe-panel-camera-camera.png) | 镜头参考：机位属性填满控件列，开始示范同左缘，idle 整理禁用，无空钉住区。 |
| paper | [.ui-tour/u4-super-keyframe-final/paper/1440x900-super-keyframe-panel-camera.png](../../../.ui-tour/u4-super-keyframe-final/paper/1440x900-super-keyframe-panel-camera.png) | 镜头参考结束态：浮层、属性及底部动作完整，动画结束后布局稳定。 |

## 总管理者注意

- 修改了公共 UI 文件、两份 skill、i18n、residue 登记及巡检场景注册，合并时留意其他界面任务的同文件改动。
- 没有改 `packages/ai-sdk` 或主进程；SDK 生成、全量验证、其他 43 处分段迁移不属于本任务。
- 截图与 out/.tmp 产物不入 Git。没有创建交接或总结文档；此文件是用户指定的任务记录。


## 改动文件清单

| 文件 | 用途 |
|---|---|
| `src/components/ui/UiSegmented.tsx` | 新增统一分段容器与键盘单选。 |
| `src/components/ui/UiSegmented.test.tsx` | 保护禁用跳过、循环导航、焦点与选择同步。 |
| `src/components/ui/index.ts` | 导出统一分段组件。 |
| `src/components/ui/layout.tsx` | 新增有限枚举固定标签列。 |
| `src/components/ui/primitiveInternals.ts` | 声明内嵌分段状态变体。 |
| `src/components/ui/primitives.tsx` | 内嵌项填满轨道及强实底选中态，保持原分段默认态。 |
| `src/features/creativeIntent/ui/CreativeIntentControls.tsx` | 重排共享面板与条件显示，注入参照区。 |
| `src/features/creativeIntent/ui/CreativeIntentControls.test.tsx` | 新增速度、分段回调、钉住区与 idle 检查，并固定测试语言。 |
| `src/features/videoEdit/panels/VideoEditMotionControls.tsx` | 重排参照与附加状态行，空标注和参照提供不使用。 |
| `src/features/videoEdit/application/videoEditMotionDraft.ts` | 空参照选择只清除参照。 |
| `src/features/videoEdit/application/videoEditMotionDraft.test.ts` | 验证保留标注，并固定包含 UI 的测试语言。 |
| `src/features/devGallery/gallerySections.tsx` | 增加统一分段样张供共享组件覆盖检查。 |
| `src/i18n/locales/zh-CN/ui.json` | 登记中文面板文案。 |
| `src/i18n/locales/en-US/ui.json` | 登记英文面板文案。 |
| `scripts/lib/buttonAppearanceOverrides.cjs` | 将 UiSegmented 纳入 surface 规则 E。 |
| `scripts/ui-residue.allowlist.json` | 登记 fixed panel 标签列的 72px 几何理由。 |
| `scripts/lib/uiInspectionSceneSuperKeyframePanel.cjs` | 增加仅本地操作的最小真实宿主截图场景。 |
| `scripts/lib/uiInspectionScenes.cjs` | 注册两个定向巡检场景。 |
| `.codex/skills/henji-ui-surface/SKILL.md` | 登记统一分段与固定标签列。 |
| `.claude/skills/henji-ui-surface/SKILL.md` | 同步组件复用约定。 |
| `docs/task/界面统一/u4-超级关键帧面板与UiSegmented.md` | 本任务执行记录、设计自查、检查及截图证据。 |
