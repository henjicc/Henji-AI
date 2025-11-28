# 适配指南：为现有供应商添加新模型

## 核心流程

```
添加模型路由 → 定义参数 Schema → 添加状态管理 → 注册预设映射 → 配置 providers.json → 配置价格
```

## 1. 添加模型路由

**位置**: `src/adapters/[provider]/models/[model-id].ts`

```typescript
import { GenerateVideoParams } from '@/adapters/base/BaseAdapter'

export const yourModelRoute = {
  // 模型ID识别
  matches: (modelId: string) => modelId === 'your-model',

  // 构建视频生成请求
  buildVideoRequest: (params: GenerateVideoParams) => {
    const images = params.images || []
    const prompt = params.prompt || ''

    // 参数处理和验证
    const duration = params.duration || 5
    const aspectRatio = params.aspectRatio || '16:9'

    // 智能路由：根据输入类型选择端点
    if (images.length === 0) {
      // 文生视频
      return {
        endpoint: '/v1/text-to-video',
        requestData: {
          prompt,
          duration,
          aspect_ratio: aspectRatio
        }
      }
    } else if (images.length === 1) {
      // 图生视频
      return {
        endpoint: '/v1/image-to-video',
        requestData: {
          image: images[0],
          prompt,
          duration
        }
      }
    } else {
      // 首尾帧
      return {
        endpoint: '/v1/keyframe-to-video',
        requestData: {
          start_image: images[0],
          end_image: images[1],
          prompt,
          duration
        }
      }
    }
  },

  // 如果是图片模型
  buildImageRequest: (params: any) => {
    const images = params.images || []

    if (images.length > 0) {
      // 图生图
      return {
        endpoint: '/v1/image-to-image',
        requestData: {
          image: images[0],
          prompt: params.prompt,
          strength: params.strength || 0.8
        }
      }
    } else {
      // 文生图
      return {
        endpoint: '/v1/text-to-image',
        requestData: {
          prompt: params.prompt,
          width: params.width || 1024,
          height: params.height || 1024
        }
      }
    }
  },

  // 如果是音频模型
  buildAudioRequest: (params: any) => {
    return {
      endpoint: '/v1/text-to-speech',
      requestData: {
        text: params.text,
        voice_id: params.voiceId,
        speed: params.speed || 1.0
      }
    }
  }
}
```

**注册路由**: 在 `src/adapters/[provider]/models/index.ts` 中：

```typescript
import { yourModelRoute } from './your-model'

export const providerModelRoutes: ModelRoute[] = [
  // ... 现有路由
  yourModelRoute  // 添加新路由
]
```

## 2. 定义参数 Schema

**位置**: `src/models/[model-id].ts`

