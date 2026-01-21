# 1-4-1 实现RequestBuilder

## 目标

实现统一的请求构建器 RequestBuilder，整合新旧 OptionsBuilder 系统，为模型生成 API 请求

## 背景

当前问题：
- 存在两套系统：旧的 `optionsBuilder.ts`（硬编码）和新的 `builders/configs/*.ts`（配置驱动）
- 参数到 API 的映射分散在多处
- 每个模型需要重复编写映射逻辑

新架构目标（REFACTOR_PLAN.md 决策 6）：
- 统一入口 `RequestBuilder`
- 优先使用新配置（从 ModelDefinition）
- 降级到旧系统（兼容现有模型）
- 渐进式迁移

## 前置依赖

- [x] 1-1-1：定义ModelDefinition接口
- [x] 1-2-1：实现ModelRegistry核心
- [x] 1-3-1：实现useModelParams Hook

## 实施步骤

1. [ ] 创建 RequestBuilder 类
   - 创建 `src/core/request/RequestBuilder.ts`
   - 定义构建接口
   - 支持双引擎架构

2. [ ] 实现新配置引擎
   - 从 ModelDefinition 读取配置
   - 应用 apiField 简单映射
   - 应用 apiTransform 转换
   - 应用 apiMapping 端点相关映射
   - 合并 request.base 基础参数

3. [ ] 实现旧系统兼容
   - 集成现有 `optionsBuilder.ts`
   - 集成 `builders/configs/*.ts`
   - 检测模型是否有新配置
   - 降级到旧系统

4. [ ] 实现端点选择
   - 调用 ModelRegistry.selectEndpoint()
   - 根据端点应用不同映射
   - 处理单端点简化情况

5. [ ] 实现参数预处理
   - 应用 request.preprocess 函数
   - 类型转换（string/number/boolean）
   - 过滤空值和无效值

6. [ ] 实现参数验证
   - 验证必需参数
   - 验证参数类型
   - 验证参数范围
   - 提供友好错误信息

7. [ ] 添加调试支持
   - 记录构建过程日志
   - 输出最终请求体
   - 集成测试模式

8. [ ] 性能优化
   - 缓存映射规则
   - 减少重复计算
   - 使用对象池

## 涉及文件

### 新建文件
- `src/core/request/RequestBuilder.ts` - 请求构建器
- `src/core/request/paramMapper.ts` - 参数映射工具
- `src/core/request/paramValidator.ts` - 参数验证器
- `src/core/request/index.ts` - 导出

### 修改文件
- 无（保留旧系统，纯新增）

## 验收标准

- [ ] 成功构建新配置模型的请求
- [ ] 成功降级到旧系统
- [ ] 参数映射正确（apiField, apiTransform, apiMapping）
- [ ] 端点选择正确
- [ ] 参数验证有效
- [ ] 性能良好（单次构建 < 5ms）
- [ ] 包含完整的 TypeScript 类型
- [ ] 包含调试日志

## 测试方法

1. 测试新配置引擎
```typescript
import { RequestBuilder } from '@/core/request'

// 注册测试模型
registry.register({
  meta: {
    id: 'test-new',
    provider: 'test',
    type: 'image',
    name: { zh: '新配置测试', en: 'New Config Test' }
  },
  params: [
    {
      id: 'quality',
      component: 'dropdown',
      name: { zh: '质量', en: 'Quality' },
      order: 1,
      valueType: 'string',
      default: 'standard',
      options: [
        { value: 'standard', label: { zh: '标准', en: 'Standard' } },
        { value: 'hd', label: { zh: '高清', en: 'HD' } }
      ],
      apiField: 'quality'
    },
    {
      id: 'size',
      component: 'number',
      name: { zh: '尺寸', en: 'Size' },
      order: 2,
      valueType: 'number',
      default: 1024,
      apiField: 'image_size'
    }
  ],
  endpoints: {
    default: '/api/generate'
  },
  request: {
    base: {
      model: 'test-model-v1',
      version: '1.0'
    }
  },
  pricing: { currency: '¥', fixed: 0.1 }
})

const builder = new RequestBuilder()

const request = builder.build('test-new', {
  quality: 'hd',
  size: 2048,
  prompt: 'test prompt'
})

expect(request).toEqual({
  url: '/api/generate',
  method: 'POST',
  body: {
    model: 'test-model-v1',
    version: '1.0',
    quality: 'hd',
    image_size: 2048
  }
})
```

