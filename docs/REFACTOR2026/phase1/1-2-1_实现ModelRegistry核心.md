# 1-2-1 实现ModelRegistry核心

## 目标

实现模型注册中心 ModelRegistry，提供模型查询、Schema 获取、价格计算等核心功能

## 背景

ModelRegistry 是新架构的核心组件，负责：
- 管理所有模型的注册和查询
- 提供统一的模型访问接口
- 支持别名和标签查询
- 缓存模型配置提高性能

当前问题：
- 模型配置分散在多个文件
- 需要手动在 `src/models/index.ts` 注册
- 查询逻辑重复

## 前置依赖

- [x] 1-1-1：定义ModelDefinition接口
- [x] 1-1-2：定义参数类型系统
- [x] 1-1-3：定义联动系统接口

## 实施步骤

1. [ ] 创建 ModelRegistry 类
   - 创建 `src/core/ModelRegistry.ts`
   - 使用单例模式确保全局唯一
   - 初始化模型存储 Map

2. [ ] 实现注册功能
   - `register(model: ModelDefinition)` 方法
   - 验证模型 ID 唯一性
   - 支持别名注册
   - 添加模型验证逻辑

3. [ ] 实现查询功能
   - `getModel(id: string)` - 按 ID 查询
   - `getSchema(id: string)` - 获取参数 Schema
   - `getModelsByProvider(provider: string)` - 按供应商查询
   - `getModelsByType(type: string)` - 按类型查询
   - `getModelsByTag(tag: string)` - 按标签查询

4. [ ] 实现价格计算
   - `calculatePrice(modelId: string, params: any)` 方法
   - 支持固定价格和动态计算
   - 处理计算错误

5. [ ] 实现端点选择
   - `selectEndpoint(modelId: string, params: any, context: any)` 方法
   - 支持规则选择器
   - 支持函数选择器
   - 处理单端点简化情况

6. [ ] 实现模型验证
   - 创建 `validateModel(model: ModelDefinition)` 方法
   - 检查必需字段
   - 验证参数定义
   - 验证联动规则
   - 验证端点配置

7. [ ] 添加调试支持
   - `listAllModels()` - 列出所有模型
   - `getModelInfo(id: string)` - 获取模型详细信息
   - 添加日志输出

8. [ ] 导出全局实例
   - 创建并导出 `registry` 单例
   - 从 `src/core/index.ts` 导出

## 涉及文件

### 新建文件
- `src/core/ModelRegistry.ts` - ModelRegistry 类实现
- `src/core/validators/modelValidator.ts` - 模型验证器
- `src/core/index.ts` - 核心模块导出

### 修改文件
- 无（纯新增功能）

## 验收标准

- [ ] ModelRegistry 类实现所有核心方法
- [ ] 支持单例模式，全局唯一实例
- [ ] 注册时验证模型配置完整性
- [ ] 查询方法返回正确结果
- [ ] 价格计算与现有逻辑一致
- [ ] 端点选择逻辑正确
- [ ] 包含完整的 TypeScript 类型定义
- [ ] 包含 JSDoc 注释

## 测试方法

1. 创建测试模型配置
```typescript
import { registry } from '@/core'

const testModel: ModelDefinition = {
  meta: {
    id: 'test-model',
    provider: 'test',
    type: 'image',
    name: { zh: '测试模型', en: 'Test Model' },
    tags: ['test', 'image-generation']
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
    }
  ],
  endpoints: {
    default: '/test/generate'
  },
  pricing: {
    currency: '¥',
    fixed: 0.1
  }
}

// 测试注册
registry.register(testModel)

// 测试查询
const model = registry.getModel('test-model')
console.assert(model !== undefined, '模型查询失败')

const schema = registry.getSchema('test-model')
console.assert(schema.length === 1, 'Schema 查询失败')

// 测试价格计算
const price = registry.calculatePrice('test-model', {})
console.assert(price === 0.1, '价格计算错误')

// 测试标签查询
const imageModels = registry.getModelsByTag('image-generation')
console.assert(imageModels.length > 0, '标签查询失败')
```

2. 测试边界情况
```typescript
// 测试重复注册
try {
  registry.register(testModel)
  console.error('应该抛出重复 ID 错误')
} catch (e) {
  console.log('✓ 正确拦截重复注册')
}

// 测试不存在的模型
const notFound = registry.getModel('non-existent')
console.assert(notFound === undefined, '应该返回 undefined')
```

3. 验证性能
```typescript
// 注册 50+ 模型后测试查询速度
console.time('查询性能')
for (let i = 0; i < 1000; i++) {
  registry.getModel('test-model')
}
console.timeEnd('查询性能')
// 应该在 10ms 以内
```

## 风险与注意事项

### 风险
- 模型注册顺序可能影响别名冲突
- 查询性能随模型数量增长可能下降

### 注意事项
- 使用 Map 而非对象存储，提高查询性能
- 注册时验证模型配置，避免运行时错误
- 价格计算函数应捕获异常，返回默认值
- 端点选择失败应有降级策略
- 考虑使用 WeakMap 缓存计算结果
- 日志应使用统一的日志工具，避免直接 console.log

