# 模型适配指南（新架构）

## 概述

本指南介绍如何在新的 `.model.ts` 架构下为现有供应商添加新模型。

## 核心流程

```
创建模型文件 → 定义模型配置 → 注册到 ModelRegistry → 更新 providers.json
```

## 快速开始

### 1. 创建模型文件

**位置**: `src/models/{provider}/{model-name}.model.ts`

**基础模板**:
```typescript
import { defineModel } from '@/core'

export const yourModel = defineModel({
  meta: {
    id: 'provider-model-name',
    provider: 'provider',
    type: 'image',
    name: 'Model Name',
    description: '模型描述',
    tags: ['image', 'text-to-image']
  },
  params: [],
  linkages: [],
  endpoints: {
    selector: async (params) => 'endpoint-name'
  },
  request: {
    builder: (params) => ({
      prompt: params.prompt || ''
    })
  },
  pricing: {
    currency: '¥',
    calculator: () => 0.1,
    description: '基础价格 ¥0.1/次'
  }
})
```

### 2. 添加参数定义

**参数类型**:
- `text`: 文本输入
- `number`: 数字输入
- `dropdown`: 下拉选择
- `radio`: 单选按钮
- `switch`: 开关
- `slider`: 滑块

**示例**:
```typescript
params: [
  {
    id: 'aspectRatio',
    type: 'dropdown',
    order: 1,
    label: { zh: '宽高比', en: 'Aspect Ratio' },
    defaultValue: '16:9',
    options: [
      { value: '16:9', label: '16:9' },
      { value: '1:1', label: '1:1' }
    ]
  }
]
```

### 3. 注册到模型索引

**位置**: `src/models/{provider}/index.ts`

```typescript
import { yourModel } from './your-model.model'

export {
  yourModel
}
```

### 4. 验证编译

```bash
npx tsc --noEmit
```

## 完整示例

参考已迁移的模型：
- 简单模型: `src/models/kie/z-image.model.ts`
- 中等复杂: `src/models/fal/nano-banana.model.ts`
- 复杂模型: `src/models/ppio/kling-o1.model.ts`

