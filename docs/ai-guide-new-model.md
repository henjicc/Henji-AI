# 适配指南：为现有供应商添加新模型

## 核心流程

```
定义参数 Schema → 添加状态管理 → 注册参数映射 → 添加 OptionsBuilder 配置 → 配置 providers.json → 配置价格
```

---

## ⚠️ 统一参数命名规范（必读）

**所有模型参数必须使用供应商前缀**，避免参数冲突：

```
{providerId}{ModelName}{ParameterName}
```

**示例**：
- `ppioViduQ1VideoDuration` - 派欧云 Vidu Q1 时长
- `falVeo31VideoDuration` - Fal Veo 3.1 时长
- `ppioHailuo23VideoResolution` - 派欧云 Hailuo 2.3 分辨率

**前缀规则**：
- `ppio` = 派欧云 (PiaoYun)
- `fal` = Fal.ai
- `ms` = 魔搭 (ModelScope)

**为什么需要前缀？**
- 不同供应商的相同模型会共享状态，导致参数混乱
- 预设功能无法区分不同供应商的参数
- 价格计算会使用错误的参数值

---

## 1. 定义参数 Schema

**位置**: `src/models/[provider]-[model-id].ts`

```typescript
import { ParamDef } from '../types/schema'

export const yourModelParams: ParamDef[] = [
  // ⚠️ 参数 ID 必须使用供应商前缀
  {
    id: 'ppioYourModelVideoDuration',  // 使用前缀！
    type: 'dropdown',
    label: '时长',
    defaultValue: 5,
    options: [
      { value: 5, label: '5s' },
      { value: 10, label: '10s' }
    ]
  },

  // 宽高比参数（带智能匹配）
  {
    id: 'ppioYourModelVideoAspectRatio',  // 使用前缀！
    type: 'dropdown',
    defaultValue: '16:9',
    resolutionConfig: {
      type: 'aspect_ratio',
      smartMatch: true,
      visualize: true,
      extractRatio: (value) => {
        if (value === 'smart') return null
        const [w, h] = value.split(':').map(Number)
        return w / h
      }
    },
    options: (values) => {
      const baseOptions = [
        { value: '16:9', label: '16:9' },
        { value: '9:16', label: '9:16' },
        { value: '1:1', label: '1:1' }
      ]
      // 图生视频时添加智能选项
      if (values.uploadedImages?.length > 0) {
        return [{ value: 'smart', label: '智能' }, ...baseOptions]
      }
      return baseOptions
    },
    // 上传图片时自动切换到智能模式
    autoSwitch: {
      condition: (values) => values.uploadedImages?.length > 0,
      value: 'smart'
    }
  }
]
```

**注册 Schema**: 在 `src/models/index.ts` 中：

```typescript
import { yourModelParams } from './your-model'

export { yourModelParams } from './your-model'

export const modelSchemaMap: Record<string, ParamDef[]> = {
  'your-model': yourModelParams
}
```

---

## 2. 添加参数面板渲染

**位置**: `src/components/MediaGenerator/components/ParameterPanel.tsx`

```typescript
// 导入 Schema
import { yourModelParams } from '@/models'

// 在 return 语句中添加渲染分支
if (selectedModel === 'your-model') {
  return (
    <SchemaForm
      schema={yourModelParams}
      values={{
        // ⚠️ 必须传递所有参数的当前值（使用带前缀的参数名）
        ppioYourModelVideoDuration: values.ppioYourModelVideoDuration,
        ppioYourModelVideoAspectRatio: values.ppioYourModelVideoAspectRatio,

        // ⚠️ 如果使用 resolutionConfig，必须传递
        customWidth: values.customWidth,
        customHeight: values.customHeight,

        // ⚠️ 如果支持图片上传，必须传递
        uploadedImages
      }}
      onChange={onChange}
    />
  )
}
```

---

## 3. 添加状态管理

**位置**: `src/components/MediaGenerator/hooks/useMediaGeneratorState.ts`

```typescript
// 添加新参数的状态（使用带前缀的参数名）
const [ppioYourModelVideoDuration, setPpioYourModelVideoDuration] = useState(5)
const [ppioYourModelVideoAspectRatio, setPpioYourModelVideoAspectRatio] = useState('16:9')

// 在 return 中导出
return {
  // ... 现有状态
  ppioYourModelVideoDuration,
  setPpioYourModelVideoDuration,
  ppioYourModelVideoAspectRatio,
  setPpioYourModelVideoAspectRatio
}
```

---

## 4. 注册参数映射