## 实现参考

```typescript
// src/core/ModelRegistry.ts

class ModelRegistry {
  private static instance: ModelRegistry
  private models: Map<string, ModelDefinition> = new Map()
  private modelsByProvider: Map<string, Set<string>> = new Map()
  private modelsByType: Map<string, Set<string>> = new Map()
  private modelsByTag: Map<string, Set<string>> = new Map()

  private constructor() {}

  static getInstance(): ModelRegistry {
    if (!ModelRegistry.instance) {
      ModelRegistry.instance = new ModelRegistry()
    }
    return ModelRegistry.instance
  }

  /**
   * 注册模型
   * @throws {Error} 如果模型 ID 已存在
   */
  register(model: ModelDefinition): void {
    if (this.models.has(model.meta.id)) {
      throw new Error(`Model ID already exists: ${model.meta.id}`)
    }

    // 验证模型配置
    validateModel(model)

    // 注册主 ID
    this.models.set(model.meta.id, model)

    // 注册别名
    model.meta.aliases?.forEach(alias => {
      this.models.set(alias, model)
    })

    // 索引：按供应商
    if (!this.modelsByProvider.has(model.meta.provider)) {
      this.modelsByProvider.set(model.meta.provider, new Set())
    }
    this.modelsByProvider.get(model.meta.provider)!.add(model.meta.id)

    // 索引：按类型
    if (!this.modelsByType.has(model.meta.type)) {
      this.modelsByType.set(model.meta.type, new Set())
    }
    this.modelsByType.get(model.meta.type)!.add(model.meta.id)

    // 索引：按标签
    model.meta.tags?.forEach(tag => {
      if (!this.modelsByTag.has(tag)) {
        this.modelsByTag.set(tag, new Set())
      }
      this.modelsByTag.get(tag)!.add(model.meta.id)
    })
  }

  /**
   * 获取模型定义
   */
  getModel(id: string): ModelDefinition | undefined {
    return this.models.get(id)
  }

  /**
   * 获取参数 Schema
   */
  getSchema(id: string): ParamDef[] {
    return this.models.get(id)?.params || []
  }

  /**
   * 计算价格
   */
  calculatePrice(modelId: string, params: Record<string, any>): number {
    const model = this.models.get(modelId)
    if (!model) return 0

    try {
      if (model.pricing.fixed !== undefined) {
        return model.pricing.fixed
      }
      if (model.pricing.calculate) {
        return model.pricing.calculate(params, model.pricing.rates || {})
      }
      return 0
    } catch (error) {
      console.error(`Price calculation failed for ${modelId}:`, error)
      return 0
    }
  }

  /**
   * 选择端点
   */
  selectEndpoint(
    modelId: string,
    params: Record<string, any>,
    context: Record<string, any>
  ): string | undefined {
    const model = this.models.get(modelId)
    if (!model) return undefined

    const endpoints = model.endpoints

    // 单端点简化
    if (typeof endpoints === 'object' && 'default' in endpoints) {
      return endpoints.default
    }

    // 使用选择器
    if (typeof endpoints.select === 'function') {
      return endpoints.select(params, context)
    }

    // 规则选择器
    if (endpoints.select?.rules) {
      for (const rule of endpoints.select.rules) {
        if (!rule.condition || evaluateCondition(rule.condition, params)) {
          return rule.endpoint
        }
      }
    }

    return undefined
  }

  /**
   * 按供应商查询
   */
  getModelsByProvider(provider: string): ModelDefinition[] {
    const ids = this.modelsByProvider.get(provider)
    if (!ids) return []
    return Array.from(ids).map(id => this.models.get(id)!).filter(Boolean)
  }

  /**
   * 按类型查询
   */
  getModelsByType(type: string): ModelDefinition[] {
    const ids = this.modelsByType.get(type)
    if (!ids) return []
    return Array.from(ids).map(id => this.models.get(id)!).filter(Boolean)
  }

  /**
   * 按标签查询
   */
  getModelsByTag(tag: string): ModelDefinition[] {
    const ids = this.modelsByTag.get(tag)
    if (!ids) return []
    return Array.from(ids).map(id => this.models.get(id)!).filter(Boolean)
  }

  /**
   * 列出所有模型
   */
  listAllModels(): ModelDefinition[] {
    const uniqueModels = new Map<string, ModelDefinition>()
    this.models.forEach((model, id) => {
      if (id === model.meta.id) {
        uniqueModels.set(id, model)
      }
    })
    return Array.from(uniqueModels.values())
  }
}

export const registry = ModelRegistry.getInstance()
```

## 回滚方案

1. 删除新建文件
   - 删除 `src/core/ModelRegistry.ts`
   - 删除 `src/core/validators/modelValidator.ts`
   - 删除 `src/core/index.ts`

2. Git 回滚
   ```bash
   git checkout HEAD -- src/core/
   ```

3. 验证现有功能未受影响
   - 运行应用确保正常启动
   - 测试现有模型生成功能
