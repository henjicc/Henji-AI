---
name: henji-ai-adaptation-assistant
description: 痕迹AI的组合适配路由。仅在同一任务确实同时涉及供应商/模型适配与 ReactFlow 画布节点结构改动，或用户明确点名本 skill 时使用；标准生成节点会自动读取模型 schema，“模型会出现在画布里”不算画布接入。纯模型任务使用 henji-model-adaptation，纯画布节点任务使用 canvas-node-builder。
---

# 痕迹AI适配助手

## 路由规则

- 供应商、模型、参数、API、请求构建、轮询、价格或模型筛选：完整读取并使用 [henji-model-adaptation](../henji-model-adaptation/SKILL.md)。
- 画布节点类型、节点 DOM、节点注册、端口、媒体输入行、结果节点或节点专属交互：完整读取并使用 [canvas-node-builder](../canvas-node-builder/SKILL.md)。
- 只改模型 schema、通用参数面板、显隐/联动/计价/request builder 时，即使这些变化会自动出现在画布，也只使用模型 skill；不要因此加载画布 skill。
- 同时涉及两者：先执行模型 skill 的确认与实现，再执行画布节点 skill；共享事实从模型注册源读取，不在两个 skill 之间复制参数说明。

## 执行规则

- 只加载任务实际命中的专业 skill 及其按需引用；本 skill 不维护第二份 workflow 或专题资料。
- 组合需求中，如果模型 skill 要求用户确认，先完成确认，再继续画布接入。
- 只有确认需要修改 `src/features/canvas/**`、节点注册/端口，或共享 `NodeParamControl` 无法消费新参数类型时，才把任务升级为组合需求。
- 验证范围统一服从 `docs/rules/testing.md`，两个专业 skill 只补领域专项检查，不重复跑互相包含的全量命令。
