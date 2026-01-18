# PPIO (派欧云) 适配器专用指南

---

## 统一参数命名规范

**所有 PPIO 模型参数必须使用 `ppio` 前缀**：

```
ppio{ModelName}{ParameterName}
```

**示例**：
- `ppioKling25VideoDuration` - PPIO 可灵 2.5 视频时长
- `ppioViduQ1Mode` - PPIO Vidu Q1 模式
- `ppioHailuo23VideoResolution` - PPIO 海螺 2.3 分辨率

**原因**：
- 避免与其他供应商的相同模型参数冲突（如 Fal 的 Kling 2.5）
- 确保预设功能正确保存和恢复参数
- 确保价格计算使用正确的参数值

---

## 核心特性与架构

### PPIO 适配器的特点

| 特性 | PPIO | Fal |
|------|------|-----|
| **图片上传** | 使用 base64 编码 | 自动上传到 fal CDN |
| **轮询方式** | 手动轮询 | SDK 自动轮询 |
| **本地保存** | 视频保存本地，音频仅返回 URL | App.tsx 统一处理 |
| **状态查询** | 统一端点 `/async/task-result` | SDK 自动处理 |

### 关键设计原则

1. **Base64 编码**: 图片由 UI 层处理，模型路由直接使用 `params.images`
2. **手动轮询**: 使用 `PPIOStatusHandler` 类处理任务状态轮询
3. **本地保存**: 视频调用 `saveMediaLocally`，音频仅返回 URL
4. **模型路由**: 每个模型有独立的路由文件，定义如何构建 API 请求

---

## 完整适配流程

### 总览：8 个必须步骤

1. 定义参数 Schema (使用 ppio 前缀)
2. 添加参数面板渲染
3. 添加状态管理 (使用 ppio 前缀)
4. 注册参数映射
5. 添加 OptionsBuilder 配置
6. 创建模型路由 (adapters/ppio/models/)
7. 配置轮询次数 (providers.json)
8. 配置价格 (pricing.ts)

---

## 步骤 1: 定义参数 Schema

**位置**: `src/models/ppio/[model-id].ts`

```typescript
import { ParamDef } from '../../types/schema'

export const ppioYourModelParams: ParamDef[] = [
  {
    id: 'ppioYourModelVideoDuration',  // 使用 ppio 前缀！
    type: 'dropdown',
    label: '时长',
    defaultValue: 5,
    options: [
      { value: 5, label: '5s' },
      { value: 10, label: '10s' }
    ]
  },
  {
    id: 'ppioYourModelAspectRatio',
    type: 'dropdown',
    defaultValue: '16:9',
    resolutionConfig: {
      type: 'aspect_ratio',
      visualize: true,
      extractRatio: (value) => {
        const [w, h] = value.split(':').map(Number)
        return w / h
      }
    },
    options: [
      { value: '16:9', label: '16:9' },
      { value: '9:16', label: '9:16' },
      { value: '1:1', label: '1:1' }
    ]
  }
]
```

**注册 Schema**: 在 `src/models/index.ts` 中：

```typescript
export { ppioYourModelParams } from './ppio/your-model'

export const modelSchemaMap: Record<string, ParamDef[]> = {
  'your-model': ppioYourModelParams
}
```

---

## 步骤 2-4: 参数面板、状态管理、参数映射

参考 [ai-guide-new-model.md](./ai-guide-new-model.md) 的步骤 2-4，使用 `ppio` 前缀的参数名。

---

## 步骤 5: 添加 OptionsBuilder 配置

**位置**: `src/components/MediaGenerator/builders/configs/ppio-models.ts`

```typescript
import { ModelConfig } from '../core/types'

export const ppioYourVideoModelConfig: ModelConfig = {
  id: 'your-video-model',
  type: 'video',
  provider: 'ppio',

  paramMapping: {
    duration: {
      source: ['ppioYourModelVideoDuration', 'videoDuration'],
      defaultValue: 5
    },
    aspectRatio: {
      source: 'ppioYourModelAspectRatio',
      defaultValue: '16:9'
    }
  },

  features: {
    imageUpload: {
      enabled: true,
      maxImages: 1,
      mode: 'single',
      paramKey: 'images',
      convertToBlob: false  // PPIO 使用 base64
    }
  },

  customHandlers: {
    afterBuild: async (options, context) => {
      if (context.uploadedImages.length > 0) {
        const { dataUrlToBlob, saveUploadImage } = await import('@/utils/save')
        const setUploadedFilePaths = (context.params as any).setUploadedFilePaths
        const uploadedFilePaths = (context.params as any).uploadedFilePaths || []

        options.images = [context.uploadedImages[0]]

        // 保存图片到本地（用于历史记录）
        if (!uploadedFilePaths[0]) {
          const blob = await dataUrlToBlob(context.uploadedImages[0])
          const saved = await saveUploadImage(blob, 'persist')
          setUploadedFilePaths([saved.fullPath])
          options.uploadedFilePaths = [saved.fullPath]
        } else {
          options.uploadedFilePaths = [uploadedFilePaths[0]]
        }
      }
    }
  }
}
```

