# 变更文件清单

按任务记录实际改动的文件，便于回退定位与交接。

前置基线提交（本计划创建前完成，仅列关键产出，不展开）：

- `eb74657`：`UiPanel` variant、`scripts/check-surface-tokens.cjs`、skill、`src/stores/generationTaskProgressStore.ts`
- `4800cf0`：字号令牌 + 156 处迁移、`src/components/ui/layout.tsx`、`src/components/ui/states.tsx`、Settings 试点

---

## 任务 1.1 视觉令牌登记制补齐

提交：`45748d7`（33 个文件）

### 修改
- `tailwind.config.js`：新增 `veil` 六档色阶、`node-selected`/`node-error`/`thumb`/`thumb-sm` 具名阴影、`fontSize 13/14/15`、`borderRadius hairline`、`borderWidth 1.5`
- `src/components/ui/styleTokens.ts`：上传卡边框改用 `border-1.5 border-veil-strong`
- `src/features/canvas/ui/nodeControlStyles.ts`：新增 `NODE_SELECTED_BORDER_CLASS` / `NODE_IDLE_BORDER_CLASS` / `NODE_IDLE_BORDER_STATIC_CLASS`
- 11 个画布节点文件（`AudioNode`/`CameraStageNode`/`GroupNode`/`ImageNode`/`GenerationNodeShell`/`StoryboardGenNode`/`StoryboardNode`/`TextAnnotationNode`/`UploadNode`/`ValueSourceShell`/`VideoNode`）：描边改用共享令牌并补 import
- `src/components/MediaGenerator/components/InputArea.tsx`：`bg-app/72` → `bg-app/70`（修复静默失效）
- `src/components/MediaGenerator/components/ModelSelectorPanel.tsx`：`/42`→`/40`、`/46`→`/45`
- `src/components/ui/fileUploader/StackedMediaUploader.tsx`：`/28`→`/30`、`/92`→`/90`、`/82`→`/80`；`rounded-[11px]`→`rounded-xl`；阴影改具名档位
- `src/components/Settings/index.tsx`：`text-[15px]`→`text-15`、`text-[16px]`→`text-base`
- 另有 `Toggle`、`ModelPickerList`、`NodeHeader`、`MediaInputRow`、`NodeDownloadMenu`、`SplitStoryboardToolEditor`、`MarkCanvas`、`FloatingInputPanel`、`GroupLane`、`TrackLane`、`CameraStagePreviewPanel`、`NodeGenerationError`、`storyboardGen/*` 等文件的令牌替换

## 任务 1.2 z-index 层级体系统一

提交：`b024761`（36 个文件）

### 新增
- `src/core/theme/zLayers.ts`：全局层级的 TS 常量镜像，供内联 `zIndex` 使用

### 修改
- `tailwind.config.js`：`zIndex` 扩为 11 档语义档位
- `src/contexts/DragDropContext.tsx`：拖拽跟随层 `zIndex: 9999` → `Z_LAYERS.drag`
- `src/features/canvas/canvasUtils.ts`：新增 `CANVAS_MINIMAP_Z_INDEX`，并注明画布局部刻度与全局体系的边界
- `src/features/canvas/Canvas.tsx`：minimap 魔数改具名常量；连接提示 `z-[12000]` → `z-toast`
- `src/components/WindowControls.tsx`：`z-[2147483647]` → `z-titlebar`
- `src/components/ui/Tooltip.tsx`：`z-[9999]` → `z-tooltip`
- `src/components/ui/primitives.tsx`、`AlertDialog.tsx`：`z-50` → `z-modal`
- `src/components/mediaViewer/*Modal.tsx` ×3：`z-[110]` → `z-viewer`
- `src/features/canvas/nodes/cameraStage/CameraStageNodeDialog.tsx`：移除 `overlayClassName="!z-[90]"`
- 另有 `PresetPanel`、`CreatePresetDialog`、`PresetManager`、`UpdateDialog`、`LargeUploadChoiceDialog`、`RenameDialog`、`ClearHistoryDialog`、`AddCustomModelDialog`、`SettingsDialog`、`TestModePanel`、`TestModeIndicator`、`LanguageSwitcher`、`NotificationContext`、`NotificationToast`、`AssetCardMenu`、`AssetLibraryFloatingPanel`、`AssistantSidebar`、`NodeDownloadMenu`、`ExportSettingsPanel`、`IncomingImagePicker`、`FrameCard`、`NodeModelParamsControls`、`CanvasWorkspace`、`ShotTimelinePanel`、`EasingCurveEditor`、`TimelinePanel`

## 任务 1.3 自动化门禁与 CI 接入

提交：`5dad5fc`（5 个文件）

### 修改
- `.eslintrc.json`：新增 5 类 `no-restricted-syntax` 视觉规则（各含 `Literal` 与 `TemplateElement` 两个选择器）
- `scripts/check-surface-tokens.cjs`：新增规则 C「手写弹窗」检测；优化命中行定位
- `package.json`：`check:surface` 接入 `build` 与 `electron:build`
- `src/components/ui/PromptEditor/suggestions/createSuggestionRenderer.ts`：`z-[1000]` → `z-dropdown`
- `src/components/ui/PromptEditor/suggestions/createSuggestionRenderer.test.ts`：同步断言
- `.claude/skills/henji-ui-surface/SKILL.md`、`CLAUDE.md`：规则同步

