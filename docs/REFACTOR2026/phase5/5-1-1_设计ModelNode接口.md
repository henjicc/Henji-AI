# 5-1-1 设计ModelNode接口

## 目标

设计节点系统的核心接口 ModelNode，为画布模式（Canvas Mode）做准备，支持将模型配置转换为可连接的节点。

## 背景

新架构的最终目标是支持画布模式，允许用户通过拖拽和连接节点的方式组合多个 AI 模型。节点系统需要：
- 从 ModelDefinition 自动生成节点定义
- 支持输入/输出端口
- 支持节点间的数据流转
- 预留工具节点扩展接口

当前阶段（Phase 5）的目标是**设计接口，不实现完整的画布 UI**，确保模型配置支持节点化调用。

## 前置依赖

- [x] 1-1-1：定义ModelDefinition接口
- [x] 1-1-2：定义参数类型系统
- [ ] 1-5-1：迁移试点模型（至少有可用的模型配置）

## 实施步骤

### 1. 定义端口类型

- [ ] 创建 `src/core/types/NodePort.ts`
- [ ] 定义 InputPort 接口
- [ ] 定义 OutputPort 接口
- [ ] 定义端口数据类型（PortDataType）

```typescript
// 端口数据类型
type PortDataType =
  | 'string'      // 文本（如 prompt）
  | 'number'      // 数字
  | 'boolean'     // 布尔值
  | 'image'       // 图片（URL 或 base64）
  | 'video'       // 视频（URL）
  | 'audio'       // 音频（URL）
  | 'array'       // 数组
  | 'object'      // 对象
  | 'any'         // 任意类型

interface InputPort {
  id: string              // 端口 ID（对应参数 ID）
  name: I18nText          // 显示名称
  type: PortDataType      // 数据类型
  required: boolean       // 是否必需
  default?: any           // 默认值
  description?: I18nText  // 描述
}

interface OutputPort {
  id: string              // 端口 ID
  name: I18nText          // 显示名称
  type: PortDataType      // 输出类型
  description?: I18nText  // 描述
}
```

### 2. 定义节点接口

- [ ] 创建 `src/core/types/ModelNode.ts`
- [ ] 定义 ModelNode 接口
- [ ] 定义节点元数据
- [ ] 定义节点执行器

```typescript
interface ModelNode {
  // 节点标识
  id: string                      // 节点实例 ID（运行时生成）
  type: 'model'                   // 节点类型
  modelId: string                 // 对应的模型 ID

  // 元数据
  meta: {
    name: I18nText                // 节点名称
    description?: I18nText        // 节点描述
    icon?: string                 // 图标
    category: 'image' | 'video' | 'audio'  // 分类
    tags?: string[]               // 标签
  }

  // 端口定义
  inputs: InputPort[]             // 输入端口
  outputs: OutputPort[]           // 输出端口

  // 位置信息（画布中的位置）
  position?: {
    x: number
    y: number
  }

  // 执行函数
  execute: (inputs: Record<string, any>, context?: ExecutionContext) => Promise<NodeOutput>
}

interface NodeOutput {
  [portId: string]: any           // 每个输出端口的值
  _metadata?: {
    taskId?: string
    status?: string
    error?: string
  }
}

interface ExecutionContext {
  onProgress?: (status: ProgressStatus) => void
  signal?: AbortSignal            // 取消执行
}
```

### 3. 定义节点转换器接口

- [ ] 创建 `src/core/types/NodeConverter.ts`
- [ ] 定义从 ModelDefinition 到 ModelNode 的转换接口

```typescript
interface NodeConverter {
  /**
   * 将模型定义转换为节点定义
   */
  modelToNode(model: ModelDefinition): ModelNode

  /**
   * 将参数定义转换为输入端口
   */
  paramsToInputPorts(params: ParamDef[]): InputPort[]

  /**
   * 根据模型类型生成输出端口
   */
  getOutputPorts(modelType: 'image' | 'video' | 'audio'): OutputPort[]
}
```

### 4. 定义工具节点接口

- [ ] 创建 `src/core/types/ToolNode.ts`
- [ ] 定义通用工具节点接口
- [ ] 预留常用工具节点类型

```typescript
// 工具节点类型
type ToolNodeType =
  | 'image-crop'          // 图片裁剪
  | 'image-resize'        // 图片缩放
  | 'prompt-template'     // 提示词模板
  | 'text-concat'         // 文本拼接
  | 'conditional'         // 条件分支
  | 'loop'                // 循环
  | 'custom'              // 自定义

interface ToolNode {
  id: string
  type: ToolNodeType
  meta: {
    name: I18nText
    description?: I18nText
    icon?: string
  }
  inputs: InputPort[]
  outputs: OutputPort[]
  position?: { x: number; y: number }
  execute: (inputs: Record<string, any>) => Promise<NodeOutput>

  // 工具节点特有配置
  config?: Record<string, any>
}
```

### 5. 定义节点连接接口

- [ ] 创建 `src/core/types/NodeConnection.ts`
- [ ] 定义节点间的连接关系

```typescript
interface NodeConnection {
  id: string                      // 连接 ID
  source: {
    nodeId: string                // 源节点 ID
    portId: string                // 源端口 ID
  }
  target: {
    nodeId: string                // 目标节点 ID
    portId: string                // 目标端口 ID
  }

  // 数据转换（可选）
  transform?: (value: any) => any
}
```

