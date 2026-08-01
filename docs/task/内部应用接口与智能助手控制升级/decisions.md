# 决策记录

## 第一阶段开始时继承的决定

- 内部 Application API 与 React、Electron IPC、Agent 工具协议和网络传输解耦。
- `ApplicationCapabilityDefinition` 继续作为语义操作的唯一元数据源。
- 禁止任意脚本、任意 Store Patch、任意 IPC 和裸本地路径进入控制契约。
- 旧能力在所属领域迁移完成后删除；历史调用只读展示，不恢复或重放。
- 详细跨阶段决定继续以 `重要记录.md` 为准。

## 2026-08-01 · 契约冻结

- 核心契约版本固定为 `application-control/v1`，应用能力目录升级为 `application-capabilities/v2`。
- 属性修改只能引用注册表声明的稳定属性 ID；契约不承载代码、函数或 Store 路径。
- 媒体观察只传稳定媒体引用和应用内 Surface 标识，不传裸本地路径。
- 调用方中立操作状态通过 `src/core/assistant/applicationControlMapping.ts` 单向映射到现有 Agent 状态。
