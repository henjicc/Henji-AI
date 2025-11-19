# 模型与供应商适配指南

本文档旨在指导开发者如何为 Henji AI 添加新的模型供应商（Provider）或接入新的模型（Model）。

## 核心架构概述

Henji AI 的模型适配分为前端和后端两个部分：

1.  **前端 (Frontend)**:
    *   **配置**: `src/config/providers.json` 定义供应商和模型列表。
    *   **Schema**: `src/schemas/modelParams.ts` 定义模型的参数表单结构（Schema-Driven UI）。
    *   **UI**: `MediaGenerator.tsx` 根据 Schema 渲染表单，收集用户输入。

2.  **后端/适配层 (Adapter Layer)**:
    *   **接口**: `src/adapters/base/BaseAdapter.ts` 定义统一的 `MediaGeneratorAdapter` 接口。
    *   **实现**: 具体适配器（如 `PPIOAdapter.ts`）实现接口，负责参数转换、API 调用和结果标准化。
    *   **工厂**: `src/adapters/index.ts` 负责实例化适配器。

---

## 接入流程

### 1. 添加新供应商 (Provider)

如果要接入一个新的 API 服务商（例如 OpenAI, Stability AI）：

1.  **定义适配器**:
    *   在 `src/adapters/` 下创建新的适配器文件（如 `OpenAIAdapter.ts`）。
    *   实现 `MediaGeneratorAdapter` 接口。
    *   实现 `generateImage`, `generateVideo`, `generateAudio`, `checkStatus` 方法。

2.  **注册适配器**:
    *   修改 `src/adapters/index.ts`。
    *   在 `AdapterType` 中添加新类型。
    *   在 `AdapterFactory.createAdapter` switch 语句中添加实例化逻辑。

3.  **配置供应商**:
    *   修改 `src/config/providers.json`，添加新的供应商条目。

### 2. 添加新模型 (Model)

如果要为现有供应商添加新模型（或为新供应商添加模型）：

#### 第一步：后端适配

1.  **修改适配器**:
    *   在对应的 Adapter 类中（如 `PPIOAdapter.ts`），找到生成方法（如 `generateVideo`）。
    *   添加针对新 `model` ID 的分支逻辑。
    *   **参数归一化**: 将前端传来的通用参数（`GenerateVideoParams`）转换为该模型 API 所需的特定参数格式。
    *   **API 调用**: 构造请求并调用 API。
    *   **结果处理**: 将 API 响应转换为统一的 `ImageResult`, `VideoResult` 或 `AudioResult`。

#### 第二步：前端配置与 Schema

1.  **注册模型**:
    *   在 `src/config/providers.json` 中，将新模型添加到对应供应商的 `models` 列表中。

2.  **定义参数 Schema**:
    *   打开 `src/schemas/modelParams.ts`。
    *   定义一个新的 `ParamDef[]` 数组，描述该模型所需的参数（如下拉框、开关、数字输入等）。
    *   可以使用 `hidden` 属性处理参数间的联动显示（如：开启"批量生成"后隐藏"数量"）。

3.  **绑定 Schema**:
    *   打开 `src/components/MediaGenerator.tsx`。
    *   引入新定义的 Schema。
    *   在 `handleSchemaChange` 中添加新参数的状态更新逻辑（如果需要）。
    *   在 JSX 渲染部分，添加条件渲染块，当选中该模型时渲染对应的 `<SchemaForm />`。

---

## 详细规范

### 参数 Schema 定义 (`ParamDef`)

位于 `src/types/schema.ts`，支持以下类型：

*   `dropdown`: 下拉选择框 (支持 `options` 动态生成)
*   `number`: 数字输入框 (支持 `min`, `max`, `step`)
*   `toggle`: 开关 (支持 `toValue`/`fromValue` 值转换)
*   `text`: 文本输入框
*   `textarea`: 多行文本输入框