**注册配置**: 在 `src/components/MediaGenerator/builders/configs/index.ts` 中：

```typescript
import { ppioYourVideoModelConfig } from './ppio-models'

export function registerAllConfigs() {
  optionsBuilder.registerConfig(ppioYourVideoModelConfig)
}
```

---

## 步骤 6: 创建模型路由

**位置**: `src/adapters/ppio/models/[model-id].ts`

### 端点路径规则

| 任务类型 | 端点前缀 | 示例 |
|---------|---------|------|
| **异步任务** | `/async/` | `/async/vidu-q1-img2video` |
| **同步任务** | 无前缀 | `/minimax-speech-2.6-hd` |

### 视频模型路由模板

```typescript
import { GenerateVideoParams } from '@/adapters/base/BaseAdapter'

export const yourVideoModelRoute = {
  matches: (modelId: string) => modelId === 'your-video-model',

  buildVideoRequest: (params: GenerateVideoParams) => {
    const images = params.images || []
    const prompt = (params.prompt || '').slice(0, 2500)

    if (!prompt.trim()) {
      throw new Error('视频生成需要提供非空的 prompt')
    }

    let endpoint: string
    let requestData: any

    if (images.length > 0) {
      endpoint = '/async/your-model-i2v'
      requestData = {
        images: [images[0]],
        prompt,
        duration: String(params.duration || 5)
      }
    } else {
      endpoint = '/async/your-model-t2v'
      requestData = {
        prompt,
        duration: String(params.duration || 5),
        aspect_ratio: params.aspectRatio || '16:9'
      }
    }

    return { endpoint, requestData }
  }
}
```

### 异步路由（支持 Promise）

当路由需要执行异步操作（如上传视频到 Fal CDN）时：

```typescript
export const klingO1Route = {
  matches: (modelId: string) => modelId === 'kling-o1',

  buildVideoRequest: async (params: GenerateVideoParams): Promise<{ endpoint: string; requestData: any }> => {
    const video = params.video

    if (video) {
      const videoUrl = await uploadVideoToFal(video)
      return {
        endpoint: '/async/kling-o1-ref2v',
        requestData: { prompt: params.prompt, video: videoUrl }
      }
    }

    return {
      endpoint: '/async/kling-o1-t2v',
      requestData: { prompt: params.prompt }
    }
  }
}
```

**注册路由**: 在 `src/adapters/ppio/models/index.ts` 中：

```typescript
import { yourVideoModelRoute } from './your-video-model'

export const ppioModelRoutes: ModelRoute[] = [
  yourVideoModelRoute
]
```

---

## 步骤 7: 配置预估轮询次数

**位置**: `src/config/providers.json`

```json
{
  "id": "your-model",
  "name": "Your Model Name",
  "type": "video",
  "progressConfig": {
    "type": "polling",
    "expectedPolls": 40
  }
}
```

| 模型速度 | 平均完成时间 | 推荐 expectedPolls |
|----------|--------------|-------------------|
| 超快 | <30秒 | 10-15 |
| 快速 | 30-60秒 | 15-25 |
| 中速 | 1-2分钟 | 25-40 |
| 慢速 | 2-5分钟 | 40-100 |

---

## 步骤 8: 配置价格

**位置**: `src/config/pricing.ts`

```typescript
const PRICES = {
  YOUR_PPIO_MODEL: 0.5,  // 人民币
}

{
  providerId: 'ppio',
  modelId: 'your-model',
  currency: '¥',
  type: 'calculated',
  calculator: (params) => {
    const duration = params.ppioYourModelVideoDuration || params.videoDuration || 5
    return duration === 10 ? PRICES.YOUR_PPIO_MODEL * 2 : PRICES.YOUR_PPIO_MODEL
  }
}
```

---

## 关键概念详解

### 1. autoSwitch 模式切换

#### 单规则形式

```typescript
{
  id: 'ppioViduQ1Mode',
  autoSwitch: {
    watchKeys: ['uploadedImages'],
    condition: (values) => {
      // 【关键】只在特定模式下才触发，避免干扰用户手动选择
      return values.ppioViduQ1Mode === 'text-image-to-video' &&
             (values.uploadedImages?.length || 0) === 2
    },
    value: 'start-end-frame'
  }
}
```

#### 数组形式（多规则）

```typescript
{
  id: 'ppioKlingO1AspectRatio',
  autoSwitch: [
    {
      condition: (values) => /* 规则1 */,
      value: 'smart',
      watchKeys: ['uploadedImages']
    },
    {
      condition: (values) => /* 规则2 */,
      value: '16:9',
      watchKeys: ['ppioKlingO1Mode']
    }
  ]
}
```

### 2. 视频上传（借用 Fal CDN）

PPIO 没有自己的视频上传服务，可借用 Fal CDN：