```typescript
import { ParamDef } from '../types/schema'

export const yourModelParams: ParamDef[] = [
  // 时长参数（视频模型）
  {
    id: 'videoDuration',           // 必须与状态变量名一致
    type: 'dropdown',
    label: '时长',
    defaultValue: 5,
    options: [
      { value: 5, label: '5s' },
      { value: 10, label: '10s' }
    ]
  },

  // 宽高比参数（带可视化）
  {
    id: 'videoAspectRatio',
    type: 'dropdown',
    defaultValue: '16:9',
    resolutionConfig: {
      type: 'aspect_ratio',
      smartMatch: true,              // 启用智能匹配
      visualize: true,               // 显示可视化图标
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
  },

  // 分辨率参数（带质量选项）
  {
    id: 'aspectRatio',
    type: 'dropdown',
    defaultValue: '1:1',
    resolutionConfig: {
      type: 'aspect_ratio',
      smartMatch: true,
      visualize: true,
      extractRatio: (value) => {
        if (value === 'smart') return null
        const [w, h] = value.split(':').map(Number)
        return w / h
      },
      qualityOptions: [
        { value: '1K', label: '1K' },
        { value: '2K', label: '2K' },
        { value: '4K', label: '4K' }
      ],
      qualityKey: 'resolution'       // 质量参数的 state key
    },
    options: [
      { value: 'smart', label: '智能' },
      { value: '1:1', label: '1:1' },
      { value: '16:9', label: '16:9' },
      { value: '9:16', label: '9:16' }
    ]
  },

  // 开关参数
  {
    id: 'fastMode',
    type: 'toggle',
    label: '快速模式',
    defaultValue: false
  },

  // 数字参数
  {
    id: 'cfgScale',
    type: 'number',
    label: 'CFG Scale',
    min: 0,
    max: 1,
    step: 0.01,
    precision: 2,
    widthClassName: 'w-24'
  },

  // 条件显示参数
  {
    id: 'negativePrompt',
    type: 'text',
    label: '负面提示词',
    hidden: (values) => values.fastMode === true  // 快速模式时隐藏
  },

  // 模式切换参数
  {
    id: 'yourModelMode',
    type: 'dropdown',
    label: '模式',
    defaultValue: 'text-to-video',
    options: (values) => {
      const count = values.uploadedImages?.length || 0
      if (count === 0) {
        return [{ value: 'text-to-video', label: '文生视频' }]
      } else if (count === 1) {
        return [{ value: 'image-to-video', label: '图生视频' }]
      } else {
        return [{ value: 'keyframe-to-video', label: '首尾帧' }]
      }
    },
    // 根据上传图片数量自动切换模式
    autoSwitch: {
      condition: (values) => {
        const count = values.uploadedImages?.length || 0
        if (count === 0) return values.yourModelMode !== 'text-to-video'
        if (count === 1) return values.yourModelMode !== 'image-to-video'
        if (count >= 2) return values.yourModelMode !== 'keyframe-to-video'
        return false
      },
      value: (values: any) => {
        const count = values.uploadedImages?.length || 0
        if (count === 0) return 'text-to-video'
        if (count === 1) return 'image-to-video'
        return 'keyframe-to-video'
      }
    }
  }
]
```

**注册 Schema**: 在 `src/models/index.ts` 中：

```typescript
// 1. 导入
import { yourModelParams } from './your-model'

// 2. 导出
export { yourModelParams } from './your-model'

// 3. 添加到映射表
export const modelSchemaMap: Record<string, ParamDef[]> = {
  // ... 现有映射
  'your-model': yourModelParams
}
```

## 3. 添加状态管理

**位置**: `src/components/MediaGenerator/hooks/useMediaGeneratorState.ts`

```typescript
// 添加新参数的状态
const [yourModelMode, setYourModelMode] = useState('text-to-video')
const [yourModelParam, setYourModelParam] = useState('default-value')

// 在 return 中导出
return {
  // ... 现有状态
  yourModelMode, setYourModelMode,
  yourModelParam, setYourModelParam
}
```

**注意**: 如果使用通用参数（如 `videoDuration`, `videoAspectRatio`），无需添加新状态。

## 4. 注册预设映射

**位置**: `src/config/presetStateMapping.ts`

```typescript
// 1. 添加到 PresetSetters 接口
export interface PresetSetters {
  // ... 现有 setter
  setYourModelMode: (v: string) => void
  setYourModelParam: (v: string) => void
}

// 2. 添加到 createPresetSetterMap
export function createPresetSetterMap(setters: PresetSetters) {
  return {
    // ... 现有映射
    yourModelMode: setters.setYourModelMode,
    yourModelParam: setters.setYourModelParam
  }
}
```

**位置**: `src/components/MediaGenerator/index.tsx`

```typescript
// 在 setterMap 中传入 setter
const setterMap = useMemo(() => createPresetSetterMap({
  // ... 现有 setter
  setYourModelMode: state.setYourModelMode,
  setYourModelParam: state.setYourModelParam
}), [])
```

## 5. 配置 providers.json

**位置**: `src/config/providers.json`