### 未改动（有意）
- `.github/workflows/build.yml`：仍是 Tauri 时代产物且已失效，不在本任务范围，见 `重要记录.md` 记录 007

---

## 任务 1.4 CI 迁移到 Electron（`d9d33af`）
- `.github/workflows/build.yml`：整份重写为 Electron 双 job
- `src/core/imageEdit/worker/webgpuRuntime.ts`：删除 `import type` 内冗余 `type`（TS2206）
- `scripts/release.cjs`：推送分支改为读取当前分支

## 任务 2.1 助手侧栏（`3cd2b0d`）
- `AssistantSidebar` / `AssistantConversation` / `AssistantMemoryPanel` / `ApprovalCard` /
  `ExecutionPlanCard` / `ModelProgressMessage` / `ToolActivityCard` / `ToolActivityGroup`
- 新增 `UI_INSET_SURFACE_CLASS`（`styleTokens.ts`），`UiPanel` 的 inset 变体改为消费它

## 任务 2.2 任务卡（`5a5a1d1`）
- `TaskCard`：四状态改状态组件、结果容器改 inset、徽标改令牌
- `TaskList`：筛选空态改 `UiEmpty`
- `styleTokens.ts`：新增 `UI_META_BADGE_CLASS` / `UI_META_BADGE_ACCENT_CLASS`

## 任务 2.4 播放器与查看器（`6f4ffb5`）
- `AudioPlayer`：新增 `surface` 变体；`TaskCard`、`AudioPreviewCard` 传 `plain`
- `VideoViewerControls`：改用 `UI_PANEL_SURFACE_CLASS`

## 任务 2.5 日志面板（`a00073d`）
- `AssistantTraceDetail` / `AssistantTraceList`：表面改 inset

## 任务 2.3 弹窗统一（`5404f79`）
- 转 `UiModal`：`SettingsDialog`(覆盖6处调用) / `SettingsProgressDialog` / `RenameDialog` /
  `ClearHistoryDialog` / `CreatePresetDialog` / `PresetManager` / `AddCustomModelDialog` /
  `LargeUploadChoiceDialog` / `UpdateDialog` / `TestModePanel` / `Settings/index.tsx`
- 豁免注释：三个 mediaViewer + `ProjectManager` 加载遮罩
- `primitives.tsx`：`UiModal` 增加 `data-dialog`
- `package.json` / `.github/workflows/build.yml`：门禁转 `check:surface:strict`

## 任务 3.1 长列表（`57d176c`）
- `styleTokens.ts`：新增 `UI_LIST_ITEM_SKIP_TALL_CLASS`
- `TaskCard`：根节点加 content-visibility
- **删除** `src/workspaces/GenerationWorkspace/components/MessageList.tsx`（零引用死代码）

## 任务 3.3 装饰开销（`9e1cd9e`）
- `transition-all` 替换：9 个文件
- 阴影收敛：约 20 个文件
- `backdrop-blur` 移除：10 处 / 8 个文件

---

（后续任务在此追加）

<!--
## 任务 X.Y 任务名称

提交：<commit hash>

### 新增
- `路径`：用途

### 修改
- `路径`：改动要点

### 删除
- `路径`：原因
-->

---

## 收尾：选项集合静息态收敛

提交：`067087a`（第一步） + `a5253f2`（第二步）

### 修改 — 组件契约

- `src/components/ui/primitives.tsx`：`UiOptionButton` 新增 `menu` 变体（静息无边框无底色，hover 出 `bg-layer`，选中态实底）；静息态刻意不写 `bg-transparent`，避免与调用方补的 `bg-veil-faint` 在同一属性上打架
- `src/workspaces/GenerationWorkspace/components/TaskCard.tsx`：6 个图标按钮改 `showBorder={false} appearance="hover-only"`（第一步）

### 修改 — 转 `variant="menu"`（浮层/容器内的同质列表）

- `src/components/LanguageSwitcher.tsx`
- `src/components/ui/Dropdown.tsx`
- `src/components/ui/PromptEditor/suggestions/PromptSuggestionList.tsx`：同时删掉手写的 `!border-transparent !bg-transparent …`
- `src/components/Settings/sections/LlmSettingsSection.tsx`：供应商列表
- `src/components/ModelSettingsPanel.tsx`：模型可见性列表
- `src/components/MediaGenerator/components/PromptOptimizationSelectorPanel.tsx`（第一步，`card` → `menu`）
- `src/components/MediaGenerator/components/PromptOptimizationProfilesPanel.tsx`（`card` → `menu`）
- `src/features/canvas/NodeSelectionMenu.tsx`：删手写覆盖
- `src/features/canvas/ui/NodeDownloadMenu.tsx`：2 处
- `src/features/canvas/nodes/storyboardSplit/IncomingImagePicker.tsx`
- `src/features/canvas/params/ModelPickerList.tsx`：删手写覆盖 + 删掉不再需要的 `UI_COLOR_ACCENT_*` 导入，选中态改走公共令牌
- `src/features/cameraStage/panels/ObjectListPanel.tsx`

