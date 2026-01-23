# 1-1-1 定义ModelDefinition接口

## 目标

定义新架构的核心 TypeScript 接口 ModelDefinition，作为单文件配置的类型基础

## 背景

新架构要求每个模型只需一个 `.model.ts` 配置文件，包含：
- 元数据（meta）
- 参数定义（params）
- 联动规则（linkages）
- 端点路由（endpoints）
- 请求构建（request）
- 价格计算（pricing）

需要设计完整的 TypeScript 接口定义

## 前置依赖

- [ ] 0-2-1：建立模型标签系统

## 实施步骤

1. [ ] 创建核心类型文件
   - 创建 `src/core/types/ModelDefinition.ts`
   - 定义 ModelDefinition 主接口

2. [ ] 定义元数据类型
   - ModelMeta 接口
   - 包含 id, provider, type, name, description, tags, icon
   - 包含 polling 配置

3. [ ] 定义 I18nText 类型
   - 支持多语言文本
   - `type I18nText = string | { zh: string; en: string }`

4. [ ] 定义端点路由类型
   - EndpointConfig 接口
   - 支持规则选择器和函数选择器
   - RouteDefinition 接口

5. [ ] 定义请求构建类型
   - RequestConfig 接口
   - 包含 base 和 preprocess

6. [ ] 定义价格计算类型
   - PricingConfig 接口
   - 支持固定价格和动态计算

7. [ ] 导出所有类型
   - 从 `src/core/types/index.ts` 统一导出

## 涉及文件

### 新建文件
- `src/core/types/ModelDefinition.ts` - 主接口定义
- `src/core/types/I18nText.ts` - 国际化文本类型
- `src/core/types/EndpointConfig.ts` - 端点配置类型
- `src/core/types/RequestConfig.ts` - 请求配置类型
- `src/core/types/PricingConfig.ts` - 价格配置类型
- `src/core/types/index.ts` - 类型导出入口

## 验收标准

- [ ] ModelDefinition 接口覆盖 REFACTOR_PLAN.md 第三节所有配置项
- [ ] 所有类型都有清晰的 JSDoc 注释
- [ ] TypeScript 编译通过，无类型错误
- [ ] 创建一个示例配置验证接口可用

## 测试方法

1. 创建示例配置对象
```typescript
const exampleModel: ModelDefinition = {
  meta: {
    id: 'test-model',
    provider: 'test',
    type: 'image',
    name: { zh: '测试模型', en: 'Test Model' }
  },
  params: [],
  endpoints: { default: '/test' },
  pricing: { currency: '¥', fixed: 0.1 }
}
```

2. 验证 TypeScript 类型检查
3. 验证 JSDoc 提示正常

## 风险与注意事项

### 风险
- 接口设计不够灵活，后续需要频繁修改

### 注意事项
- 接口应尽量通用，避免为特定模型定制
- 使用联合类型和可选字段提供灵活性
- 考虑向后兼容性

## 接口设计参考

基于 REFACTOR_PLAN.md 第三节，核心接口应包含：

```typescript
interface ModelDefinition {
  meta: ModelMeta
  params: ParamDef[]
  linkages?: Linkage[]
  endpoints: EndpointConfig
  request?: RequestConfig
  pricing: PricingConfig
}

interface ModelMeta {
  id: string
  provider: string
  type: 'image' | 'video' | 'audio'
  name: I18nText
  description?: I18nText
  tags?: ModelTag[]
  icon?: string
  polling?: {
    interval: number
    maxAttempts: number
  }
}
```

## 回滚方案

- 删除 `src/core/types/` 目录下的所有新建文件
- Git revert 相关提交
