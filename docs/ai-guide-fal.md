# Fal 适配器专用指南

## 核心特性

Fal 适配器使用官方 `@fal-ai/client` SDK，具有以下特性：

- **自动文件上传**: Base64 图片自动上传到 fal CDN，模型路由直接使用 URL
- **异步队列模式**: 所有模型使用 `fal.subscribe()` 自动轮询
- **轮询进度计算**: 基于轮询次数而非时间

## 快速开始：添加新模型

### 1. 创建模型路由

**位置**: `src/adapters/fal/models/[model-id].ts`

```typescript
import { FalModelRoute } from './index'

export const yourFalModelRoute: FalModelRoute = {
  matches: (modelId: string) => modelId === 'your-fal-model',

  buildImageRequest: (params: any) => {
    const images = params.images || []  // ⚠️ 已上传到 CDN，直接使用

    // 根据是否有图片选择端点
    if (images.length === 0) {
      // 文生图
      return {
        submitPath: 'fal-ai/your-model',
        modelId: 'fal-ai/your-model',
        requestData: {
          prompt: params.prompt,
          num_images: params.numImages || 1,
          aspect_ratio: params.aspectRatio
        }
      }
    } else {
      // 图生图（使用 /edit 子路径）
      return {
        submitPath: 'fal-ai/your-model/edit',
        modelId: 'fal-ai/your-model',  // ⚠️ 不含子路径
        requestData: {
          prompt: params.prompt,
          image_urls: images,  // 直接使用
          num_images: params.numImages || 1
        }
      }
    }
  }
}
```

**视频模型**:
```typescript
buildVideoRequest: async (params: any) => {
  const images = params.images || []

  return {
    endpoint: 'fal-ai/your-video-model',
    modelId: 'fal-ai/your-video-model',
    requestData: {
      prompt: params.prompt,
      duration: params.duration || 5,
      aspect_ratio: params.aspectRatio || '16:9',
      ...(images.length > 0 && { image_url: images[0] })
    }
  }
}
```

### 2. 注册路由

**位置**: `src/adapters/fal/models/index.ts`

```typescript
import { yourFalModelRoute } from './your-fal-model'

export const falModelRoutes: FalModelRoute[] = [
  // ... 现有路由
  yourFalModelRoute
]
```

### 3. 配置预估轮询次数

**位置**: `src/adapters/fal/config.ts`

```typescript
export const FAL_CONFIG = {
  modelEstimatedPolls: {
    // ... 现有配置
    'fal-ai/your-model': 25
  }
}
```

**参考值**:
- 超快（<30秒）: 5-10
- 快速（30-60秒）: 10-20
- 中速（1-2分钟）: 20-30
- 慢速（2-5分钟）: 30-60

### 4. 配置 providers.json

**位置**: `src/config/providers.json`

```json
{
  "id": "your-fal-model",
  "name": "Your Fal Model",
  "type": "image",
  "progressConfig": {
    "type": "polling",
    "expectedPolls": 25
  }
}
```

⚠️ **必须使用** `"type": "polling"`

### 5. 其他通用步骤

参考 `docs/ai-guide-new-model.md` 完成：
- 定义参数 Schema
- 添加参数面板渲染
- 注册参数映射
- 添加状态管理
- 配置价格

## 关键概念

### submitPath vs modelId

```typescript
// 有子路径的模型（如 /edit）
{
  submitPath: 'fal-ai/nano-banana/edit',  // 提交请求用
  modelId: 'fal-ai/nano-banana',          // 查询状态用（不含子路径）
  requestData: { ... }
}

// 完整路径的模型
{
  submitPath: 'fal-ai/bytedance/seedream/v4/text-to-image',
  modelId: 'fal-ai/bytedance/seedream/v4/text-to-image',  // 相同
  requestData: { ... }
}
```

### 图片参数处理

```typescript
// ✅ 正确：直接使用
const images = params.images || []
if (images.length > 0) {
  requestData.image_urls = images  // FalAdapter 已上传到 CDN
}

// ❌ 错误：不要手动转换
requestData.image_urls = images.map(img =>
  img.startsWith('data:') ? img : `data:image/jpeg;base64,${img}`
)
```

