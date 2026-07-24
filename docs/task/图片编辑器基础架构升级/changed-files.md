# 文件变更记录

## 2026-07-25 第一阶段启动

### 已修改

- `docs/task/图片编辑器基础架构升级/00-任务总览.md`：同步第一阶段与任务 1.1 状态。
- `docs/task/图片编辑器基础架构升级/任务/第一阶段-领域契约与兼容基础/1.1-建立图片编辑文档与兼容契约.md`：同步任务开始状态。

### 已新增

- `progress.md`：持续记录阶段与任务进度。
- `decisions.md`：记录执行期间形成的关键决定。
- `handoff.md`：维护无历史对话下的继续工作入口。
- `changed-files.md`：维护实际文件变更清单。
- `test-report.md`：累计最终统一测试项。

### 功能代码

- `src/core/imageEdit/types.ts`：新增 V2、V1 兼容和标注核心类型。
- `src/core/imageEdit/markCodec.ts`：迁入标注清洗、解析与序列化。
- `src/core/imageEdit/document.ts`：新增 V1/V2 投影、回写和效果判断。
- `src/core/imageEdit/documentCodec.ts`：新增 V2 严格解码和旧格式迁移。
- `src/core/imageEdit/legacy.ts`：迁入旧编辑状态和旧会话兼容。
- `src/core/imageEdit/operations.ts`：新增操作定义与注册表。
- `src/core/imageEdit/execution.ts`：新增执行端口契约。
- `src/core/imageEdit/index.ts`、`src/core/index.ts`：导出图片编辑核心。
- `src/features/imageEdit/execution/browserImageEditExecution.ts`：新增现有 Canvas 导出的执行端口适配。
- `src/features/imageEdit/index.ts`：导出图片编辑功能入口。
- `src/features/imageMark/domain/types.ts`、`codec.ts`、`legacy.ts`：改为核心契约兼容导出。
- `src/features/imageMark/index.ts`：补充 V2 兼容导出。

## 第一阶段收口

- 功能代码新增 10 个文件，修改 5 个兼容导出文件。
- `src/core/imageEdit/` 无 React、画布、store 或 Electron 实现依赖。
- 第一阶段提交：`d85a15c`（refactor: 建立图片编辑核心契约与执行端口）。

## 第二阶段启动

- 2026-07-25：开始任务 2.1；后续修改会追加到本文件。

## 第二阶段变更

- `src/features/imageMark/editor/MarkEditorContext.tsx`：新增标注编辑器控制器上下文。
- `src/features/imageMark/editor/useMarkHistory.ts`：导出可注入的历史控制器接口。
- `src/features/imageMark/editor/useMarkController.ts`：接收外部历史并统一撤销/重做后的互动清理。
- `src/features/imageMark/editor/MarkToolbar.tsx`：增加 `legacy/annotation` 变体，顶部 shell 只保留标注工具。
- `src/features/imageMark/editor/MarkEditor.tsx`：接入受控文档控制器、上下文和 shell 布局。
- `src/features/imageEdit/editor/ImageEditorShell.tsx`：新增共享图片编辑器外壳与可伸缩检查器。
- `src/features/imageEdit/editor/useImageEditorSession.ts`：新增 V2 会话、历史和 V1 标注投影适配。
- `src/features/imageEdit/editor/ImageEditor.tsx`：新增统一图片编辑器入口。
- `src/features/imageEdit/editor/ImageToolRail.tsx`、`ImageToolInspector.tsx`、`ImageToolPanel.tsx`：新增工具栏与参数面板容器。
- `src/features/imageEdit/tools/`：新增工具定义、注册表和几何 Inspector。
- `src/features/imageEdit/store/imageEditorUiStore.ts`：新增面板宽度、折叠和当前 Inspector 偏好。
- `src/features/imageEdit/index.ts`：导出第二阶段编辑器能力。

### 第二阶段提交

- 第二阶段提交：`refactor: 重构图片编辑器会话与可伸缩工具面板`。

## 第三阶段启动

- 2026-07-25：读取并确认 3.1、3.2、3.3 任务文件，开始宿主适配迁移。
- 本阶段代码变更将在各任务完成后追加；测试只更新 `test-report.md`，不在阶段内执行。

## 第三阶段变更

### 3.1 工具箱与查看器宿主

