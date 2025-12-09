# Fal 适配器专用指南

---

## 统一参数命名规范

**所有 Fal 模型参数必须使用 `fal` 前缀**：

```
fal{ModelName}{ParameterName}
```

**示例**：
- `falVeo31VideoDuration` - Fal Veo 3.1 时长
- `falNanoBananaAspectRatio` - Fal Nano Banana 宽高比
- `falNanoBananaNumImages` - Fal Nano Banana 图片数量

**原因**
- 避免与其他供应商的相同模型参数冲突（如 PPIO 的 Veo 3.1）
- 确保预设功能正确保存和恢复参数
- 确保价格计算使用正确的参数值

---

## 核心特性与架构

### Fal 适配器的特殊性

Fal 适配器使用官方 `@fal-ai/client` SDK，与其他适配器有显著不同：

| 特性 | Fal | PPIO/ModelScope |
|------|-----|-----------------|
| **图片上传** | 自动上传到 fal CDN | 使用 base64 或不支持 |
| **轮询方式** | SDK 自动轮询 (`fal.subscribe`) | 手动轮询 |
| **进度计算** | 基于轮询次数 | 基于时间或轮询次数 |
| **本地保存** | App.tsx 统一处理 | Adapter 内部处理 |

### 关键设计原则

1. **图片已上传**: 模型路由收到的 `params.images` 已经是 fal CDN URL，**直接使用**
2. **不保存媒体**: Fal 图片解析器**不调用** `saveMediaLocally`，由 App.tsx 统一处理
3. **轮询进度**: 必须配置 `"type": "polling"` 和 `expectedPolls`
4. **智能匹配**: 永远不要传递 `'smart'` 或 `'auto'` 给 API
5. **禁止修改原始 params**: FalAdapter 已经正确处理图片上传，模型路由**不要修改** `params` 对象

---

## 完整适配流程

### 总览：8 个必须步骤

```
1. 定义参数 Schema (使用 fal 前缀)
2. 添加参数面板渲染
3. 添加状态管理 (使用 fal 前缀)
4. 注册参数映射
5. 添加 OptionsBuilder 配置
6. 创建模型路由 (adapters/fal/models/)
7. 配置轮询次数 (config.ts)
8. 配置 providers.json 和价格
```

---

## 步骤 1: 定义参数 Schema

**位置**: `src/models/fal-ai-[model-id].ts`

```typescript
import { ParamDef } from '../types/schema'

export const falYourModelParams: ParamDef[] = [
  // 参数 ID 必须使用 fal 前缀
  {
    id: 'falYourModelNumImages',  // 使用 fal 前缀！
    type: 'dropdown',
    label: '数量',
    defaultValue: 1,
    options: [
      { value: 1, label: '1张' },
      { value: 2, label: '2张' },
      { value: 4, label: '4张' }
    ]
  },

  // 宽高比参数（带智能匹配）
  {
    id: 'falYourModelAspectRatio',  // 使用 fal 前缀！
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
      }
    },
    options: (values) => {
      const baseOptions = [
        { value: '1:1', label: '1:1' },
        { value: '16:9', label: '16:9' },
        { value: '9:16', label: '9:16' }
      ]
      // 图生图时添加智能选项
      if (values.uploadedImages?.length > 0) {
        return [{ value: 'smart', label: '智能' }, ...baseOptions]
      }
      return baseOptions
    }
  }
]
```

**注册 Schema**: 在 `src/models/index.ts` 中：

```typescript
export { falYourModelParams } from './fal-ai-your-model'

export const modelSchemaMap: Record<string, ParamDef[]> = {
  'fal-ai-your-model': falYourModelParams,
  'your-model': falYourModelParams  // 支持短名称
}
```

---

## 步骤 2-4: 参数面板、状态管理、参数映射

参考 [ai-guide-new-model.md](./ai-guide-new-model.md) 的步骤 2-4，使用 `fal` 前缀的参数名。

---