### 4.1 在 handleSchemaChange 中注册

**位置**: `src/components/MediaGenerator/index.tsx`

```typescript
const handleSchemaChange = (id: string, value: any) => {
  const setterMap: Record<string, (v: any) => void> = {
    // ... 现有映射
    ppioYourModelVideoDuration: state.setPpioYourModelVideoDuration,
    ppioYourModelVideoAspectRatio: state.setPpioYourModelVideoAspectRatio
  }

  const setter = setterMap[id]
  if (setter) {
    setter(value)
  }
}
```

### 4.2 在 presetStateMapping 中注册

**位置**: `src/config/presetStateMapping.ts`

```typescript
// 1. 添加到接口
export interface PresetSetters {
  // ... 现有 setter
  setPpioYourModelVideoDuration: (v: number) => void
  setPpioYourModelVideoAspectRatio: (v: string) => void
}

// 2. 添加到映射函数
export function createPresetSetterMap(setters: PresetSetters) {
  return {
    // ... 现有映射
    ppioYourModelVideoDuration: setters.setPpioYourModelVideoDuration,
    ppioYourModelVideoAspectRatio: setters.setPpioYourModelVideoAspectRatio
  }
}
```

### 4.3 传入 setter

**位置**: `src/components/MediaGenerator/index.tsx`

```typescript
const setterMap = useMemo(() => createPresetSetterMap({
  // ... 现有 setter
  setPpioYourModelVideoDuration: state.setPpioYourModelVideoDuration,
  setPpioYourModelVideoAspectRatio: state.setPpioYourModelVideoAspectRatio
}), [])
```

---

## 5. 添加 OptionsBuilder 配置（新架构）

**位置**: `src/components/MediaGenerator/builders/configs/[provider]-models.ts`

```typescript
import { ModelConfig } from '../core/types'

export const yourModelConfig: ModelConfig = {
  id: 'your-model',
  type: 'video',
  provider: 'ppio',  // 或 'fal', 'modelscope'

  // 参数映射（API 参数名 → UI 状态参数名）
  paramMapping: {
    duration: {
      source: ['ppioYourModelVideoDuration', 'videoDuration'],  // 优先使用模型特定参数
      defaultValue: 5
    },
    aspect_ratio: {
      source: 'ppioYourModelVideoAspectRatio',
      defaultValue: '16:9'
    }
  },

  // 特性配置
  features: {
    // 智能匹配
    smartMatch: {
      enabled: true,
      paramKey: 'aspect_ratio',
      defaultRatio: '16:9'
    },
    // 图片上传
    imageUpload: {
      enabled: true,
      maxImages: 1,
      mode: 'single',
      paramKey: 'image_url',
      convertToBlob: false  // Fal 模型为 false，PPIO 模型为 true
    }
  }
}
```

**注册配置**: 在 `src/components/MediaGenerator/builders/configs/index.ts` 中：

```typescript
import { yourModelConfig } from './ppio-models'

export function registerAllConfigs() {
  // ... 现有注册
  optionsBuilder.registerConfig(yourModelConfig)
}
```

**OptionsBuilder 配置说明**：

- **paramMapping**: 定义 API 参数如何从 UI 状态获取
  - `source`: 参数来源，支持数组（优先使用第一个存在的参数）
  - `defaultValue`: 默认值
  - `transform`: 可选的转换函数
  - `condition`: 可选的条件函数

- **features**: 特性配置
  - `smartMatch`: 智能匹配配置
  - `imageUpload`: 图片上传配置
  - `videoUpload`: 视频上传配置
  - `modeSwitch`: 模式切换配置（如 Vidu Q1）

- **customHandlers**: 自定义处理器
  - `beforeBuild`: 构建前处理
  - `afterBuild`: 构建后处理
  - `validateParams`: 参数验证

---

## 6. 配置 providers.json

**位置**: `src/config/providers.json`

```json
{
  "id": "your-model",
  "name": "Your Model Name",
  "type": "video",
  "description": "模型描述",
  "functions": ["文生视频", "图生视频"],
  "progressConfig": {
    "type": "polling",
    "expectedPolls": 40
  }
}
```

---

## 7. 配置价格

**位置**: `src/config/pricing.ts`

```typescript
{
  providerId: 'piaoyun',
  modelId: 'your-model',
  currency: '¥',
  type: 'calculated',
  calculator: (params) => {
    // ⚠️ 使用带前缀的参数名，并提供回退
    const duration = params.ppioYourModelVideoDuration
                  || params.videoDuration
                  || 5
    const hasImage = params.uploadedImages?.length > 0

    if (hasImage) {
      return duration === 10 ? 5 : 2.5
    } else {
      return duration === 10 ? 4 : 2
    }
  }
}
```

