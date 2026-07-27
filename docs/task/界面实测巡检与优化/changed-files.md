# 变更文件记录

## 2026-07-27 第一阶段

### 公共组件基座

- `src/components/ui/primitives.tsx`
- `src/components/ui/UiModal.tsx`
- `src/components/ui/index.ts`
- `src/components/ui/useDialogFocusTrap.ts`
- `src/components/ui/primitives.modal.test.tsx`
- `src/components/ui/AlertDialog.tsx`
- `src/components/ui/Toggle.tsx`
- `src/components/ui/ProgressBar.tsx`
- `src/components/ui/motion.ts`
- `src/components/ui/motion.test.ts`
- `src/components/ui/states.tsx`

### 状态组件调用点与必要适配

- `src/components/CustomModels/CustomModelManager.tsx`
- `src/components/MediaGenerator/components/ModelscopeCustomModelManager.tsx`
- `src/components/MediaGenerator/components/PromptOptimizationSelectorPanel.tsx`
- `src/components/PresetPanel.tsx`
- `src/components/Presets/PresetManager.tsx`
- `src/components/Settings/sections/LlmSettingsSection.tsx`
- `src/components/TabContainer.tsx`
- `src/components/params/base/SwitchInput.tsx`
- `src/components/params/panels/VoiceSelectorPanel.tsx`
- `src/features/assets/AssetLibrarySurface.tsx`
- `src/features/assistant/conversation/AssistantConversation.tsx`
- `src/features/assistant/history/AssistantRunHistory.tsx`
- `src/features/assistant/memory/AssistantMemoryPanel.tsx`
- `src/features/cameraStage/projects/CameraStageProjectList.tsx`
- `src/features/imageEdit/editor/ImageToolInspector.tsx`
- `src/features/logs/components/AssistantTraceDetail.tsx`
- `src/features/logs/components/AssistantTraceDiffDialog.tsx`
- `src/features/logs/components/AssistantTraceList.tsx`
- `src/features/logs/components/LogEventDetail.tsx`
- `src/features/logs/components/LogEventList.tsx`
- `src/features/logs/components/RequestChainView.tsx`
- `src/features/project/ProjectManager.tsx`
- `src/features/project/RenameDialog.tsx`
- `src/workspaces/GenerationWorkspace/components/MediaGrid.tsx`
- `src/workspaces/GenerationWorkspace/components/TaskList.tsx`

### 国际化

- `src/i18n/locales/zh-CN/history.json`
- `src/i18n/locales/en-US/history.json`

### 任务记录

- `docs/task/界面实测巡检与优化/00-任务总览.md`
- `docs/task/界面实测巡检与优化/重要记录.md`
- `docs/task/界面实测巡检与优化/progress.md`
- `docs/task/界面实测巡检与优化/decisions.md`
- `docs/task/界面实测巡检与优化/handoff.md`
- `docs/task/界面实测巡检与优化/changed-files.md`
- `docs/task/界面实测巡检与优化/test-report.md`
- 第一阶段四个任务文件

未记录或提交 `out/`、临时截图、日志、`resources/model-manifest.json`、`resources/progress-seeds.json` 等生成产物。

## 2026-07-27 第二阶段

### 生成工作区布局

- `src/styles/scrollbar.css`
- `src/workspaces/GenerationWorkspace.tsx`
- `src/workspaces/GenerationWorkspace/components/FloatingInputPanel.tsx`
- `src/workspaces/GenerationWorkspace/components/TaskList.tsx`
- `CLAUDE.md`
- `.claude/skills/henji-ui-surface/SKILL.md`
- `.codex/skills/henji-ui-surface/SKILL.md`

### 设置弹窗信息架构

- `src/components/Settings/index.tsx`
- `src/components/Settings/components/SectionCard.tsx`
- `src/components/Settings/components/SettingItem.tsx`
- `src/components/Settings/components/ApiKeyInput.tsx`
- `src/components/Settings/sections/AssetLibrarySection.tsx`

### 工作区页面头

- `src/features/project/ProjectManager.tsx`
- `src/workspaces/ToolboxWorkspace.tsx`
- `src/features/assets/AssetLibrarySurface.tsx`

### 任务记录

- `docs/task/界面实测巡检与优化/00-任务总览.md`
- `docs/task/界面实测巡检与优化/重要记录.md`
- `docs/task/界面实测巡检与优化/progress.md`
- `docs/task/界面实测巡检与优化/decisions.md`
- `docs/task/界面实测巡检与优化/handoff.md`
- `docs/task/界面实测巡检与优化/changed-files.md`
- `docs/task/界面实测巡检与优化/test-report.md`
- 第二阶段三个任务文件

构建过程刷新了被 Git 忽略的 manifest、seeds 与 `out/`，均未纳入提交。

## 2026-07-27 第三阶段

### 选中态词汇表与布尔控件

