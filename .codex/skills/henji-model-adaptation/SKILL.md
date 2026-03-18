---
name: henji-model-adaptation
description: 面向 Henji-AI 的模型与供应商适配工作流。用于“新增供应商”“给现有供应商新增模型”“模型和供应商都要新增”“校对参数顺序/隐藏参数/默认请求值”这类需求；先输出确认清单，用户确认后再实施。
---

# Henji Model Adaptation

按最小上下文加载执行。

## 1. 识别场景并路由

- 先读取 `references/intake-checklist.md`，输出精简确认清单并等待用户确认。
- 若用户需求是“新增供应商”，读取 `references/new-provider.md`。
- 若用户需求是“现有供应商新增模型”，读取 `references/new-model-existing-provider.md`。
- 若用户需求是“新模型且未接入对应供应商”，先读取 `references/new-provider.md`，再读取 `references/new-provider-and-model.md`。

## 2. 按需补充读取

- 设计参数顺序时，读取 `references/param-order-patterns.md`。
- 处理“不展示参数/固定默认请求值”时，读取 `references/hidden-default-params.md`。
- 判断图片/视频/音频差异时，读取 `references/modality-differences.md`。
- 涉及比例/分辨率时，优先执行“智能比例 + 本地转具体值”的规则（见 `references/param-order-patterns.md`）。

## 3. 执行规则

- 信息不足时，停止编码并向用户补充最小必要信息。
- 若用户未提供价格或计费规则，必须先追问价格，再继续模型实现。
- 优先复用同供应商、同模态、同模型家族的现有模型定义；仅将其作为起点，以官方 API 文档为准。
- 参数展示层可以做统一交互，但最终请求参数必须转换为 API 文档要求的字段和值。
- 严格走项目主链路：`GenerationService -> src/commands/aiRuntime.ts -> src-tauri/src/ai_runtime/*`。
- 禁止在业务 UI 写模型/供应商硬编码分支。
- 牢记 runtime 约束：`request.builder` 会被序列化为 `builderJs` 在 Rust JS 沙箱独立执行，不能依赖模型文件顶层 helper/闭包变量。
- 若模型在 `scripts/generate-model-manifest.cjs` 有 `CUSTOM_BUILDER_OVERRIDES`，修改模型 builder 时必须同步检查 override，避免 manifest 与源码行为不一致。

## 4. 完成标准

- 通过 `npm run build`。
- 新增能力不引入跨层调用与 UI 直连模型 API。
- 新增参数满足顺序约定，并明确“显示/请求”策略。
- 需要验证运行中的 Tauri 进程已加载新 manifest（重启 `npm run tauri:dev` 或执行 manifest reload 命令）。