### 修改 — 转 `menu` + `bg-veil-faint`（二维网格，需要撑格子）

- `src/components/MediaGenerator/components/ModelSelectorPanel.tsx`（第一步）
- `src/components/MediaGenerator/components/AspectResolutionPanel.tsx`：2 处，去掉手写 `!bg-accent`
- `src/components/params/panels/ResolutionPanel/AspectRatioSelector.tsx`：2 处，同上
- `src/components/params/panels/ResolutionPanel/PresetResolutionSelector.tsx`：同上
- `src/components/params/panels/ResolutionPanel/QualityTierSelector.tsx`：同上
- `src/components/ui/UniversalResolutionSelector.tsx`：2 处
- `src/components/params/panels/VoiceSelectorPanel.tsx`：语音网格（`card` → `menu`）

### 修改 — 测试与文档

- `src/components/ui/PromptEditor/suggestions/PromptSuggestionList.test.tsx`：断言从"含 `!bg-transparent`"改为语义断言（未选中含 `border-transparent` 且无实底，选中有实底）
- `.claude/skills/henji-ui-surface/SKILL.md`：新增「选项集合的静息态：不描边」一节（判据、反例表、静默失效坑）；禁止清单 +2 条；自检清单 +1 条
- `docs/task/UI设计系统统一/test-report.md`：补齐第二、三阶段与本次收尾的手动验证清单（此前只覆盖第一阶段），现为 A~N 共 14 组

### 发现但未处理

- `src/components/MediaGenerator/components/ResolutionPanel.tsx`：**零引用死代码**（仅自引用），未改也未删，另行处理
- `src/components/debug/ExportPanel.tsx`：完全手写覆盖了配色（`bg-yellow-500` / `bg-zinc-800/50`），是 debug 面板，未纳入本次收敛

## 收尾（续）：模型选择面板配色对齐

提交：`431a2f7`

### 修改

- `src/components/MediaGenerator/components/GeneratorConfigurationBar.tsx`：删掉模型面板的 `panelClassName`（它把外壳表面从默认 `bg-panel` 覆盖成了更亮的 `bg-surface-dark`）
- `src/components/MediaGenerator/components/ModelSelectorPanel.tsx`：
  - 去掉根容器 `bg-zinc-900/40` 与筛选区 `bg-zinc-900/45` 两层额外底色
  - 4 个筛选 chip 从 `UiChipButton` 改为 `UiOptionButton`，选中态自然走公共令牌
  - 搜索框去掉 zinc 覆盖，清空按钮改 `appearance="hover-only"`
  - 分隔线 `bg-zinc-600/50` → `bg-border-dark`；收藏星标 `text-zinc-500`/`hover:bg-zinc-700/60` → `text-text-muted`/`hover:bg-layer`
- `src/components/ui/styleTokens.ts`：删除 `UI_CHIP_ACTIVE_STRONG_CLASS`（从未生效，见 D-010），原位留注释

## 收尾（续二）：固定调色板收敛为语义色

提交：`<待填>`

### 新增

- `--text-soft-rgb` / `--text-faint-rgb`（`src/index.css` 默认值 + `tailwind.config.js` 语义色 + `runtimeTheme.applyTextScale` 派生）
- `.eslintrc.json`：拦截 `*-zinc-*` 的两条 `no-restricted-syntax`

### 修改

- 66 个文件、292 处 `zinc-*` → 语义色（映射表见 D-011）
- `ModelscopeCustomModelManager.tsx` / `PresetManager.tsx`：删掉 15 处死的 `dark:` 双分支
- `TestModePanel.tsx`：6 处卡片表面 → Surface（`bg-app/40`，去边框）
- `TaskInputPreview.tsx`：2 处 48px 缩略图 → `border-veil-subtle bg-black/20`（是媒体 chrome 不是卡片）
- `DragDropContext.tsx`：拖拽预览图加行级 `ui-surface-allow`（拖拽幽灵不是面板容器）
- `ModelSettingsPanel.tsx`：供应商卡去掉表面覆盖，标题条改用分隔线
- `UpdateDialog.tsx`：底部按钮区去掉额外底色，只留分隔线
- `StackedMediaUploader.tsx`：拖拽高亮改互斥三元（此前从未生效）；Tooltip 去掉表面覆盖
- `.claude/skills/henji-ui-surface/SKILL.md`：新增「同属性叠类 = 静默失效」「颜色必须跟随主题」两节；登记表加颜色一行；禁止清单 +4；自检清单 +3
- `CLAUDE.md`：同步两条约束

### 删除

- `src/components/MediaGenerator/components/ResolutionPanel.tsx`：零引用死文件
- `UI_CHIP_ACTIVE_STRONG_CLASS`（上一提交）
