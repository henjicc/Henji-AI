# 场景 C：新模型且供应商未接入

执行顺序必须是“先供应商，再模型”。

## Phase 0：先判断是否真的“新供应商”

- 若 `providerId` 已在现有模型中出现，改走“场景 B”。
- 若只是同供应商新版本模型，不要重复创建 provider。

## Phase 1：最小供应商闭环

- 按 `new-provider.md` 完成 Electron runtime + key 管理 + 前端 provider 元信息。
- 先让一个最小 smoke 模型跑通提交/轮询/结果落地。

## Phase 2：目标模型适配

- 按 `new-model-existing-provider.md` 适配目标模型。
- 设计参数顺序时读取 `param-order-patterns.md`。
- 处理隐藏/固定参数时读取 `hidden-default-params.md`。
- 若用户未提供价格，先补齐价格策略再继续。

## Phase 3：用户确认门

- 每个 phase 开始前都输出一次简化确认清单：
  - 当前 phase 目标
  - 计划改动文件
  - 关键接口契约
- 缺少关键接口字段就停下补充，不硬猜。

## 快速决策

- 如果用户只给“模型名”但没给 provider：先追问 provider 或 API 文档链接。
- 如果用户给的 provider 命名与系统现有命名冲突：先确认最终 `providerId`。
- 如果用户要求“尽快可用”：先交付最小参数集，后续再补高级参数。