### 6. 定义画布工作流接口

- [ ] 创建 `src/core/types/Workflow.ts`
- [ ] 定义完整的工作流结构

```typescript
interface Workflow {
  id: string
  name: string
  description?: string

  // 节点列表
  nodes: Array<ModelNode | ToolNode>

  // 连接列表
  connections: NodeConnection[]

  // 元数据
  createdAt: Date
  updatedAt: Date
  version: string
}
```

### 7. 导出所有接口

- [ ] 更新 `src/core/types/index.ts`
- [ ] 导出所有节点相关类型

```typescript
export * from './NodePort'
export * from './ModelNode'
export * from './ToolNode'
export * from './NodeConverter'
export * from './NodeConnection'
export * from './Workflow'
```

## 涉及文件

### 新建文件
- `src/core/types/NodePort.ts` - 端口类型定义
- `src/core/types/ModelNode.ts` - 模型节点接口
- `src/core/types/ToolNode.ts` - 工具节点接口
- `src/core/types/NodeConverter.ts` - 节点转换器接口
- `src/core/types/NodeConnection.ts` - 节点连接接口
- `src/core/types/Workflow.ts` - 工作流接口

### 修改文件
- `src/core/types/index.ts` - 添加导出

## 验收标准

- [ ] 所有节点接口定义完整，覆盖核心功能
- [ ] 接口设计支持从 ModelDefinition 自动生成节点
- [ ] 预留工具节点扩展接口
- [ ] 支持节点间的数据连接
- [ ] 所有接口有完整的 TypeScript 类型定义
- [ ] 所有接口有清晰的 JSDoc 注释
- [ ] TypeScript 编译通过

## 测试方法

### 1. 类型检查测试

```typescript
// 验证接口定义可用
const testNode: ModelNode = {
  id: 'node-1',
  type: 'model',
  modelId: 'wan-2.6',
  meta: {
    name: { zh: 'Wan 2.6', en: 'Wan 2.6' },
    category: 'video'
  },
  inputs: [
    {
      id: 'prompt',
      name: { zh: '提示词', en: 'Prompt' },
      type: 'string',
      required: true
    }
  ],
  outputs: [
    {
      id: 'output',
      name: { zh: '视频', en: 'Video' },
      type: 'video'
    }
  ],
  execute: async (inputs) => {
    return { output: 'test-url' }
  }
}
```

### 2. 接口兼容性测试

```typescript
// 验证接口与 ModelDefinition 兼容
function testConversion(model: ModelDefinition): ModelNode {
  // 这里只是类型检查，实际转换在 5-1-2 实现
  const node: ModelNode = {
    id: `node-${model.meta.id}`,
    type: 'model',
    modelId: model.meta.id,
    meta: {
      name: model.meta.name,
      description: model.meta.description,
      category: model.meta.type
    },
    inputs: [],
    outputs: [],
    execute: async () => ({ output: null })
  }
  return node
}
```

### 3. 工具节点接口测试

```typescript
// 验证工具节点接口
const cropNode: ToolNode = {
  id: 'tool-crop-1',
  type: 'image-crop',
  meta: {
    name: { zh: '图片裁剪', en: 'Crop Image' }
  },
  inputs: [
    { id: 'image', name: { zh: '图片', en: 'Image' }, type: 'image', required: true },
    { id: 'width', name: { zh: '宽度', en: 'Width' }, type: 'number', required: true },
    { id: 'height', name: { zh: '高度', en: 'Height' }, type: 'number', required: true }
  ],
  outputs: [
    { id: 'output', name: { zh: '裁剪后图片', en: 'Cropped Image' }, type: 'image' }
  ],
  execute: async (inputs) => {
    // 实现裁剪逻辑
    return { output: 'cropped-image-url' }
  }
}
```

## 设计原则

### 1. 灵活性优先
- 接口应足够通用，支持各种模型类型
- 预留扩展字段，方便未来添加功能

### 2. 类型安全
- 使用 TypeScript 严格类型检查
- 使用联合类型和泛型提高类型安全

### 3. 简洁性
- 接口定义简洁明了
- 避免过度设计

### 4. 兼容性
- 与现有 ModelDefinition 保持兼容
- 预留向后兼容空间

## 风险与注意事项

### 风险
- 接口设计不够灵活，后续需要大改
- 端口类型定义不够全面

### 注意事项
- 这个阶段只设计接口，不实现完整的画布 UI
- 接口应该是通用的，不针对特定的画布库（如 ReactFlow）
- 考虑节点执行的异步性和错误处理
- 考虑节点间的数据类型转换
- 预留节点验证功能

## 参考资料

- ReactFlow 文档：https://reactflow.dev/
- ComfyUI 节点系统设计
- n8n 工作流引擎架构

## 后续任务

完成此任务后，下一步是：
- 5-1-2：实现模型到节点的转换逻辑
- 5-2-1：预留工具节点接口（扩展常用工具）

## 回滚方案

- 删除所有新建的节点类型文件
- 从 `src/core/types/index.ts` 移除相关导出
- Git revert 相关提交
