# 配置驱动架构 - 常见问题与解决方案

本文档总结了在使用配置驱动架构适配新模型时的常见问题和解决方案。

## 1. 参数未出现在 API 请求中

### 问题描述
配置了参数映射，但参数没有出现在实际的 API 请求中。

### 可能原因与解决方案

#### 原因 1：TypeScript 类型定义缺失

**症状**：参数在测试模式中显示存在，但实际请求中缺失。

**解决方案**：在 `BuildOptionsParams` 接口中添加参数类型定义

```typescript
// src/components/MediaGenerator/builders/core/types.ts
export interface BuildOptionsParams {
  // 添加模型参数的类型定义
  kieSora2Mode?: string
  kieSora2AspectRatio?: string
  kieSora2Duration?: string
  kieSora2Quality?: string
}
```

#### 原因 2：参数读取顺序错误

**症状**：finalOptions 同时包含 UI 参数和 API 参数，但适配器读取了错误的值。

**解决方案**：优先读取 API 参数（已转换的值）

```typescript
// ❌ 错误：优先读取 UI 参数
const aspectRatio = (params as any).kieSora2AspectRatio || (params as any).aspect_ratio

// ✅ 正确：优先读取 API 参数
const aspectRatio = (params as any).aspect_ratio || (params as any).kieSora2AspectRatio
```

#### 原因 3：transform 与 smartMatch 执行顺序问题

**症状**：智能匹配不工作，'smart' 值被提前转换。

**解决方案**：

1. transform 函数不转换 'smart' 值：

```typescript
aspect_ratio: {
  source: ['kieSora2AspectRatio', 'aspectRatio'],
  transform: (value: string) => {
    if (value === 'smart') return value  // 让 smartMatch 处理
    if (value === '16:9') return 'landscape'
    if (value === '9:16') return 'portrait'
    return 'landscape'
  }
}
```

2. 在 OptionsBuilder 中，smartMatch 之后重新应用 transform：

```typescript
// src/components/MediaGenerator/builders/core/OptionsBuilder.ts
if (effectiveConfig.features?.smartMatch) {
  await handleSmartMatch(options, effectiveConfig.features.smartMatch, context)

  // 重新应用 transform 到 smartMatch 参数
  const paramKey = effectiveConfig.features.smartMatch.paramKey
  const mapping = effectiveConfig.paramMapping[paramKey]
  if (mapping && typeof mapping === 'object' && mapping.transform) {
    const currentValue = options[paramKey]
    if (currentValue !== undefined && currentValue !== 'smart') {
      options[paramKey] = mapping.transform(currentValue, context)
    }
  }
}
```

## 2. autoSwitch 不工作

### 问题描述
配置了 autoSwitch，但参数没有自动切换。

### 解决方案
在 SchemaForm 中添加 autoSwitch 处理逻辑：

```typescript
// src/components/ui/SchemaForm.tsx
React.useEffect(() => {
  schema.forEach(param => {
    if (param.autoSwitch) {
      const { condition, value } = param.autoSwitch

      if (condition(values)) {
        const targetValue = typeof value === 'function' ? value(values) : value

        if (values[param.id] !== targetValue) {
          onChange(param.id, targetValue)
        }
      }
    }
  })
}, [values, schema, onChange])
```

## 3. autoSwitch 过于激进

### 问题描述
autoSwitch 在每次参数变化时都触发，导致用户手动选择后又被强制切换回去。

**示例**：上传横屏图片后智能匹配到 16:9，但用户无法手动选择 16:9（会被强制切换回"智能"）。

### 解决方案：引入 watchKeys 机制

#### 1. 添加 watchKeys 类型定义

```typescript
// src/types/schema.ts
autoSwitch?: {
  condition: (values: any) => boolean
  value: any | ((values: any) => any)
  watchKeys?: string[]  // 只监听这些 key 的变化
}
```

#### 2. 在 SchemaForm 中实现 watchKeys 逻辑

```typescript
const prevValuesRef = React.useRef<Record<string, any>>({})

React.useEffect(() => {
  schema.forEach(param => {
    if (param.autoSwitch) {
      const { condition, value, watchKeys } = param.autoSwitch

      // 如果指定了 watchKeys，检查这些 key 是否变化
      if (watchKeys && watchKeys.length > 0) {
        const hasWatchedKeyChanged = watchKeys.some(
          key => prevValuesRef.current[key] !== values[key]
        )

        if (!hasWatchedKeyChanged) {
          return  // 跳过
        }
      }

      // 执行 autoSwitch
      if (condition(values)) {
        const targetValue = typeof value === 'function' ? value(values) : value
        if (values[param.id] !== targetValue) {
          onChange(param.id, targetValue)
        }
      }
    }
  })

  prevValuesRef.current = values
}, [values, schema, onChange])
```

