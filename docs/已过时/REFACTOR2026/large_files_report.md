# 代码库体积与解耦合分析报告

> 生成时间：2026-01-22

## 1. 概述

为了确保代码的可维护性和解耦合原则（单文件 < 400 行），我们对全项目代码进行了扫描。
扫描结果显示，目前共有 **16个** 文件超过了 400 行的建议限制。其中 `ConversationWorkspace.tsx` 是最大的单体文件，也是后续重构的重点对象。

值得注意的是，核心组件 `MediaGenerator/index.tsx` 经过之前的重构，已从 2000+ 行成功缩减至 **404行**，基本达标。

## 2. 大文件清单 (Top Offenders)

| 文件路径 | 行数 | 风险等级 | 建议操作 |
| :--- | :--- | :--- | :--- |
| `src/workspaces/ConversationWorkspace.tsx` | **3859** | 🔴 极高 | **需要拆分**。这是目前最大的痛点，包含了过多的业务逻辑、UI 状态和事件处理。 |
| `src/config/pricing.ts` | **1364** | 🟠 中 | **数据文件**。包含大量定价数据，建议拆分为多个 JSON 或独立模块，或保持原样（配置类文件可放宽限制）。 |
| `src/components/SettingsModal.tsx` | **1160** | 🔴 高 | **能够拆分**。包含了所有设置项的 UI 和逻辑，应按 Tab 页拆分为子组件（如 `GeneralSettings`, `ModelSettings` 等）。 |
| `src/components/ImageEditor/ImageEditor.tsx` | **1153** | 🔴 高 | **需要拆分**。图像编辑器逻辑复杂，建议提取 hooks 和子组件（如 `EditorCanvas`, `Toolbar`）。 |
| `src/utils/imageConversion.ts` | **638** | 🟡 低 | 工具库。包含各种转换逻辑，可按功能拆分。 |
| `src/core/types/ParamDef.ts` | **583** | 🟡 低 | 类型定义。可接受。 |
| `src/utils/save.ts` | **578** | 🟡 中 | 核心存储逻辑。可将数据库操作与文件操作分离。 |
| `src/components/MediaGenerator/components/InputArea.tsx` | **568** | 🟡 中 | 输入区域组件。拖拽处理、粘贴处理逻辑可提取为 Hooks。 |
| `src/adapters/fal/FalAdapter.ts` | **552** | 🟡 中 | 适配器。随着模型增加会继续增长，建议按模型族进一步拆分 Handler。 |
| `src/core/ModelRegistry.ts` | **540** | 🟡 低 | 核心注册表。虽然稍大，但逻辑内聚，暂不建议过度拆分。 |

## 3. 详细解耦合建议

### 3.1 `ConversationWorkspace.tsx` (3859行 → < 400行)
**策略**：
1.  **提取自定义 Hooks**:
    *   `useConversationState`: 管理会话列表、当前会话。
    *   `useMessageHandling`: 处理消息发送、接收、流式更新。
    *   `useScrollBehavior`: 处理滚动逻辑。
2.  **组件拆分**:
    *   `Sidebar/`: 侧边栏及历史记录列表。
    *   `ChatArea/`: 聊天消息流展示区。
    *   `EmptyState/`: 空状态展示。

### 3.2 `SettingsModal.tsx` (1160行 → < 400行)
**策略**：
1.  **Tab页组件化**: 将每个设置 Tab 提取为独立组件：
    *   `settings/GeneralTab.tsx`
    *   `settings/ModelsTab.tsx`
    *   `settings/StorageTab.tsx`
2.  **配置逻辑分离**: 使用 `useSettings` hook 统一管理读写配置，UI 组件只负责展示。

### 3.3 `InputArea.tsx` (568行 → < 300行)
**策略**：
1.  **逻辑提取**:
    *   `useDragAndDrop`: 现有的 Hook 似乎未完全覆盖所有 UI 逻辑，需进一步瘦身。
    *   `usePasteHandler`: 专门处理剪贴板事件。
2.  **子组件**:
    *   `ModelTags`: 模型标签展示区域。
    *   `ActionButtons`: 发送、停止等按钮组。

## 4. 下一步行动

建议在后续开发中优先处理 `SettingsModal` 的拆分，因为其风险较低且收益明显。`ConversationWorkspace` 较为核心，建议在有完整测试覆盖后进行渐进式重构。