- `src/components/ui/styleTokens.ts`
- `src/components/ui/primitives.tsx`
- `src/components/ui/primitives.selection.test.tsx`
- `src/components/ui/Toggle.tsx`
- `src/components/ui/UiDatePicker.tsx`
- `src/components/ui/PromptEditor/nodeViews/ReferenceNodeViews.tsx`
- `src/components/WindowControls.tsx`
- `src/components/TestModePanel.tsx`
- `src/components/debug/ExportPanel.tsx`
- `src/features/logs/components/AssistantTraceList.tsx`
- `src/features/logs/components/LogEventRow.tsx`

### 模型显示与管理

- `src/components/ModelSettingsPanel.tsx`
- `src/components/CustomModels/CustomModelManager.tsx`
- `src/components/MediaGenerator/components/ModelscopeCustomModelManager.tsx`

### 排版令牌七批迁移

- 设置：`src/components/Settings/components/SettingsDialog.tsx`、`SettingsProgressDialog.tsx`，以及 `src/components/Settings/sections/`、`tabs/ApiKeysTab.tsx` 中本阶段有文本层级的 20 个调用点
- 生成：`src/components/MediaGenerator/components/` 下输入、模型选择、比例分辨率、预设与提示词优化相关 8 个文件；`src/workspaces/GenerationWorkspace/components/` 下 `ClearHistoryDialog.tsx`、`NotificationToast.tsx`、`TaskCard.tsx`、`TaskPrompt.tsx`
- 画布与项目：`src/features/canvas/ui/CanvasEmptyHint.tsx`、`NodeDownloadMenu.tsx`、四个 `tool-editors/` 文件；`src/features/project/ProjectManager.tsx`、`RenameDialog.tsx`
- 智能助手：`src/features/assistant/AssistantSidebar.tsx`，`conversation/` 下 10 个展示组件，`history/AssistantRunHistory.tsx`、`memory/AssistantMemoryPanel.tsx`
- 资产库：`src/features/assets/AssetLibrarySurface.tsx`、`components/AssetCard.tsx`、`AssetCardMenu.tsx`、`AssetLibrarySidebar.tsx`
- 工具与编辑：`src/workspaces/ToolboxWorkspace.tsx`、`src/features/imageMark/editor/MarkEditor.tsx`、`standalone/ImageMarkTool.tsx`、`src/features/imageEdit/tools/diffusion/DiffusionInspector.tsx`、`geometry/GeometryInspector.tsx`
- 公共组件与参数：`src/components/ui/` 下 12 个公共展示组件；`src/components/params/` 下基础输入、分辨率、复合面板与语音面板共 11 个文件

本阶段共修改 91 个已跟踪 `src/` 文件并新增 1 个测试文件；完整精确清单见实现提交 `44aac8b` 的 `git show --name-only`。

### 规范与任务记录

- `CLAUDE.md`
- `.claude/skills/henji-ui-surface/SKILL.md`
- `.codex/skills/henji-ui-surface/SKILL.md`
- `docs/task/界面实测巡检与优化/00-任务总览.md`
- `docs/task/界面实测巡检与优化/重要记录.md`
- `docs/task/界面实测巡检与优化/progress.md`
- `docs/task/界面实测巡检与优化/decisions.md`
- `docs/task/界面实测巡检与优化/handoff.md`
- `docs/task/界面实测巡检与优化/changed-files.md`
- `docs/task/界面实测巡检与优化/test-report.md`
- 第三阶段三个任务文件

构建过程刷新了被 Git 忽略的 manifest、seeds 与 `out/`；未记录或提交临时清单、截图、日志及这些生成产物。

## 2026-07-27 第四阶段

### 生成历史图片比例与持久化

- `src/workspaces/GenerationWorkspace/types.ts`
- `src/workspaces/GenerationWorkspace/utils/resultImageDimensions.ts`
- `src/workspaces/GenerationWorkspace/utils/resultImageDimensions.test.ts`
- `src/workspaces/GenerationWorkspace/hooks/useTaskState.ts`
- `src/workspaces/GenerationWorkspace/hooks/useTaskHistory.ts`
- `src/workspaces/GenerationWorkspace/components/TaskCard.tsx`
- `src/workspaces/GenerationWorkspace/components/TaskList.tsx`
- `src/workspaces/GenerationWorkspace.tsx`

### 文件职责拆分

- `src/workspaces/GenerationWorkspace/components/TaskCardToolbar.tsx`

### 任务记录

- `docs/task/界面实测巡检与优化/00-任务总览.md`
- `docs/task/界面实测巡检与优化/重要记录.md`
- `docs/task/界面实测巡检与优化/progress.md`
- `docs/task/界面实测巡检与优化/decisions.md`
- `docs/task/界面实测巡检与优化/handoff.md`
- `docs/task/界面实测巡检与优化/changed-files.md`
- `docs/task/界面实测巡检与优化/test-report.md`
- 第四阶段两个任务文件

确认 `react-window` 与 `@types/react-window` 仅存在于依赖清单、源码零使用；本阶段只记录清理建议，没有修改 `package.json` 或 lockfile。构建过程刷新了被 Git 忽略的 manifest、seeds 与 `out/`，均不纳入提交。