#### 3. 在模型配置中使用 watchKeys

```typescript
autoSwitch: {
  condition: (values) => {
    const hasImages = values.uploadedImages && values.uploadedImages.length > 0
    const currentRatio = values.kieSora2AspectRatio

    if (hasImages && currentRatio === '16:9') return true
    if (!hasImages && currentRatio === 'smart') return true
    return false
  },
  value: (values) => {
    const hasImages = values.uploadedImages && values.uploadedImages.length > 0
    return hasImages ? 'smart' : '16:9'
  },
  watchKeys: ['uploadedImages']  // 只监听图片数量变化，不监听比例参数变化
}
```

## 4. 价格不更新

### 问题描述
修改参数后，价格估算组件不更新。

### 解决方案
在 PriceEstimate 组件的 params 中添加模型参数：

```typescript
// src/components/MediaGenerator/index.tsx
<PriceEstimate
  providerId={state.selectedProvider}
  modelId={state.selectedModel}
  params={{
    // 添加模型特定参数
    kieSora2Mode: state.kieSora2Mode,
    kieSora2Duration: state.kieSora2Duration,
    kieSora2Quality: state.kieSora2Quality,
    // ... 其他参数
  }}
/>
```

## 5. 图片上传按钮不隐藏

### 问题描述
达到最大图片数量后，上传按钮仍然显示。

### 解决方案
在 `getMaxImageCount` 函数中添加模型 ID 判断：

```typescript
// src/components/MediaGenerator/utils/constants.ts
export const getMaxImageCount = (modelId: string, mode?: string): number => {
  // 添加模型 ID 判断
  if (modelId === 'kie-sora-2' || modelId === 'sora-2-kie') return 1

  // ... 其他模型判断

  return 6  // 默认值
}
```

## 最佳实践

### 1. 完整的类型定义
确保所有 UI 参数都在 `BuildOptionsParams` 接口中定义，否则参数会被 TypeScript 忽略。

### 2. 优先读取 API 参数
适配器应优先读取已转换的 API 参数，然后回退到 UI 参数：
```typescript
const value = (params as any).api_param || (params as any).uiParam
```

### 3. transform 不处理特殊值
transform 函数不应转换 'smart' 等需要后续处理的特殊值。

### 4. 使用 watchKeys 控制 autoSwitch
避免 autoSwitch 过于激进，只监听真正需要触发切换的参数。

### 5. 使用测试模式验证
开启测试模式检查参数是否正确传递到 API 请求中。

## 调试技巧

### 1. 检查参数流程
```
UI State (kieSora2*)
  ↓ [BuildOptionsParams 类型定义]
buildGenerateOptions
  ↓ [paramMapping + transform]
OptionsBuilder
  ↓ [smartMatch]
handleSmartMatch
  ↓ [重新应用 transform]
options (API 参数)
  ↓ [finalOptions = {...options, ...originalUIParams}]
Adapter
  ↓ [优先读取 API 参数]
API Request
```

### 2. 使用日志追踪
在关键位置添加日志：
- OptionsBuilder.build() 的输入和输出
- transform 函数的输入和输出
- handleSmartMatch 的输入和输出
- 适配器读取参数的值

### 3. 测试模式
开启测试模式查看完整参数对象，确认：
- API 参数是否存在
- UI 参数是否存在
- 值是否正确转换

## 案例：KIE Sora 2 适配

完整的 KIE Sora 2 适配涉及以上所有问题的解决，是配置驱动架构的典型案例。

**关键修改文件**：
1. `types.ts` - 添加 TypeScript 类型定义
2. `kie-models.ts` - 配置 paramMapping 和 transform
3. `OptionsBuilder.ts` - smartMatch 后重新应用 transform
4. `sora2.ts` - 优先读取 API 参数
5. `SchemaForm.tsx` - 实现 autoSwitch 和 watchKeys
6. `schema.ts` - 添加 watchKeys 类型定义
7. `kie-sora2.ts` - 配置 autoSwitch 和 watchKeys
8. `constants.ts` - 添加 maxImageCount 判断
9. `MediaGenerator/index.tsx` - 添加 PriceEstimate 参数

通过这些修改，实现了完整的配置驱动架构适配。
