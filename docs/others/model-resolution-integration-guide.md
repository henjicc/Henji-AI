# 模型分辨率系统集成指南

本文档总结了在集成 Z-Image-Turbo 模型时遇到的问题和解决方案，为后续类似模型的适配提供参考。

## 核心问题回顾

在适配 Z-Image-Turbo 的分辨率系统时，我们遇到了以下关键问题：

### 1. 参数组件不显示
**问题**：切换到 Z-Image-Turbo 模型后，看不到任何参数组件。

**原因**：`ParameterPanel.tsx` 中缺少对应模型的渲染分支。

**解决方案**：
```typescript
// src/components/MediaGenerator/components/ParameterPanel.tsx
if (selectedModel === 'fal-ai-z-image-turbo') {
  return (
    <SchemaForm
      schema={falAiZImageTurboParams}
      values={{
        imageSize: values.imageSize,
        customWidth: values.customWidth,      // ⚠️ 必须传递
        customHeight: values.customHeight,    // ⚠️ 必须传递
        numInferenceSteps: values.numInferenceSteps,
        // ... 其他参数
      }}
      onChange={onChange}
    />
  )
}
```

**关键点**：
- ✅ 必须在 `ParameterPanel.tsx` 中添加模型的渲染分支
- ✅ 必须传递 `customWidth` 和 `customHeight`（如果使用 `resolutionConfig`）

---

### 2. 自定义尺寸不随比例变化
**问题**：点击比例选项后，下方的自定义尺寸输入框数值不更新。

**原因**：`SchemaForm` 的 `values` 对象中缺少 `customWidth` 和 `customHeight`。

**解决方案**：
```typescript
// ParameterPanel.tsx 中必须传递这两个值
values={{
  imageSize: values.imageSize,
  customWidth: values.customWidth,    // ⚠️ 关键！
  customHeight: values.customHeight,  // ⚠️ 关键！
  // ...
}}
```

**关键点**：
- ✅ `UniversalResolutionSelector` 需要 `customWidth` 和 `customHeight` 才能显示数值
- ✅ 这两个值必须通过 `values` 对象传递给 `SchemaForm`

---

### 3. 无法手动修改尺寸数值
**问题**：光标能进入输入框，但无法删除或输入任何内容。

**原因**：`handleSchemaChange` 的 `setterMap` 中缺少 `customWidth` 和 `customHeight` 的映射。

**解决方案**：
```typescript
// src/components/MediaGenerator/index.tsx
const handleSchemaChange = (id: string, value: any) => {
  const setterMap: Record<string, (v: any) => void> = {
    // ... 其他参数
    imageSize: state.setImageSize,
    customWidth: state.setCustomWidth,      // ⚠️ 必须添加
    customHeight: state.setCustomHeight,    // ⚠️ 必须添加
    // ...
  }

  const setter = setterMap[id]
  if (setter) {
    setter(value)
  }
}
```

**关键点**：
- ✅ 所有可编辑的参数都必须在 `handleSchemaChange` 的 `setterMap` 中注册
- ✅ 缺少映射会导致输入无效（看起来像是"无法输入"）

---

### 4. API 请求格式错误
**问题**：API 返回 422 错误，提示 `image_size` 格式不正确。

**原因**：传递的是 `"1760*1168"` 字符串格式，而 fal.ai API 期望的是 `{ width: 1760, height: 1168 }` 对象格式。

**解决方案**：
```typescript
// src/adapters/fal/models/fal-ai-z-image-turbo.ts
buildImageRequest: (params: any) => {
  let imageSize: any = 'landscape_4_3' // 默认值

  if (params.imageSize) {
    // 如果是 "width*height" 格式，转换为对象
    if (params.imageSize.includes('*')) {
      const [width, height] = params.imageSize.split('*').map(Number)
      imageSize = { width, height }  // ⚠️ 转换为对象
    } else {
      imageSize = params.imageSize
    }
  }

  return {
    requestData: {
      image_size: imageSize,  // 发送对象格式
      // ...
    }
  }
}
```

**关键点**：
- ✅ 不同 API 对参数格式的要求不同
- ✅ 在适配器层面进行格式转换，保持内部统一格式（`width*height`）
- ✅ 发送请求前转换为 API 期望的格式

---

### 5. 无限循环问题
**问题**：选项在两个数值之间来回闪烁，控制台报错 "Maximum update depth exceeded"。

**原因**：两个 useEffect 互相触发：
- `imageSize` 变化 → 更新 `customWidth/Height`
- `customWidth/Height` 变化 → 更新 `imageSize`
- 循环往复...