```typescript
async function uploadVideoToFal(video: File | string): Promise<string> {
  if (typeof video === 'string') return video

  const base64 = await fileToBase64(video)
  const falApiKey = localStorage.getItem('fal_api_key')
  if (!falApiKey) throw new Error('未配置 Fal API Key')

  const { uploadToFalCDN } = await import('@/utils/falUpload')
  return await uploadToFalCDN(base64, falApiKey)
}
```

### 3. 状态映射

注意成功状态有两种拼写：

```typescript
isComplete: (status) =>
  status === 'TASK_STATUS_SUCCEED' ||
  status === 'TASK_STATUS_SUCCEEDED'
```

---

## 常见错误

| 错误类型 | 错误示例 | 正确做法 |
|----------|----------|----------|
| 参数命名错误 | `videoDuration` | `ppioYourModelVideoDuration` |
| 端点路径错误 | `/your-model-t2v` | `/async/your-model-t2v` |
| 配置注册冲突 | 同一 ID 被多次注册 | 检查 `configs/index.ts` 无重复 |
| 参数未传递 | `buildGenerateOptions` 缺少参数 | 添加所有模型参数到调用中 |
| Schema 映射重复 | `modelSchemaMap` 中 ID 重复 | 确保每个 ID 只出现一次 |
| autoSwitch 干扰 | 覆盖用户手动选择 | 在 condition 中检查当前模式 |
| TypeScript 类型缺失 | 新参数未添加类型 | 同步更新 `BuildOptionsParams`、`PresetSetters` |

---

## 检查清单

### 基础步骤
- [ ] 在 `src/models/ppio/` 创建参数 Schema（使用 ppio 前缀）
- [ ] 在 `useMediaGeneratorState.ts` 添加状态
- [ ] 在 `presetStateMapping.ts` 注册参数映射
- [ ] 在 `configs/ppio-models.ts` 添加 OptionsBuilder 配置
- [ ] 在 `configs/index.ts` 注册配置
- [ ] 在 `adapters/ppio/models/` 创建模型路由
- [ ] 在 `providers.json` 添加模型配置（`type: "polling"`）
- [ ] 在 `pricing.ts` 添加价格配置

### TypeScript 类型定义
- [ ] `BuildOptionsParams` 添加新参数类型
- [ ] `PresetSetters` 添加 setter 类型
- [ ] `index.tsx` 的 `setterMap` 添加 setter 映射
- [ ] `index.tsx` 的 `buildGenerateOptions` 添加参数传递

### 配置检查
- [ ] `configs/index.ts` 无 ID 冲突
- [ ] `models/index.ts` 的 `modelSchemaMap` 无重复定义

---

## 常见问题

### 1. autoSwitch 干扰手动模式选择

在 `condition` 中检查当前模式：

```typescript
condition: (values) => {
  // 只有在文/图生视频模式下才触发
  return values.ppioYourModelMode === 'text-image-to-video' && count === 2
}
```

### 2. 配置注册冲突

检查 `configs/index.ts`：

```typescript
// ❌ 错误：覆盖了 PPIO 配置
optionsBuilder.registerConfig(ppioKlingO1Config)
optionsBuilder.registerConfig({ ...falConfig, id: 'kling-o1' })
```

### 3. 参数未传递到 API

检查 `index.tsx` 的 `buildGenerateOptions` 调用：

```typescript
const options = await buildGenerateOptions({
  ppioYourModelMode: state.ppioYourModelMode,
  ppioYourModelDuration: state.ppioYourModelDuration,
})
```

### 4. TypeScript 类型错误

需要同步更新三个位置：
1. `BuildOptionsParams` - 参数类型
2. `PresetSetters` - setter 类型
3. `setterMap` - setter 映射

---

## 核心要点总结

1. **参数命名**: 所有参数使用 `ppio` 前缀
2. **Base64 编码**: 图片由 UI 层处理，路由直接使用
3. **本地保存**: 视频保存本地，音频仅返回 URL
4. **状态映射**: 同时检查 `TASK_STATUS_SUCCEED` 和 `TASK_STATUS_SUCCEEDED`
5. **端点路径**: 异步任务需要 `/async` 前缀
6. **autoSwitch**: 必须检查当前模式，避免干扰手动选择

---

## 快速参考表

### paramMapping 形式

| 形式 | 示例 | 使用场景 |
|------|------|---------|
| 字符串 | `duration: 'ppioModelDuration'` | 简单映射 |
| 数组 | `source: ['ppioParam', 'genericParam']` | 带回退 |
| 对象 | `{ source: 'param', defaultValue: 5 }` | 带默认值 |

### 与 Fal 适配器对比

| 特性 | PPIO | Fal |
|------|------|-----|
| 图片上传 | base64 编码 | 自动上传到 CDN |
| 轮询方式 | 手动轮询 | SDK 自动轮询 |
| 本地保存 | Adapter 内部处理 | App.tsx 统一处理 |
| 状态查询 | `/async/task-result` | SDK 自动处理 |

---

## 参考资料

- https://docs.ppinfra.com/
- [ai-guide-new-model.md](./ai-guide-new-model.md)
- [ai-guide-fal.md](./ai-guide-fal.md)