2. 测试 apiTransform
```typescript
registry.register({
  // ...
  params: [
    {
      id: 'videos',
      component: 'video-upload',
      name: { zh: '视频', en: 'Videos' },
      order: 1,
      maxCount: 3,
      apiTransform: (urls) => ({
        reference_video_urls: urls.map(url => ({ url }))
      })
    }
  ]
  // ...
})

const request = builder.build('test-transform', {
  videos: ['url1', 'url2', 'url3']
})

expect(request.body).toEqual({
  reference_video_urls: [
    { url: 'url1' },
    { url: 'url2' },
    { url: 'url3' }
  ]
})
```

3. 测试 apiMapping（端点相关）
```typescript
registry.register({
  // ...
  params: [
    {
      id: 'resolution',
      component: 'panel',
      panelType: 'resolution',
      name: { zh: '分辨率', en: 'Resolution' },
      order: 1,
      apiMapping: {
        't2v': {
          transform: (v) => ({ size: `${v.width}*${v.height}` })
        },
        'i2v': {
          transform: (v) => ({ resolution: v.quality })
        }
      }
    }
  ],
  endpoints: {
    select: (params, context) => {
      return context.hasImage ? 'i2v' : 't2v'
    },
    routes: {
      't2v': { path: '/t2v', method: 'POST' },
      'i2v': { path: '/i2v', method: 'POST' }
    }
  }
  // ...
})

// 文生视频
const request1 = builder.build('test-mapping', {
  resolution: { width: 1280, height: 720, quality: '720P' }
}, { hasImage: false })

expect(request1.body).toEqual({
  size: '1280*720'
})

// 图生视频
const request2 = builder.build('test-mapping', {
  resolution: { width: 1280, height: 720, quality: '720P' }
}, { hasImage: true })

expect(request2.body).toEqual({
  resolution: '720P'
})
```

4. 测试旧系统降级
```typescript
// 旧模型没有新配置
const request = builder.build('old-model', {
  // 参数...
})

// 应该使用旧的 optionsBuilder
expect(request).toBeDefined()
```

5. 性能测试
```typescript
const start = performance.now()

for (let i = 0; i < 1000; i++) {
  builder.build('test-new', { quality: 'hd', size: 1024 })
}

const duration = performance.now() - start
expect(duration).toBeLessThan(50) // 1000 次 < 50ms
```

## 风险与注意事项

### 风险
- 新旧系统切换可能导致请求格式不一致
- 复杂的 apiMapping 可能影响性能
- 参数验证可能过于严格导致可用性下降

### 注意事项
- 优先使用新配置，确保向前兼容
- 旧系统应该逐步废弃，而非长期维护
- apiTransform 函数应该是纯函数
- 端点选择失败应有明确错误提示
- 参数验证应该有清晰的错误消息
- 考虑添加参数白名单/黑名单
- 记录详细的构建日志
- 提供 dry-run 模式（只构建不发送）

## 实现参考