**解决方案**：
```typescript
// src/components/MediaGenerator/index.tsx

// useEffect 1: imageSize → customWidth/Height
useEffect(() => {
  if (state.selectedModel !== 'fal-ai-z-image-turbo') return
  if (!state.imageSize || state.imageSize === '自定义') return

  if (state.imageSize.includes(':')) {
    const size = presetSizes[state.imageSize]
    if (size) {
      // ⚠️ 直接更新，不检查值是否相同
      state.setCustomWidth(String(size.width))
      state.setCustomHeight(String(size.height))
    }
  }
}, [state.imageSize, state.selectedModel])

// useEffect 2: customWidth/Height → imageSize
useEffect(() => {
  if (state.selectedModel !== 'fal-ai-z-image-turbo') return
  if (!state.customWidth || !state.customHeight) return

  const width = parseInt(state.customWidth)
  const height = parseInt(state.customHeight)
  if (isNaN(width) || isNaN(height)) return

  // 检查是否完全匹配某个预设尺寸
  let matchedRatio: string | null = null
  for (const [ratio, size] of Object.entries(presetSizes)) {
    if (size.width === width && size.height === height) {
      matchedRatio = ratio
      break
    }
  }

  // ⚠️ 只有当需要改变时才更新
  if (matchedRatio && state.imageSize !== matchedRatio) {
    state.setImageSize(matchedRatio)
  } else if (!matchedRatio && state.imageSize !== '自定义') {
    state.setImageSize('自定义')
  }
}, [state.customWidth, state.customHeight, state.selectedModel])
```

**关键点**：
- ✅ 避免使用 `isUpdatingRef` + `setTimeout`，时序不可靠
- ✅ 在更新前检查 `state.imageSize !== newValue`，避免不必要的更新
- ✅ 第一个 useEffect 直接更新，第二个 useEffect 检查后更新

---

### 6. 图片上传区域未隐藏
**问题**：Z-Image-Turbo 不支持图片输入，但图片上传区域仍然显示。

**解决方案**：
```typescript
// src/components/MediaGenerator/components/InputArea.tsx
{currentModel?.type !== 'audio' && selectedModel !== 'fal-ai-z-image-turbo' && (
  <div className="mb-3">
    <FileUploader ... />
  </div>
)}
```

**关键点**：
- ✅ 在渲染条件中排除不支持图片的模型
- ✅ 同时调整文本输入框高度以补偿缺失的上传区域

---

### 7. 输入框高度不一致
**问题**：切换到 Z-Image-Turbo 时，整个悬浮框高度变矮。

**解决方案**：
```typescript
// src/components/MediaGenerator/components/InputArea.tsx
className={`... ${
  currentModel?.type === 'audio' || selectedModel === 'fal-ai-z-image-turbo'
    ? 'min-h-[176px]'  // 无图片上传区域时更高
    : 'min-h-[100px]'  // 有图片上传区域时较矮
} ...`}
```

**关键点**：
- ✅ 无图片上传区域的模型需要更高的输入框来保持整体高度一致
- ✅ 与其他类似模型（如 MiniMax Speech-2.6）保持一致的视觉体验

---

## 完整的模型适配检查清单

### 1. 参数定义 (`src/models/xxx.ts`)
- [ ] 定义参数 Schema
- [ ] 如果使用分辨率系统，配置 `resolutionConfig`
- [ ] 导出预设尺寸（如 `presetSizes`）

### 2. 适配器 (`src/adapters/xxx/models/xxx.ts`)
- [ ] 实现 `buildImageRequest` 或对应的请求构建函数
- [ ] 处理参数格式转换（内部格式 → API 格式）
- [ ] 注册到适配器的路由表

### 3. 模型注册 (`src/models/index.ts`)
- [ ] 导入参数定义
- [ ] 导出参数定义
- [ ] 添加到模型列表

### 4. 配置文件 (`src/config/providers.json`)
- [ ] 添加模型配置
- [ ] 设置正确的 `type`（image/video/audio）

### 5. UI 集成 (`src/components/MediaGenerator/components/ParameterPanel.tsx`)
- [ ] 添加模型的渲染分支
- [ ] 传递所有必需的参数（包括 `customWidth`、`customHeight`）
- [ ] 传递 `uploadedImages`（如果需要）

### 6. 状态管理 (`src/components/MediaGenerator/hooks/useMediaGeneratorState.ts`)
- [ ] 添加模型特有的状态
- [ ] 设置合理的默认值
- [ ] 导出状态和 setter