## 步骤 5: 添加 OptionsBuilder 配置

**位置**: `src/components/MediaGenerator/builders/configs/fal-models.ts`

### 通用处理器说明

Fal 提供了三个通用处理器，涵盖大部分场景：

1. **commonImageUploadHandler**: 处理图片上传（图生图、图生视频）
2. **commonVideoUploadHandler**: 处理视频上传（视频编辑）
3. **commonMediaUploadHandler**: 处理图片+视频上传（多模态模型）

```typescript
import { ModelConfig } from '../core/types'
import { commonImageUploadHandler, commonVideoUploadHandler, commonMediaUploadHandler } from './fal-models'

export const falYourModelConfig: ModelConfig = {
  id: 'your-model',  // 短名称
  type: 'image',
  provider: 'fal',

  // 参数映射（API 参数名 → UI 状态参数名）
  paramMapping: {
    // 数组形式：按优先级尝试多个参数（使用第一个存在的值）
    num_images: {
      source: ['falYourModelNumImages', 'numImages'],  // 优先使用 fal 前缀参数
      defaultValue: 1
    },
    aspect_ratio: {
      source: ['falYourModelAspectRatio', 'aspectRatio'],
      defaultValue: '1:1'
    },
    // 字符串形式：直接映射单个参数
    seed: 'seed',
    guidance_scale: 'guidanceScale'
  },

  // 特性配置
  features: {
    smartMatch: {
      enabled: true,
      paramKey: 'aspect_ratio',
      defaultRatio: '1:1'
    },
    imageUpload: {
      enabled: true,
      maxImages: 1,
      mode: 'single',
      paramKey: 'image_url',
      convertToBlob: false  // Fal 模型必须为 false
    }
    // 如果支持视频上传，添加：
    // videoUpload: {
    //   enabled: true,
    //   maxVideos: 1,
    //   paramKey: 'videos'
    // }
  },

  // 自定义处理器（推荐使用通用处理器）
  customHandlers: commonImageUploadHandler
}

// 或者使用自定义处理器（如需特殊逻辑）
export const falYourModelConfigCustom: ModelConfig = {
  // ... 其他配置相同 ...

  customHandlers: {
    afterBuild: async (options, context) => {
      const params = context.params

      // 1. 处理图片上传（如果需要）
      if (context.uploadedImages.length > 0) {
        const { dataUrlToBlob, saveUploadImage } = await import('@/utils/save')
        const setUploadedFilePaths = (params as any).setUploadedFilePaths
        const uploadedFilePaths = (params as any).uploadedFilePaths || []

        // 重要：立即设置图片数据到 options 中
        options.images = context.uploadedImages

        const paths: string[] = [...uploadedFilePaths]
        for (let i = 0; i < context.uploadedImages.length; i++) {
          if (!paths[i]) {
            const blob = await dataUrlToBlob(context.uploadedImages[i])
            const saved = await saveUploadImage(blob, 'persist')
            paths[i] = saved.fullPath
          }
        }

        setUploadedFilePaths(paths)
        options.uploadedFilePaths = paths
      }

      // 2. 自定义逻辑（示例：参数格式转换）
      if (options.images && !Array.isArray(options.images)) {
        options.images = [options.images]
      }
    }
  }
}
```

**视频模型配置示例**（支持图片+视频上传）：

```typescript
export const falYourVideoModelConfig: ModelConfig = {
  id: 'your-video-model',
  type: 'video',
  provider: 'fal',

  paramMapping: {
    mode: {
      source: 'falYourVideoModelMode',
      defaultValue: 'text-to-video'
    },
    duration: {
      source: ['falYourVideoModelDuration', 'videoDuration'],
      defaultValue: 5
    },
    aspectRatio: {
      source: 'falYourVideoModelAspectRatio',
      defaultValue: '16:9'
    }
  },

  features: {
    smartMatch: {
      enabled: true,
      paramKey: 'aspectRatio',
      defaultRatio: '16:9'
    },
    imageUpload: {
      enabled: true,
      maxImages: 2,
      mode: 'multiple',
      paramKey: 'images',
      convertToBlob: false
    },
    videoUpload: {
      enabled: true,
      maxVideos: 1,
      paramKey: 'videos'
    }
  },

  customHandlers: commonMediaUploadHandler  // 图片+视频
}
```

