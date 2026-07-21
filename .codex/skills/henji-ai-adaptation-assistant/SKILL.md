---
name: henji-ai-adaptation-assistant
description: 痕迹AI的统一适配助手，负责新增或调整 AI 供应商、模型、参数 schema、请求构建、轮询能力，以及新增或改造 ReactFlow 画布节点。适用于“新增供应商”“新增模型”“校对模型参数”“适配模型到画布”“新建画布节点”“规范化节点 UI、媒体端口或参数行”等需求；按需求只读取对应的模型或画布 workflow，组合需求按模型后画布的顺序处理。
---

# 痕迹AI适配助手

## 路由规则

先根据用户需求判断适配范围，只读取对应的专业 workflow：

- 涉及供应商、模型、参数、API、请求构建、轮询、价格或模型筛选：读取 `references/model/workflow.md`。
- 涉及画布节点、节点 UI、节点注册、端口、媒体输入、参数行或节点生成：读取 `references/canvas/workflow.md`。
- 同时涉及模型和画布：先读取 `references/model/workflow.md`，完成模型判断和确认后，再读取 `references/canvas/workflow.md`。

## 执行规则

- 读取 workflow 后，严格按照 workflow 中的路由继续读取专题文件。
- 主文件不要直接读取任何专题文件，不要因为需求中出现“适配”就同时读取两个分支。
- 组合需求中，如果模型 workflow 要求用户确认，先完成确认，再继续画布 workflow。
- workflow 负责具体实现方式、文件定位、架构约束、验证命令和完成标准；不要在本文件重复实现这些规则。
- 如果需求范围不明确，先判断属于模型适配、画布适配还是两者组合，再开始读取。