### 7. 参数映射 (`src/components/MediaGenerator/index.tsx`)
- [ ] 在 `handleSchemaChange` 的 `setterMap` 中添加所有参数
- [ ] 在 `buildGenerateOptions` 调用中传递所有参数
- [ ] 添加必要的 useEffect（如分辨率自动更新）

### 8. 预设映射 (`src/config/presetStateMapping.ts`)
- [ ] 在 `PresetSetters` 接口中添加类型定义
- [ ] 在 `createPresetSetterMap` 中添加映射

### 9. 生成选项构建 (`src/components/MediaGenerator/builders/optionsBuilder.ts`)
- [ ] 添加模型的参数处理逻辑
- [ ] 处理特殊参数（如分辨率、图片等）
- [ ] 添加参数类型定义到 `BuildOptionsParams`

### 10. 输入区域 (`src/components/MediaGenerator/components/InputArea.tsx`)
- [ ] 如果不支持图片，在渲染条件中排除模型
- [ ] 调整输入框高度（如果需要）

---

## 常见陷阱

### ❌ 陷阱 1：忘记传递 `customWidth` 和 `customHeight`
**症状**：自定义尺寸输入框不显示数值或不更新。

**检查**：
```typescript
// ParameterPanel.tsx
values={{
  imageSize: values.imageSize,
  customWidth: values.customWidth,    // ⚠️ 必须有
  customHeight: values.customHeight,  // ⚠️ 必须有
}}
```

### ❌ 陷阱 2：忘记在 `handleSchemaChange` 中注册参数
**症状**：无法手动修改参数值。

**检查**：
```typescript
// index.tsx - handleSchemaChange
const setterMap = {
  customWidth: state.setCustomWidth,    // ⚠️ 必须有
  customHeight: state.setCustomHeight,  // ⚠️ 必须有
}
```

### ❌ 陷阱 3：useEffect 无限循环
**症状**：控制台报错 "Maximum update depth exceeded"，值来回闪烁。

**检查**：
- 确保更新前检查 `state.value !== newValue`
- 避免两个 useEffect 互相触发
- 不要使用不可靠的 `setTimeout` 来"打破"循环

### ❌ 陷阱 4：API 参数格式不匹配
**症状**：API 返回 422 或其他格式错误。

**检查**：
- 在适配器中进行格式转换
- 查看 API 文档确认期望的格式
- 添加日志输出实际发送的参数

### ❌ 陷阱 5：忘记导入 `presetSizes`
**症状**：运行时报错 "require is not defined" 或 "presetSizes is not defined"。

**检查**：
```typescript
// index.tsx 顶部
import { presetSizes } from '@/models/fal-ai-z-image-turbo'
```

---

## 调试技巧

### 1. 添加日志输出
```typescript
useEffect(() => {
  console.log('[ModelName] imageSize changed:', {
    imageSize: state.imageSize,
    customWidth: state.customWidth,
    customHeight: state.customHeight
  })
  // ...
}, [state.imageSize])
```

### 2. 检查 SchemaForm 接收的值
```typescript
console.log('[ParameterPanel] values:', {
  imageSize: values.imageSize,
  customWidth: values.customWidth,
  customHeight: values.customHeight
})
```

### 3. 检查 API 请求参数
```typescript
console.log('[Adapter] Final request data:', requestData)
```

### 4. 使用浏览器开发者工具
- 查看 Network 标签页，检查实际发送的请求
- 查看 Console 标签页，查找错误和警告
- 使用 React DevTools 检查组件状态

---

## 总结

适配一个新模型的分辨率系统需要在**多个层面**进行集成：

1. **参数定义层**：定义参数 Schema 和预设值
2. **适配器层**：处理 API 格式转换
3. **状态管理层**：添加状态和 setter
4. **UI 层**：渲染参数组件并传递正确的值
5. **逻辑层**：处理参数映射和自动更新

**最容易遗漏的地方**：
- ✅ `ParameterPanel.tsx` 中传递 `customWidth` 和 `customHeight`
- ✅ `handleSchemaChange` 中注册所有参数的 setter
- ✅ 适配器中进行 API 格式转换
- ✅ useEffect 中避免无限循环

**建议的开发流程**：
1. 先定义参数 Schema
2. 实现适配器的请求构建
3. 添加 UI 渲染分支
4. 添加状态管理
5. 添加参数映射
6. 测试并调试
7. 处理边界情况（如图片上传区域、输入框高度等）

遵循本文档的检查清单，可以避免大部分常见问题，加快模型适配速度。