```json
{
  "providers": [
    {
      "id": "provider-id",
      "models": [
        {
          "id": "your-model",
          "name": "Your Model Name",
          "type": "video",
          "description": "模型描述",
          "functions": ["文生视频", "图生视频", "首尾帧"],
          "progressConfig": {
            "type": "polling",
            "expectedPolls": 40
          }
        }
      ]
    }
  ]
}
```

**关键字段**:
- `type`: `image` | `video` | `audio`
- `functions`: 功能标签数组
  - 图片: `图片生成`, `图片编辑`
  - 视频: `文生视频`, `图生视频`, `首尾帧`, `参考生视频`
  - 音频: `语音合成`

### 进度条配置 (progressConfig)

根据模型特性选择合适的进度类型：

**异步轮询模型** (API 返回 taskId，需要轮询查询结果):
```json
"progressConfig": {
  "type": "polling",
  "expectedPolls": 40
}
```

预期轮询次数参考值：
- 超快（30秒内）: 10-15
- 快速（1分钟）: 20-25
- 中速（2-3分钟）: 35-50
- 慢速（5分钟+）: 60-80

计算公式: `expectedPolls ≈ 平均完成时间(秒) / 轮询间隔(3秒) × 80%`

**同步时间模型** (API 同步返回，但耗时较长 >5秒):
```json
"progressConfig": {
  "type": "time",
  "expectedDuration": 20000
}
```

预期耗时参考值（毫秒）：
- 快速模型: 5000-10000
- 中速模型: 15000-25000
- 慢速模型: 30000+

**无进度反馈** (API 返回极快 <2秒):
```json
"progressConfig": {
  "type": "none"
}
```

或直接省略 `progressConfig` 字段。

## 6. 配置价格

**位置**: `src/config/pricing.ts`

```typescript
// 固定价格
{
  providerId: 'provider-id',
  modelId: 'your-model',
  currency: '¥',
  type: 'fixed',
  fixedPrice: 2.5
}

// 动态计价
{
  providerId: 'provider-id',
  modelId: 'your-model',
  currency: '¥',
  type: 'calculated',
  calculator: (params) => {
    const duration = params.videoDuration || 5
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
    // 添加计算所需的参数
    videoDuration: state.videoDuration,
    uploadedImages: state.uploadedImages,
    yourModelParam: state.yourModelParam
  }}
/>
```

## 7. 处理共享状态默认值冲突

如果新模型的默认值与其他模型不同，在 `src/components/MediaGenerator/index.tsx` 中添加：

```typescript
// 重置默认值
useEffect(() => {
  if (state.selectedModel === 'your-model') {
    // 只在值无效时重置，避免覆盖用户选择
    if (state.videoDuration !== 5 && state.videoDuration !== 10) {
      state.setVideoDuration(5)  // 你的模型的默认值
    }
  }
}, [state.selectedModel, state.videoDuration])
```

## 8. 处理硬编码逻辑（重要）

**检查位置**: `src/components/MediaGenerator/builders/optionsBuilder.ts`

搜索 `if (currentModel?.type === 'image')` 或 `if (currentModel?.type === 'video')`，确认是否需要排除新模型：

```typescript
// 示例：排除不使用通用分辨率逻辑的模型
if (currentModel?.type === 'image' &&
    selectedModel !== 'nano-banana' &&
    selectedModel !== 'your-model') {  // 添加排除
  // 通用分辨率处理逻辑
}
```

## 参数类型速查

### dropdown（下拉选择）
```typescript
{
  id: 'param',
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
  id: 'param',
  type: 'toggle',
  label: '开关名称',
  defaultValue: false
}
```

### number（数字输入）
```typescript
{
  id: 'param',
  type: 'number',
  label: '数字参数',
  min: 0,
  max: 100,
  step: 1,
  precision: 0,
  widthClassName: 'w-24'
}
```

### text（文本输入）
```typescript
{
  id: 'param',
  type: 'text',
  label: '文本参数',
  placeholder: '请输入...'
}
```

## 分辨率配置速查

