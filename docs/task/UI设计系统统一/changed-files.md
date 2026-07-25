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