### 分辨率参数格式

Fal 模型使用三种格式之一：

```typescript
// 格式 1: aspect_ratio (字符串)
requestData.aspect_ratio = params.aspectRatio  // "16:9", "1:1"

// 格式 2: image_size (对象)
const [width, height] = params.imageSize.split('*').map(Number)
requestData.image_size = { width, height }

// 格式 3: resolution (字符串)
requestData.resolution = params.resolution  // "1K", "2K", "4K"
```

⚠️ **不要传递** `'smart'` 或 `'auto'` 给 API（在 `optionsBuilder.ts` 中处理）

### 多图输入

```typescript
// 单图（图生视频）
if (images.length > 0) {
  requestData.image_url = images[0]  // 单数
}

// 多图（图生图）
if (images.length > 0) {
  requestData.image_urls = images  // 复数
}

// 首尾帧
if (images.length >= 2) {
  requestData.start_image = images[0]
  requestData.end_image = images[1]
}
```

## 常见错误

### 1. 文件扩展名是 .octet
**原因**: 传递字符串而不是 Blob
**解决**: FalAdapter 已处理，模型路由无需操作

### 2. 进度条跳回
**原因**: 使用时间而非轮询次数
**解决**: 确保 `providers.json` 使用 `"type": "polling"`

### 3. 响应解析失败
**原因**: SDK 返回 `{data: {images: []}}`
**解决**: 使用 `const data = responseData.data || responseData`

### 4. 状态查询失败
**原因**: `submitPath` 和 `modelId` 混淆
**解决**: `modelId` 不含子路径（如 `/edit`）

## 完整示例

**路由** (`fal-ai-nano-banana.ts`):
```typescript
export const falAiNanoBananaRoute = {
  matches: (modelId: string) =>
    modelId === 'fal-ai/nano-banana' || modelId === 'nano-banana',

  buildImageRequest: (params: GenerateImageParams) => {
    const hasImages = params.images && params.images.length > 0
    const submitPath = hasImages ? 'fal-ai/nano-banana/edit' : 'fal-ai/nano-banana'
    const modelId = 'fal-ai/nano-banana'

    const requestData: any = { prompt: params.prompt }

    if (params.num_images !== undefined) {
      requestData.num_images = params.num_images
    }

    // 不发送 'auto' 或 'smart'
    if (params.aspect_ratio !== undefined &&
        params.aspect_ratio !== 'auto' &&
        params.aspect_ratio !== 'smart') {
      requestData.aspect_ratio = params.aspect_ratio
    }

    if (hasImages) {
      requestData.image_urls = params.images
    }

    return { submitPath, modelId, requestData }
  }
}
```

**配置** (`config.ts`):
```typescript
modelEstimatedPolls: {
  'nano-banana': 10
}
```

**providers.json**:
```json
{
  "id": "nano-banana",
  "name": "Nano Banana",
  "type": "image",
  "progressConfig": {
    "type": "polling",
    "expectedPolls": 10
  }
}
```

## 检查清单

### Fal 特定步骤
- [ ] 创建模型路由文件 (`adapters/fal/models/`)
- [ ] 实现 `matches()` 和 `buildImageRequest()` / `buildVideoRequest()`
- [ ] 正确区分 `submitPath` 和 `modelId`
- [ ] 直接使用 `params.images`
- [ ] 注册路由 (`models/index.ts`)
- [ ] 配置预估轮询次数 (`config.ts`)
- [ ] 配置 `"type": "polling"` (`providers.json`)

### 通用步骤
- [ ] 创建参数 Schema
- [ ] 添加参数面板渲染
- [ ] 注册参数映射
- [ ] 添加状态管理
- [ ] 配置价格

## 核心要点

1. **直接使用 `params.images`** - FalAdapter 已自动上传
2. **区分 `submitPath` 和 `modelId`** - modelId 不含子路径
3. **使用 `"type": "polling"`** - 不要用 `"time"`
4. **不传递 `'smart'` 或 `'auto'`** - 在 optionsBuilder 中处理
5. **响应兼容层** - `responseData.data || responseData`