**注册配置**: 在 `src/components/MediaGenerator/builders/configs/index.ts` 中：

```typescript
import { falYourModelConfig } from './fal-models'

export function registerAllConfigs() {
  // ... 现有注册
  optionsBuilder.registerConfig(falYourModelConfig)

  // 注册别名（支持完整名称）
  optionsBuilder.registerConfig({ ...falYourModelConfig, id: 'fal-ai-your-model' })
}
```

---

## 步骤 6: 创建模型路由

**位置**: `src/adapters/fal/models/fal-ai-[model-id].ts`

### 图片模型模板

```typescript
import { GenerateImageParams } from '@/adapters/base/BaseAdapter'
import { FalModelRoute } from './index'

export const falYourModelRoute: FalModelRoute = {
  // 模型匹配规则（支持多个别名）
  matches: (modelId: string) =>
    modelId === 'fal-ai/your-model' ||
    modelId === 'your-model',

  // 构建图片生成请求
  buildImageRequest: (params: GenerateImageParams) => {
    const images = params.images || []  // 已上传到 CDN，直接使用

    // 智能路由：根据是否有图片选择端点
    const hasImages = images.length > 0
    const submitPath = hasImages
      ? 'fal-ai/your-model/edit'      // 图生图端点
      : 'fal-ai/your-model'            // 文生图端点

    const modelId = 'fal-ai/your-model'  // 不含子路径（如 /edit）

    // 构建请求数据
    const requestData: any = {
      prompt: params.prompt
    }

    // 添加可选参数
    if (params.num_images !== undefined) {
      requestData.num_images = params.num_images
    }

    // 关键：过滤掉 'smart' 和 'auto'，不传递给 API
    if (params.aspect_ratio !== undefined &&
        params.aspect_ratio !== 'smart' &&
        params.aspect_ratio !== 'auto') {
      requestData.aspect_ratio = params.aspect_ratio
    }

    // 图生图时添加图片 URL
    if (hasImages) {
      requestData.image_url = images[0]  // 单图用 image_url
      // 或 requestData.image_urls = images  // 多图用 image_urls
    }

    return { submitPath, modelId, requestData }
  }
}
```

### 视频模型模板

```typescript
import { GenerateVideoParams } from '@/adapters/base/BaseAdapter'
import { FalModelRoute } from './index'

export const falYourVideoModelRoute: FalModelRoute = {
  matches: (modelId: string) =>
    modelId === 'fal-ai/your-video-model' ||
    modelId === 'your-video-model',

  buildVideoRequest: async (params: GenerateVideoParams) => {
    const images = params.images || []
    const prompt = params.prompt || ''

    const requestData: any = { prompt }

    // 添加视频参数
    if (params.duration !== undefined) {
      requestData.duration = params.duration
    }

    // 智能匹配处理（如果支持）
    let aspectRatio = params.aspectRatio
    if ((aspectRatio === 'smart' || aspectRatio === 'auto') && images.length > 0) {
      try {
        const { getImageAspectRatio, matchAspectRatio } = await import('@/utils/aspectRatio')
        const ratio = await getImageAspectRatio(images[0])
        aspectRatio = matchAspectRatio(ratio)
        console.log(`[Fal] 智能计算宽高比: ${ratio.toFixed(2)}，匹配预设: ${aspectRatio}`)
      } catch (error) {
        console.error('[Fal] 计算图片宽高比失败:', error)
        aspectRatio = '16:9'  // 回退默认值
      }
    }

    // 只传递实际的比例值
    if (aspectRatio && aspectRatio !== 'smart' && aspectRatio !== 'auto') {
      requestData.aspect_ratio = aspectRatio
    }

    // 图生视频时添加图片
    if (images.length > 0) {
      requestData.image_url = images[0]
    }

    return {
      endpoint: 'fal-ai/your-video-model',
      modelId: 'fal-ai/your-video-model',
      requestData
    }
  }
}
```