**确保传递参数**: 在 `src/components/MediaGenerator/index.tsx` 的 `PriceEstimate` 组件中：

```typescript
<PriceEstimate
  providerId={state.selectedProvider}
  modelId={state.selectedModel}
  params={{
    // 传递所有计算所需的参数
    ppioYourModelVideoDuration: state.ppioYourModelVideoDuration,
    uploadedImages: state.uploadedImages
  }}
/>
```

---

## 检查清单

### 核心步骤（必须完成）
- [ ] 在 `src/models/` 创建参数 Schema 文件（使用带前缀的参数名）
- [ ] 在 `src/models/index.ts` 导出并注册 Schema
- [ ] 在 `ParameterPanel.tsx` 添加渲染分支
- [ ] 在 `useMediaGeneratorState.ts` 添加状态（使用带前缀的参数名）
- [ ] 在 `handleSchemaChange` 中注册参数映射
- [ ] 在 `presetStateMapping.ts` 添加预设映射
- [ ] 在 `MediaGenerator/index.tsx` 传入 setter
- [ ] 在 `configs/` 目录添加 OptionsBuilder 配置
- [ ] 在 `configs/index.ts` 注册配置
- [ ] 在 `providers.json` 添加模型配置

### 可选步骤
- [ ] 在 `pricing.ts` 添加价格配置（使用带前缀的参数名）
- [ ] 添加默认值重置逻辑（如需要）

---

## 常见错误

### ⚠️ 参数命名错误（最常见）

```typescript
// ❌ 错误：使用通用参数名
{
  id: 'videoDuration',  // 会与其他模型冲突！
  type: 'dropdown',
  // ...
}

// ✅ 正确：使用带前缀的参数名
{
  id: 'ppioYourModelVideoDuration',  // 唯一标识
  type: 'dropdown',
  // ...
}
```

### ⚠️ OptionsBuilder 配置错误

```typescript
// ❌ 错误：只使用通用参数
paramMapping: {
  duration: 'videoDuration'  // 会导致价格计算错误
}

// ✅ 正确：优先使用模型特定参数，提供回退
paramMapping: {
  duration: {
    source: ['ppioYourModelVideoDuration', 'videoDuration'],
    defaultValue: 5
  }
}
```

### ⚠️ 价格计算错误

```typescript
// ❌ 错误：只使用通用参数
calculator: (params) => {
  const duration = params.videoDuration || 5  // 可能获取不到值
  return calculatePrice(duration)
}

// ✅ 正确：使用模型特定参数，提供回退
calculator: (params) => {
  const duration = params.ppioYourModelVideoDuration
                || params.videoDuration
                || 5
  return calculatePrice(duration)
}
```

---

## 参数类型速查

### dropdown（下拉选择）
```typescript
{
  id: 'ppioYourModelParam',
  type: 'dropdown',
  defaultValue: 'value1',
  options: [
    { value: 'value1', label: '选项1' },
    { value: 'value2', label: '选项2' }
  ]
}
```

### toggle（开关）
```typescript
{
  id: 'ppioYourModelFastMode',
  type: 'toggle',
  label: '快速模式',
  defaultValue: false
}
```

### number（数字输入）
```typescript
{
  id: 'ppioYourModelCfgScale',
  type: 'number',
  label: 'CFG Scale',
  min: 0,
  max: 1,
  step: 0.01,
  precision: 2,
  widthClassName: 'w-24'
}
```

---

## 快速诊断

**问题**: 看不到参数组件
- → 检查 `ParameterPanel.tsx` 是否有渲染分支
- → 检查 Schema 是否在 `modelSchemaMap` 中注册

**问题**: 无法修改参数
- → 检查 `handleSchemaChange` 的 `setterMap`
- → 检查状态是否在 `useMediaGeneratorState` 中导出

**问题**: 价格显示为 0
- → 检查价格计算器是否使用了正确的参数名（带前缀）
- → 检查 `PriceEstimate` 组件是否传递了参数

**问题**: 预设无法保存/恢复
- → 检查 `presetStateMapping.ts` 是否添加了映射
- → 检查参数名是否一致（都使用带前缀的名称）

**问题**: OptionsBuilder 报错找不到配置
- → 检查是否在 `configs/index.ts` 中注册了配置
- → 检查配置的 `id` 是否与模型 ID 匹配
