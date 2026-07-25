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

（后续任务在此追加，格式见下）

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