```typescript
// src/core/request/RequestBuilder.ts

import { registry } from '../ModelRegistry'
import type { ModelDefinition, ParamDef } from '../types'
import { mapParams } from './paramMapper'
import { validateParams } from './paramValidator'

export interface BuildResult {
  url: string
  method: string
  body: Record<string, any>
}

export class RequestBuilder {
  /**
   * 构建 API 请求
   */
  build(
    modelId: string,
    params: Record<string, any>,
    context?: Record<string, any>
  ): BuildResult {
    const model = registry.getModel(modelId)

    if (!model) {
      throw new Error(`Model not found: ${modelId}`)
    }

    // 检查是否有新配置
    if (this.hasNewConfig(model)) {
      return this.buildWithNewConfig(model, params, context || {})
    } else {
      return this.buildWithOldConfig(modelId, params, context || {})
    }
  }

  /**
   * 检查是否有新配置
   */
  private hasNewConfig(model: ModelDefinition): boolean {
    return model.params.length > 0 && model.endpoints !== undefined
  }

  /**
   * 使用新配置构建
   */
  private buildWithNewConfig(
    model: ModelDefinition,
    params: Record<string, any>,
    context: Record<string, any>
  ): BuildResult {
    // 选择端点
    const endpointKey = registry.selectEndpoint(model.meta.id, params, context)
    if (!endpointKey) {
      throw new Error(`No endpoint found for model: ${model.meta.id}`)
    }

    // 获取端点配置
    const endpoint = this.getEndpoint(model, endpointKey)

    // 构建请求体
    let body: Record<string, any> = {}

    // 1. 添加基础参数
    if (model.request?.base) {
      body = { ...model.request.base }
    }

    // 2. 映射参数
    for (const paramDef of model.params) {
      const value = params[paramDef.id]

      // 跳过未设置的参数
      if (value === undefined || value === null) {
        continue
      }

      // 应用映射
      const mapped = this.mapParam(paramDef, value, endpointKey, params)
      Object.assign(body, mapped)
    }

    // 3. 应用预处理
    if (model.request?.preprocess) {
      body = model.request.preprocess(body) || body
    }

    return {
      url: endpoint.path,
      method: endpoint.method || 'POST',
      body
    }
  }

  /**
   * 映射单个参数
   */
  private mapParam(
    paramDef: ParamDef,
    value: any,
    endpointKey: string,
    allParams: Record<string, any>
  ): Record<string, any> {
    // 优先级：apiMapping > apiTransform > apiField

    // 1. apiMapping（端点相关）
    if ('apiMapping' in paramDef && paramDef.apiMapping?.[endpointKey]) {
      const mapping = paramDef.apiMapping[endpointKey]
      return mapping.transform(value, allParams)
    }

    // 2. apiTransform
    if ('apiTransform' in paramDef && paramDef.apiTransform) {
      return paramDef.apiTransform(value, allParams)
    }

    // 3. apiField（简单映射）
    if ('apiField' in paramDef && paramDef.apiField) {
      return { [paramDef.apiField]: this.convertType(value, paramDef.valueType) }
    }

    // 无映射配置，不发送
    return {}
  }

  /**
   * 类型转换
   */
  private convertType(value: any, type: string): any {
    switch (type) {
      case 'number':
        return Number(value)
      case 'boolean':
        return Boolean(value)
      case 'string':
        return String(value)
      default:
        return value
    }
  }

  /**
   * 获取端点配置
   */
  private getEndpoint(
    model: ModelDefinition,
    endpointKey: string
  ): { path: string; method?: string } {
    const endpoints = model.endpoints

    // 单端点简化
    if (typeof endpoints === 'object' && 'default' in endpoints) {
      return { path: endpoints.default }
    }

    // 多端点
    if (endpoints.routes?.[endpointKey]) {
      return endpoints.routes[endpointKey]
    }

    throw new Error(`Endpoint not found: ${endpointKey}`)
  }

  /**
   * 使用旧配置构建（降级）
   */
  private buildWithOldConfig(
    modelId: string,
    params: Record<string, any>,
    context: Record<string, any>
  ): BuildResult {
    // 调用旧的 optionsBuilder
    // 这里是兼容层，具体实现取决于旧系统

    console.warn(`[RequestBuilder] Using legacy builder for: ${modelId}`)

    // 示例：调用旧系统
    // const oldBuilder = require('@/components/MediaGenerator/builders/optionsBuilder')
    // return oldBuilder.buildRequest(modelId, params, context)

    throw new Error('Legacy builder not implemented yet')
  }
}

export const requestBuilder = new RequestBuilder()
```

```typescript
// src/core/request/paramValidator.ts

import type { ParamDef } from '../types'

export interface ValidationError {
  paramId: string
  message: string
}

export function validateParams(
  params: Record<string, any>,
  schema: ParamDef[]
): ValidationError[] {
  const errors: ValidationError[] = []

  for (const paramDef of schema) {
    const value = params[paramDef.id]

    // 检查必需参数
    if ('required' in paramDef && paramDef.required && (value === undefined || value === null)) {
      errors.push({
        paramId: paramDef.id,
        message: `${paramDef.id} is required`
      })
      continue
    }

    // 跳过未设置的可选参数
    if (value === undefined || value === null) {
      continue
    }

    // 检查类型
    const expectedType = paramDef.valueType
    const actualType = typeof value

    if (expectedType === 'number' && actualType !== 'number') {
      errors.push({
        paramId: paramDef.id,
        message: `${paramDef.id} must be a number`
      })
    }

    // 检查范围（slider/number）
    if ('min' in paramDef && typeof value === 'number' && value < paramDef.min) {
      errors.push({
        paramId: paramDef.id,
        message: `${paramDef.id} must be >= ${paramDef.min}`
      })
    }

    if ('max' in paramDef && typeof value === 'number' && value > paramDef.max) {
      errors.push({
        paramId: paramDef.id,
        message: `${paramDef.id} must be <= ${paramDef.max}`
      })
    }

    // 检查选项（dropdown/radio）
    if ('options' in paramDef && paramDef.options) {
      const validValues = paramDef.options.map(o => o.value)
      if (!validValues.includes(value)) {
        errors.push({
          paramId: paramDef.id,
          message: `${paramDef.id} must be one of: ${validValues.join(', ')}`
        })
      }
    }
  }

  return errors
}
```

## 回滚方案

1. 删除 RequestBuilder
   - 删除 `src/core/request/` 目录

2. 继续使用旧系统
   - 保持现有 `optionsBuilder.ts` 不变
   - 保持现有 `builders/configs/*.ts` 不变

3. Git 回滚
   ```bash
   git checkout HEAD -- src/core/request/
   ```

4. 验证旧系统仍然工作
