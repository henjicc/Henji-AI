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
