# 遗留代码清理报告

> 生成时间：2026-01-22

## 1. 总结

根据 Refactor 2026 重构计划（Phase 6.2），我们对项目进行了扫描，以识别遗留和未使用的文件。
目前来看，向 **配置驱动架构 (Configuration-Driven Architecture)** 的迁移非常顺利。

## 2. 检查结果

### ✅ 已清理/已迁移
原始计划中提到的以下项目已经被移除或替换：
*   `useMediaGeneratorState`: **已删除**。（已被 `useUIState` 和 `useModelState` 替代）
*   `OptionsBuilder` (旧版): **已删除**。（已被 `src/core/request/RequestBuilder` 替代）

### ⚠️ 待删除的遗留文件
我们发现以下文件是遗留物，在当前代码库中已不再使用：

| 文件路径 | 状态 | 建议 |
| :--- | :--- | :--- |
| `src/components/MediaGenerator/utils/getModelParams.ts` | **未使用** (0 引用) | **删除**。该文件包含硬编码的参数映射逻辑 (`switch-case`)，已被 `ModelRegistry` 和 `linkage`（联动）系统取代。 |

### ℹ️ 已验证的活跃文件
以下文件曾被标记为疑似遗留，经核实**仍在使用中**：
*   `src/utils/parameterMigration.ts`: 用于 `ConversationWorkspace.tsx` 中迁移历史会话数据。
*   `src/utils/stateManager.ts`: 通用工具，可能被新的预设系统使用。
*   `src/components/MediaGenerator/hooks/useGenerationHandler.ts`: 已更新，正在使用新的 `RequestBuilder`。

## 3.这也是个动作计划

1.  [x] 删除 `src/components/MediaGenerator/utils/getModelParams.ts` (已完成)

请确认是否允许我删除该文件？