### 纯宽高比
```typescript
resolutionConfig: {
  type: 'aspect_ratio',
  smartMatch: true,
  visualize: true,
  extractRatio: (value) => {
    if (value === 'smart') return null
    const [w, h] = value.split(':').map(Number)
    return w / h
  }
}
```

### 宽高比 + 质量
```typescript
resolutionConfig: {
  type: 'aspect_ratio',
  smartMatch: true,
  visualize: true,
  extractRatio: (value) => { /* ... */ },
  qualityOptions: [
    { value: '2K', label: '2K' },
    { value: '4K', label: '4K' }
  ],
  qualityKey: 'resolution'  // 对应的质量参数 state key
}
```

### 固定尺寸
```typescript
resolutionConfig: {
  type: 'size',
  smartMatch: false,
  visualize: true,
  extractRatio: (value) => {
    const [w, h] = value.split('*').map(Number)
    return w / h
  }
}
```

### 分辨率等级
```typescript
resolutionConfig: {
  type: 'resolution',
  smartMatch: false,
  visualize: false
}
```

## Adapter 中处理智能匹配

**重要**: 永远不要直接传递 `'smart'` 或 `'auto'` 给 API。

```typescript
let aspectRatio = params.aspectRatio

// 如果是智能模式且有图片，计算实际比例
if ((aspectRatio === 'smart' || aspectRatio === 'auto') && images.length > 0) {
  try {
    const { getImageAspectRatio, matchAspectRatio } = await import('@/utils/aspectRatio')
    const firstImageUrl = images[0]
    const ratio = await getImageAspectRatio(firstImageUrl)
    aspectRatio = matchAspectRatio(ratio)  // 匹配最接近的预设比例
    console.log(`[Adapter] 智能计算宽高比: ${ratio.toFixed(2)}，匹配预设: ${aspectRatio}`)
  } catch (error) {
    console.error('[Adapter] 计算图片宽高比失败:', error)
    aspectRatio = '16:9'  // 回退默认值
  }
}

// 只传递实际的比例值给 API
if (aspectRatio && aspectRatio !== 'smart' && aspectRatio !== 'auto') {
  requestData.aspect_ratio = aspectRatio
}
```

## 检查清单

- [ ] 在 `adapters/[provider]/models/` 创建模型路由文件
- [ ] 在 `models/index.ts` 注册路由
- [ ] 在 `src/models/` 创建参数 Schema 文件
- [ ] 在 `src/models/index.ts` 导出并注册 Schema
- [ ] 在 `useMediaGeneratorState.ts` 添加新参数状态（如需要）
- [ ] 在 `presetStateMapping.ts` 添加预设映射
- [ ] 在 `MediaGenerator/index.tsx` 传入 setter
- [ ] 在 `providers.json` 添加模型配置
- [ ] 在 `pricing.ts` 添加价格配置（可选）
- [ ] 检查 `optionsBuilder.ts` 中的硬编码逻辑
- [ ] 添加默认值重置逻辑（如需要）
- [ ] 在 Adapter 中处理智能匹配（如使用）
- [ ] 测试文生/图生/多图功能
- [ ] 测试参数变更和预设保存/加载
- [ ] 测试重新编辑历史记录

## 常见陷阱

1. **参数命名不一致**: Schema 的 `id` 必须与状态变量名完全一致
2. **忘记注册路由**: 创建了路由文件但未在 `models/index.ts` 导入
3. **忘记注册 Schema**: 创建了 Schema 文件但未在 `modelSchemaMap` 添加
4. **忘记预设映射**: 新参数未添加到 `presetStateMapping.ts`
5. **直接传递 smart**: 在 Adapter 中直接传递 `'smart'` 给 API 导致 422 错误
6. **状态未导出**: 在 `useMediaGeneratorState` 中创建了状态但 return 中遗漏
7. **硬编码冲突**: 未检查 `optionsBuilder.ts` 中的类型判断逻辑
8. **共享状态污染**: 未添加默认值重置逻辑导致切换模型时继承错误的值
