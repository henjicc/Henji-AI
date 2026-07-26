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
