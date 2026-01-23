# Fal 模型适配常见问题与解决方案

本文档记录了在适配 Fal 模型（以 MiniMax Hailuo 02 为例）时遇到的常见问题及其解决方法。

## 目录

1. [价格计算问题](#1-价格计算问题)
2. [图片上传按钮显示问题](#2-图片上传按钮显示问题)
3. [参数自动切换失效](#3-参数自动切换失效)
4. [自动恢复行为问题](#4-自动恢复行为问题)
5. [参数传递不完整](#5-参数传递不完整)

---

## 1. 价格计算问题

### 问题描述

价格没有随着参数变动而更新。用户切换分辨率或其他参数时，价格显示保持不变。

### 根本原因

价格计算器期望接收某个特定的参数名（如 `hailuo02Version`），但实际传递的是另一个参数名（如 `falHailuo02Resolution`）。

### 解决方案

在价格计算器中直接从实际接收到的参数派生所需的值：

```typescript
// src/config/pricing.ts

// 错误做法：期望接收 hailuo02Version
const version = params.hailuo02Version || 'standard'

// 正确做法：从 resolution 派生 version
const resolution = params.falHailuo02Resolution || params.hailuo02Resolution || '768P'
const version = resolution === '1080P' ? 'pro' : 'standard'
```

### 关键要点

- 价格计算器应该灵活处理参数，支持从多个可能的参数源获取值
- 如果需要派生值（如从分辨率派生版本），应该在价格计算器内部完成，而不是期望外部传递

---

## 2. 图片上传按钮显示问题

### 问题描述

在某些模式下（如快速模式），模型不支持多张图片上传，但图片上传按钮仍然显示，导致用户可以上传不支持的图片数量。

### 根本原因

`getMaxImageCount` 函数没有接收到模式参数（如 `fastMode`），无法根据当前模式动态调整最大图片数量。

### 解决方案

修改所有调用 `getMaxImageCount` 的地方，传递模式参数：

```typescript
// src/components/MediaGenerator/index.tsx

// 错误做法：没有传递模式参数
const maxImageCount = getMaxImageCount(selectedModel)

// 正确做法：传递模式参数
const maxImageCount = getMaxImageCount(
  selectedModel,
  // ... 其他检查 ...
  (selectedModel === 'fal-ai-minimax-hailuo-02' || selectedModel === 'minimax-hailuo-02-fal') && state.falHailuo02FastMode ? 'fast' :
  undefined
)
```

同时需要在 `InputArea.tsx` 组件中传递模式参数：

```typescript
// src/components/MediaGenerator/components/InputArea.tsx

interface InputAreaProps {
  // ... 其他 props
  hailuo02FastMode?: boolean
}

// 在组件内部使用
const maxImageCount = getMaxImageCount(
  selectedModel,
  // ... 其他检查 ...
  (selectedModel === 'fal-ai-minimax-hailuo-02' || selectedModel === 'minimax-hailuo-02-fal') && hailuo02FastMode ? 'fast' :
  undefined
)
```

### 关键要点

- 需要在多个地方同步修改：`onImageUpload`、`onPaste`、`onImageDrop`、`handleModelSelect`、`InputArea` 组件
- 确保模式参数正确传递到所有需要的地方

---

## 3. 参数自动切换失效

### 问题描述

定义了 `autoSwitch` 规则（如开启快速模式时自动切换到 512P），但实际使用时参数没有自动切换。

### 根本原因

这个问题通常由以下三个原因之一或组合导致：

#### 原因 1：Schema 映射错误

模型 ID 映射到了错误的参数 schema。

**定位方法**：检查 `src/models/index.ts` 中的 `modelSchemaMap`

```typescript
// 错误示例：minimax-hailuo-02 使用了 Hailuo 2.3 的 schema
export const modelSchemaMap: Record<string, ParamDef[]> = {
  'minimax-hailuo-02': minimaxHailuo23Params, // ❌ 错误！
  // ...
}

// 正确示例
export const modelSchemaMap: Record<string, ParamDef[]> = {
  'minimax-hailuo-02': falAiMinimaxHailuo02Params, // ✅ 正确
  // ...
}
```

#### 原因 2：autoSwitch 触发器缺失

`useEffect` 没有监听触发 autoSwitch 的状态变化。

**定位方法**：检查 `src/components/MediaGenerator/index.tsx` 中的 autoSwitch useEffect

```typescript
// 错误示例：依赖数组中缺少 falHailuo02FastMode
useEffect(() => {
  // ... autoSwitch logic
}, [
  state.selectedModel,
  state.uploadedImages.length,
  state.uploadedVideos.length,
  state.modelscopeCustomModel,
  state.falSeedanceV1Mode,
  // ❌ 缺少 state.falHailuo02FastMode
])

// 正确示例
useEffect(() => {
  // ... autoSwitch logic
}, [
  state.selectedModel,
  state.uploadedImages.length,
  state.uploadedVideos.length,
  state.modelscopeCustomModel,
  state.falSeedanceV1Mode,
  state.falHailuo02FastMode // ✅ 添加
])
```

同时需要在 `prevAutoSwitchStateRef` 中添加对应的状态：

```typescript
const prevAutoSwitchStateRef = useRef({
  selectedModel: state.selectedModel,
  uploadedImagesLength: state.uploadedImages.length,
  uploadedVideosLength: state.uploadedVideos.length,
  modelscopeCustomModel: state.modelscopeCustomModel,
  falSeedanceV1Mode: state.falSeedanceV1Mode,
  falHailuo02FastMode: state.falHailuo02FastMode // ✅ 添加
})
```

#### 原因 3：缺少 Setter 函数

`createPresetSetterMap` 中缺少参数的 setter 函数。

**定位方法**：检查 `src/components/MediaGenerator/index.tsx` 中的 `createPresetSetterMap`

```typescript
// 错误示例：缺少 Hailuo 02 的 setters
const setterMap = useMemo(() => createPresetSetterMap({
  // ... 其他 setters
  // ❌ 缺少 Hailuo 02 的 setters
}), [/* deps */])

// 正确示例
const setterMap = useMemo(() => createPresetSetterMap({
  // ... 其他 setters
  setFalHailuo02Duration: state.setFalHailuo02Duration, // ✅ 添加
  setFalHailuo02Resolution: state.setFalHailuo02Resolution, // ✅ 添加
  setFalHailuo02FastMode: state.setFalHailuo02FastMode, // ✅ 添加
  setFalHailuo02PromptOptimizer: state.setFalHailuo02PromptOptimizer, // ✅ 添加
}), [/* deps */])
```

### 解决方案总结

1. 确保 `modelSchemaMap` 中的映射正确
2. 在 autoSwitch useEffect 的依赖数组中添加所有触发 autoSwitch 的状态
3. 在 `prevAutoSwitchStateRef` 中添加对应的状态追踪
4. 在 `createPresetSetterMap` 中添加所有参数的 setter 函数

### 关键要点

- autoSwitch 失效通常是多个问题的组合，需要逐一排查
- 使用浏览器控制台的 React DevTools 可以帮助调试状态变化
- 可以在 `getAutoSwitchValues` 函数中添加 `console.log` 来调试

---

## 4. 自动恢复行为问题

### 问题描述

开启某个模式（如快速模式）时，参数自动切换到特定值（如 512P）。关闭该模式后，参数保持在切换后的值。但再次开启该模式时，参数却切换到了错误的值（如 768P）。

### 根本原因

`autoSwitch` 的默认行为包括"自动恢复"：当 autoSwitch 条件不满足时，如果当前值等于 autoSwitch 的目标值，会自动恢复到参数的默认值。

**问题场景**：
1. 用户手动选择 768P
2. 开启快速模式 → autoSwitch 触发，切换到 512P
3. 关闭快速模式 → autoSwitch 条件不满足，但因为当前值是 512P（等于 autoSwitch 的目标值），所以恢复到默认值 768P
4. 再次开启快速模式 → autoSwitch 触发，从 768P 切换到 512P

这导致用户看到的行为是：第一次开启快速模式时从 768P 切换到 512P，关闭后保持 512P，再次开启时却从 768P 切换到 512P（因为第3步自动恢复了）。

### 解决方案

在 `autoSwitch` 配置中添加 `noRestore: true` 标志：

```typescript
// src/models/fal-ai-minimax-hailuo-02.ts

{
  id: 'falHailuo02Resolution',
  type: 'dropdown',
  label: '分辨率',
  defaultValue: '768P',
  autoSwitch: {
    condition: (values) => {
      if (values.falHailuo02FastMode) {
        return values.falHailuo02Resolution !== '512P'
      }
      // ... 其他条件
      return false
    },
    value: (values) => {
      if (values.falHailuo02FastMode) return '512P'
      // ... 其他值
      return '768P'
    },
    noRestore: true // ✅ 添加此标志
  },
  // ...
}
```

### 关键要点

- `noRestore: true` 会阻止自动恢复行为，让参数在条件不满足时保持当前值
- 这个标志适用于"模式切换"类型的 autoSwitch，不适用于"参数联动"类型的 autoSwitch
- 如果不确定是否需要 `noRestore`，可以先不加，观察用户反馈

---

## 5. 参数传递不完整

### 问题描述

在 UI 中设置的参数值没有正确传递到 API 请求中。例如，用户选择了 10s 时长，但实际请求中没有 `duration` 参数。

### 根本原因

这个问题通常由以下两个原因之一或组合导致：

#### 原因 1：TypeScript 类型定义缺失

`BuildOptionsParams` 接口中缺少参数的类型定义，导致参数在传递过程中被 TypeScript 类型系统忽略或丢失。

**定位方法**：检查 `src/components/MediaGenerator/builders/core/types.ts`

```typescript
// 错误示例：缺少 Hailuo 02 的参数定义
export interface BuildOptionsParams {
  // ... 其他参数
  falHailuo23Duration?: string
  falHailuo23Resolution?: string
  falHailuo23FastMode?: boolean
  falHailuo23PromptOptimizer?: boolean
  // ❌ 缺少 Hailuo 02 的参数定义
  falKlingVideoO1VideoDuration?: number
  // ...
}

// 正确示例
export interface BuildOptionsParams {
  // ... 其他参数
  falHailuo23Duration?: string
  falHailuo23Resolution?: string
  falHailuo23FastMode?: boolean
  falHailuo23PromptOptimizer?: boolean
  falHailuo02Duration?: string // ✅ 添加
  falHailuo02Resolution?: string // ✅ 添加
  falHailuo02FastMode?: boolean // ✅ 添加
  falHailuo02PromptOptimizer?: boolean // ✅ 添加
  falKlingVideoO1VideoDuration?: number
  // ...
}
```

#### 原因 2：路由处理器逻辑错误

路由处理器中的条件判断错误，导致某些情况下不传递参数。

**定位方法**：检查模型的路由处理器（如 `src/adapters/fal/models/fal-ai-minimax-hailuo-02.ts`）

```typescript
// 错误示例：快速模式下不传递 duration
if (version === 'standard' && !fastMode) { // ❌ 快速模式下不会执行
  requestData.duration = duration
}

// 正确示例：快速模式下也传递 duration
if (version === 'standard') { // ✅ 移除 !fastMode 条件
  requestData.duration = duration
}
```

### 解决方案总结

1. 在 `BuildOptionsParams` 接口中添加所有参数的类型定义
2. 检查路由处理器的条件判断逻辑，确保所有需要的参数都会被传递
3. 使用控制台日志调试参数传递链：
   - 在 `buildGenerateOptions` 中打印传递的参数
   - 在 `OptionsBuilder.build()` 中打印构建的 options
   - 在路由处理器中打印接收到的参数

### 调试技巧

在 `src/components/MediaGenerator/builders/optionsBuilder.ts` 中添加调试日志：

```typescript
export async function buildGenerateOptions(params: BuildOptionsParams): Promise<Record<string, any>> {
  // ... 构建逻辑

  const options = await optionsBuilder.build(context)

  // 添加调试日志
  console.log(`[OptionsBuilder] Built options keys:`, Object.keys(options))
  console.log(`[OptionsBuilder] Built options:`, options)

  return options
}
```

在路由处理器中添加调试日志：

```typescript
buildVideoRequest: async (params: GenerateVideoParams) => {
  // 添加调试日志
  console.log('[Model] 接收到的参数:', {
    duration: params.duration,
    durationType: typeof params.duration,
    // ... 其他参数
  })

  // ... 构建请求逻辑
}
```

### 关键要点

- TypeScript 类型定义不仅是为了类型检查，也会影响运行时的参数传递
- 参数传递链很长，需要在多个关键点添加日志来定位问题
- 路由处理器的条件判断要仔细考虑所有可能的场景

---

## 通用调试流程

当遇到模型适配问题时，建议按以下流程排查：

1. **确认参数定义**
   - 检查 `src/models/` 下的参数 schema 定义
   - 确认 `modelSchemaMap` 中的映射正确

2. **确认状态管理**
   - 检查 `src/components/MediaGenerator/hooks/useMediaGeneratorState.ts` 中是否定义了所有状态
   - 检查 `src/config/presetStateMapping.ts` 中是否映射了所有参数

3. **确认 UI 渲染**
   - 检查 `src/components/MediaGenerator/components/ParameterPanel.tsx` 中是否渲染了参数
   - 使用 React DevTools 查看组件的 props 和 state

4. **确认参数传递**
   - 检查 `BuildOptionsParams` 类型定义
   - 检查 `buildGenerateOptions` 函数
   - 检查 OptionsBuilder 配置
   - 检查路由处理器

5. **确认 API 请求**
   - 使用浏览器开发者工具的 Network 面板查看实际发送的请求
   - 对比请求参数与预期参数

6. **使用调试日志**
   - 在关键点添加 `console.log` 来追踪参数流动
   - 使用 React DevTools 的 Profiler 来分析渲染性能

---

## 相关文档

- [Fal 模型适配指南](../ai-guide-fal.md)
- [Fal 模型适配指南 V2](../ai-guide-fal-v2.md)
- [新模型接入指南](../ai-guide-new-model.md)

---

**最后更新时间**：2025-12-10