**注册路由**: 在 `src/adapters/fal/models/index.ts` 中：

```typescript
import { falYourModelRoute } from './fal-ai-your-model'

export const falModelRoutes: FalModelRoute[] = [
  // ... 现有路由
  falYourModelRoute
]
```

---

## 步骤 7: 配置预估轮询次数

**位置**: `src/adapters/fal/config.ts`

```typescript
export const FAL_CONFIG = {
  modelEstimatedPolls: {
    // ... 现有配置
    'your-model': 25,  // 使用短名称（不含 fal-ai/ 前缀）
  }
}
```

**如何确定预估值**:

| 模型速度 | 平均完成时间 | 推荐 expectedPolls |
|---------|-------------|-------------------|
| 超快 | <30秒 | 5-10 |
| 快速 | 30-60秒 | 10-20 |
| 中速 | 1-2分钟 | 20-30 |
| 慢速 | 2-5分钟 | 30-60 |

**计算公式**: `expectedPolls ≈ 平均完成时间(秒) / 3秒 × 80%`

---

## 步骤 8: 配置 providers.json 和价格

### providers.json

**位置**: `src/config/providers.json`

```json
{
  "id": "your-model",
  "name": "Your Model Name",
  "type": "image",
  "description": "模型描述",
  "functions": ["图片生成", "图片编辑"],
  "progressConfig": {
    "type": "polling",
    "expectedPolls": 25
  }
}
```

### 价格配置

**位置**: `src/config/pricing.ts`

**重要**: Fal 平台使用美元计价，但我们最终以人民币显示。配置时：
1. 在 `PRICES` 常量中使用美元价格
2. 在 `calculator` 中乘以 `USD_TO_CNY` 汇率常量（7.071）
3. `currency` 仍然设置为 `'¥'`

```typescript
// 1. 在 PRICES 常量中添加美元价格
const PRICES = {
  YOUR_FAL_MODEL: 0.0392,  // USD
  // ...
}

// 2. 在 pricingConfigs 数组中添加配置
{
  providerId: 'fal',
  modelId: 'your-model',
  currency: '¥',  // 最终显示人民币
  type: 'calculated',
  calculator: (params) => {
    // 使用 fal 前缀的参数名，并提供回退
    const numImages = params.falYourModelNumImages
                   || params.numImages
                   || 1
    // 美元价格 × 汇率 × 数量
    return PRICES.YOUR_FAL_MODEL * USD_TO_CNY * numImages
  }
}
```

---

## 关键概念详解

### 1. submitPath vs modelId（重要）

这是 Fal 适配器最容易出错的地方：

```typescript
// 正确：有子路径的模型（如 /edit）
{
  submitPath: 'fal-ai/nano-banana/edit',  // 提交请求用（含子路径）
  modelId: 'fal-ai/nano-banana',          // 查询状态用（不含子路径）
  requestData: { ... }
}

// 正确：完整路径的模型
{
  submitPath: 'fal-ai/bytedance/seedream/v4/text-to-image',
  modelId: 'fal-ai/bytedance/seedream/v4/text-to-image',  // 相同
  requestData: { ... }
}

// 错误：modelId 包含子路径
{
  submitPath: 'fal-ai/nano-banana/edit',
  modelId: 'fal-ai/nano-banana/edit',  // 错误！会导致状态查询失败
  requestData: { ... }
}
```

**规则**: `modelId` 永远不包含子路径（如 `/edit`, `/upscale`），只用于状态查询。

---

### 2. 图片参数处理（重要）

Fal 适配器的图片已经自动上传到 CDN，**直接使用**：