**示例**:
```typescript
export const myModelParams: ParamDef[] = [
  {
    id: 'quality',
    label: '画质',
    type: 'dropdown',
    options: [
      { label: '标准', value: 'standard' },
      { label: '高清', value: 'hd' }
    ],
    defaultValue: 'standard'
  }
]
```

### 适配器接口 (`MediaGeneratorAdapter`)

位于 `src/adapters/base/BaseAdapter.ts`。所有适配器必须返回统一的结果格式：

*   **ImageResult**: `{ url: string }` (支持多张图片用 `|||` 分隔)
*   **VideoResult**: `{ taskId: string, status: 'TASK_STATUS_QUEUED' }` (异步任务)
*   **AudioResult**: `{ url: string }`

---

### Schema 高级特性

Schema 系统支持多种动态行为，满足复杂的参数交互需求：

1.  **动态可见性 (`hidden`)**:
    通过函数控制参数的显示与隐藏。
    ```typescript
    {
      id: 'max_images',
      type: 'number',
      // 仅当 sequential_image_generation 为 'auto' 时显示
      hidden: (values) => values.sequential_image_generation !== 'auto'
    }
    ```

2.  **动态选项 (`options`)**:
    下拉框的选项可以根据当前其他参数的值动态生成。
    ```typescript
    {
      id: 'resolution',
      type: 'dropdown',
      // 根据选中的 aspect_ratio 返回不同的分辨率选项
      options: (values) => values.aspect_ratio === '16:9' ? options169 : options916
    }
    ```

3.  **值转换 (`toValue` / `fromValue`)**:
    用于 `toggle` 类型，当 UI 状态 (boolean) 与实际参数值 (string/number) 不一致时使用。
    ```typescript
    {
      id: 'batch_mode',
      type: 'toggle',
      // UI 开(true) -> 参数 'enabled'
      toValue: (checked) => checked ? 'enabled' : 'disabled',
      // 参数 'enabled' -> UI 开(true)
      fromValue: (val) => val === 'enabled'
    }
    ```

4.  **工具提示 (`tooltip`)**:
    为参数添加悬停提示，解释参数含义。
    ```typescript
    {
      id: 'cfg_scale',
      type: 'number',
      tooltip: '提示词相关性，值越高越忠实于提示词',
      tooltipDelay: 500 // 毫秒
    }
    ```

### 混合开发模式

虽然推荐使用 `SchemaForm`，但对于极度复杂的自定义 UI（如 Minimax Speech 的音色选择器），可以采用混合模式：

1.  **基础参数**: 使用 `SchemaForm` 渲染。
2.  **复杂组件**: 保留或新建 React 组件（如 `PanelTrigger`）。
3.  **布局**: 在 `MediaGenerator.tsx` 中灵活组合。

```tsx
{/* 基础参数 */}
<SchemaForm schema={basicParams} ... />

{/* 自定义复杂组件 */}
<PanelTrigger label="音色" ... />

{/* 高级参数 */}
<SchemaForm schema={advancedParams} ... />
```

### 错误处理与调试

*   **Adapter 错误**: 使用 `handleError` 方法统一包装错误。对于 API 返回的错误信息，尽量保留原始 message 以便排查。
*   **日志**: 建议在 Adapter 的关键步骤（请求参数构建、API 响应接收）添加 `console.log`，方便在开发者工具中调试。

---

## 最佳实践

1.  **参数命名一致性**: 尽量复用现有的参数 ID（如 `resolution`, `aspectRatio`, `duration`），以便在切换模型时保留用户设置。
2.  **参数归一化**: 在 Adapter 内部处理参数值的映射（例如前端用 `16:9`，后端可能需要 `1.77` 或 `1`），保持前端逻辑纯净。
3.  **Schema 驱动**: 尽量使用 `SchemaForm` 渲染参数，避免在 `MediaGenerator.tsx` 中写硬编码的 UI。