- `src/features/imageMark/standalone/ImageMarkTool.tsx`：宿主改用 V2 文档、共享 `ImageEditor` 和统一导出端口，保留打开/拖入/粘贴/复制/保存/入库能力。
- `src/features/imageMark/viewer/ViewerMarkEditor.tsx`：兼容读取旧会话，保存返回 V2 `ImageEditSession`。
- `src/components/mediaViewer/ImageViewerModal.tsx`：查看器编辑边界改用 V2 会话。
- `src/workspaces/GenerationWorkspace.tsx`、`types.ts`、`hooks/useTaskReplay.ts`、`hooks/useTaskGeneration.ts`、`application/visibleGenerationTaskCommand.ts`：内存、落盘和任务重放链路迁移到 V2 会话，旧数据继续兼容读取。

### 3.2 画布适配

- `src/features/canvas/tools/types.ts`、`registry.ts`、`builtInTools.ts`：注册对话框策略、结果标题、核心操作 ID 和重复/未知操作诊断。
- `src/features/canvas/ui/tool-editors/EditToolEditor.tsx`：挂载共享 `ImageEditor`，双写 V2 `document` 与旧 `markDoc`。
- `src/features/canvas/ui/NodeToolDialog.tsx`、`NodeActionToolbar.tsx`：标题、宽度、预加载、结果标题和工具标签改由插件声明驱动。
- `src/features/canvas/application/toolProcessor.ts`：编辑/切割改为 handler 映射分发，图片编辑通过统一执行端口输出。

### 3.3 智能助手协议

- `src/features/assistant/imageEditAdapter.ts`：新增旧助手操作到 V2 图片编辑文档的纯转换适配器。
- `src/features/assistant/hostActions.ts`：移除逐操作文档拼装，预览和提交复用统一执行端口，增加有界预览生命周期及结构化日志。

### 第三阶段验证状态

- 已完成变更范围、文件体积、裸 `any`、颜色字面量、原生控件和 `git diff --check` 的非执行审查。
- 自动测试、TypeScript、ESLint、Electron 与鼠标交互验证按约定留到第四阶段统一执行。

## 第四阶段变更

### 兼容与编辑器收口

- `src/core/imageEdit/documentCodec.ts`：V2 操作严格校验 `enabled`、旋转与镜像参数，非法数据确定回退。
- `src/core/imageEdit/legacy.ts`：移除未使用的兼容解析导入。
- `src/features/imageEdit/editor/useImageEditorSession.ts`：修复撤销后重做快照读取时序。
- `src/features/imageEdit/editor/ImageEditorShell.tsx`：修复检查器纵向布局并复用可测试的视口宽度约束。
- `src/features/imageEdit/store/imageEditorUiStore.ts`：新增检查器视口宽度约束函数。
- `src/features/imageEdit/tools/geometry/GeometryInspector.tsx`、`src/features/imageMark/editor/MarkEditor.tsx`、`MarkEditorContext.tsx`、`useMarkController.ts`：调整 Context 边界和 hook 依赖。
- `src/features/imageMark/editor/markEditorContextValue.ts`、`useMarkEditorContext.ts`：拆分 Context 值与消费 hook，消除热更新告警和 Windows 文件名大小写冲突。
- `src/features/canvas/tools/registry.ts`：导出注册表工厂，便于重复注册与未知核心操作验证。

### 新增专项测试

- `src/core/imageEdit/imageEdit.test.ts`：覆盖 V1/V2/旧会话迁移、未知操作保留、非法参数和操作执行端口。
- `src/features/imageEdit/editor/useImageEditorSession.test.tsx`：覆盖统一历史、未来操作保留和面板宽度约束。
- `src/features/canvas/tools/registry.test.ts`：覆盖画布注册策略、双格式初值和非法注册。
- `src/features/canvas/application/toolProcessor.test.ts`：覆盖 V2 优先、旧 `markDoc` 回退和未知工具分发。
- `src/features/assistant/imageEditAdapter.test.ts`：覆盖助手操作转换、全部标注类型和裁剪边界。

### Electron 自动化

- `scripts/lib/electronLaunch.cjs`：增加有界进程输出、退出等待、隔离用户目录和经过路径校验的临时目录清理。
- `scripts/electron-phase4-smoke.cjs`：启用隔离测试数据，并为控制台错误补充来源位置。
- `scripts/electron-phase4-dpi-check.cjs`：启用隔离测试数据。

### 第四阶段验证状态

- 图片编辑定向测试 17 项和全量 Vitest 404 项通过。
- 颜色检查、前端/主进程 ESLint、Electron TypeScript、构建、smoke、6 组 DPI 检查和 `git diff --check` 通过。
- 真实 Electron 鼠标交互保留到最终人工验收，所有任务状态保持待验证。