```typescript
// 正确：直接使用
const images = params.images || []
if (images.length > 0) {
  requestData.image_urls = images  // FalAdapter 已上传到 CDN
}

// 错误：不要手动转换
requestData.image_urls = images.map(img =>
  img.startsWith('data:') ? img : `data:image/jpeg;base64,${img}`
)

// 错误：不要尝试上传
const uploadedUrls = await uploadToFalCDN(images)  // 不需要！
```

---

### 3. 禁止修改原始 params 对象（极其重要）

**问题背景**：如果在模型路由中修改 `params.images` 或 `params.videos`，当上传失败时会回退到 base64 数据，这些 base64 数据会被保存到 `history.json`，导致文件体积暴增。

**模型路由的正确实现**：

```typescript
// 正确：模型路由只负责构建请求，不修改 params
export const falYourModelRoute: FalModelRoute = {
  buildImageRequest: (params: GenerateImageParams) => {
    // 直接使用 params.images，已经是 fal CDN URL
    const images = params.images || []

    const requestData: any = {
      prompt: params.prompt
    }

    if (images.length > 0) {
      requestData.image_urls = images  // 直接使用，不修改
    }

    return { submitPath, modelId, requestData }
  }
}

// 错误：在模型路由中修改 params
export const wrongFalModelRoute: FalModelRoute = {
  buildImageRequest: async (params: GenerateImageParams) => {
    // 错误！不要在路由中上传或修改 params
    params.images = await uploadToFalCDN(params.images)

    // 错误！不要修改原始数组
    params.images = params.images.map(img => processImage(img))

    // ...
  }
}
```

**关键原则**：
1. **FalAdapter 负责上传**：`generateImage()` 和 `generateVideo()` 方法会自动上传图片/视频到 fal CDN
2. **模型路由只读取**：路由收到的 `params.images` 已经是 URL，直接使用即可
3. **不修改原始对象**：任何需要修改的地方，都应该创建新对象
4. **保护历史记录**：原始 params 会被保存到 history.json，必须保持干净

---

### 4. 智能匹配处理（重要）

永远不要传递 `'smart'` 或 `'auto'` 给 API：

```typescript
// 正确：在路由中检测并转换
let aspectRatio = params.aspectRatio

if ((aspectRatio === 'smart' || aspectRatio === 'auto') && images.length > 0) {
  try {
    const { getImageAspectRatio, matchAspectRatio } = await import('@/utils/aspectRatio')
    const ratio = await getImageAspectRatio(images[0])
    aspectRatio = matchAspectRatio(ratio)  // 转换为实际比例
  } catch (error) {
    aspectRatio = '16:9'  // 回退默认值
  }
}

// 只传递实际的比例值
if (aspectRatio && aspectRatio !== 'smart' && aspectRatio !== 'auto') {
  requestData.aspect_ratio = aspectRatio
}

// 错误：直接传递
requestData.aspect_ratio = params.aspectRatio  // 可能是 'smart'，会导致 422 错误
```

---

## 检查清单

### Fal 特定步骤（必须完成）
- [ ] 在 `src/models/` 创建参数 Schema（使用 `fal` 前缀）
- [ ] 在 `ParameterPanel.tsx` 添加渲染分支
- [ ] 在 `useMediaGeneratorState.ts` 添加状态（使用 `fal` 前缀）
- [ ] 在 `handleSchemaChange` 和 `presetStateMapping` 中注册参数映射
- [ ] 在 `configs/fal-models.ts` 添加 OptionsBuilder 配置
- [ ] 在 `configs/index.ts` 注册配置（包括别名）
- [ ] 在 `adapters/fal/models/` 创建模型路由文件
  - [ ] 实现 `matches()` 方法（支持多个别名）
  - [ ] 实现 `buildImageRequest()` 或 `buildVideoRequest()`
  - [ ] 正确区分 `submitPath`（含子路径）和 `modelId`（不含子路径）
  - [ ] 直接使用 `params.images`（已上传到 CDN）
  - [ ] 过滤掉 `'smart'` 和 `'auto'`，不传递给 API
  - [ ] 添加智能匹配处理（如果支持）
  - [ ] **关键**: 确认没有修改 `params` 对象
- [ ] 在 `adapters/fal/models/index.ts` 注册路由
- [ ] 在 `adapters/fal/config.ts` 配置预估轮询次数
- [ ] 在 `providers.json` 添加模型配置
  - [ ] **关键**: `progressConfig.type` 必须是 `"polling"`
- [ ] 在 `pricing.ts` 添加价格配置
  - [ ] 使用美元价格 × USD_TO_CNY 汇率
  - [ ] 使用 `fal` 前缀的参数名，并提供回退

---

## 常见错误

### 参数命名错误

```typescript
// 错误：使用通用参数名
{
  id: 'numImages',  // 会与其他供应商冲突
  type: 'dropdown',
  // ...
}

// 正确：使用 fal 前缀
{
  id: 'falYourModelNumImages',
  type: 'dropdown',
  // ...
}
```

### OptionsBuilder 配置错误

```typescript
// 错误：convertToBlob 设置为 true
features: {
  imageUpload: {
    enabled: true,
    convertToBlob: true  // 错误！Fal 模型必须为 false
  }
}

// 正确：Fal 模型不转换为 Blob
features: {
  imageUpload: {
    enabled: true,
    convertToBlob: false
  }
}
```

### 价格计算错误

```typescript
// 错误：直接使用美元价格
calculator: (params) => {
  return PRICES.YOUR_FAL_MODEL * numImages  // 显示美元价格
}

// 正确：转换为人民币
calculator: (params) => {
  const numImages = params.falYourModelNumImages || params.numImages || 1
  return PRICES.YOUR_FAL_MODEL * USD_TO_CNY * numImages
}
```

---

## 核心要点总结

1. **参数命名**: 所有参数使用 `fal` 前缀，避免冲突
2. **图片已上传**: `params.images` 已经是 fal CDN URL，**直接使用**
3. **区分路径**: `submitPath` 可以有子路径，`modelId` **永远不含**子路径
4. **轮询进度**: `providers.json` 必须配置 `"type": "polling"`
5. **智能匹配**: 永远不要传递 `'smart'` 或 `'auto'` 给 API，在路由中转换
6. **本地保存**: Fal 图片由 App.tsx 统一保存，解析器**不调用** `saveMediaLocally`
7. **价格转换**: 使用美元价格 × USD_TO_CNY 汇率，显示人民币
8. **OptionsBuilder**: 使用配置驱动架构，`convertToBlob: false`

---

## 快速参考表

### customHandlers 选择

| 场景 | 推荐处理器 | 说明 |
|------|-----------|------|
| 纯文生图/文生视频 | 不需要 | 无媒体上传 |
| 图生图/图生视频 | `commonImageUploadHandler` | 只有图片上传 |
| 视频编辑（仅视频） | `commonVideoUploadHandler` | 只有视频上传 |
| 多模态（图片+视频） | `commonMediaUploadHandler` | 图片和视频都支持 |
| 特殊逻辑（如分辨率计算） | 自定义处理器 | 基于通用处理器扩展 |

### features 配置

| 功能 | 配置项 | 必需场景 |
|------|--------|---------|
| 智能宽高比匹配 | `smartMatch` | 图生图、图生视频（推荐） |
| 图片上传 | `imageUpload` | 图生图、图生视频、多模态 |
| 视频上传 | `videoUpload` | 视频编辑、多模态 |

### paramMapping 形式

| 形式 | 示例 | 使用场景 |
|------|------|---------|
| 字符串 | `seed: 'seed'` | 简单的 1:1 映射 |
| 数组 | `source: ['falModelParam', 'genericParam']` | 模型特定参数 + 通用回退 |
| 对象 | `{ source: 'param', defaultValue: 1 }` | 需要默认值 |
