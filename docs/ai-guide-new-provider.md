# 适配指南：添加新供应商

---

## ⚠️ 统一参数命名规范（必读）

**所有新供应商的模型参数必须使用供应商前缀**：

```
{providerId}{ModelName}{ParameterName}
```

**前缀规则**：
- `ppio` = 派欧云 (PPIO)
- `fal` = Fal.ai
- `ms` = 魔搭 (ModelScope)
- 新供应商使用简短的英文缩写（2-4 个字母）

**示例**：
- `newProviderModel1VideoDuration`
- `newProviderModel1AspectRatio`

---

## 核心流程

```
创建适配器目录 → 实现适配器类 → 创建模型路由 → 添加 OptionsBuilder 配置 → 注册到工厂 → 配置 providers.json → 添加 API Key 输入
```

---

## 1. 创建适配器目录结构

```
src/adapters/[provider-id]/
├── [Provider]Adapter.ts    # 主适配器类（继承 BaseAdapter）
├── config.ts               # API 配置
├── models/
│   ├── index.ts           # 路由注册和 findRoute 函数
│   └── [model-id].ts      # 各模型路由
├── parsers/
│   ├── index.ts
│   ├── imageParser.ts     # 图片响应解析
│   ├── videoParser.ts     # 视频响应解析
│   └── audioParser.ts     # 音频响应解析
└── statusHandler.ts       # 异步任务轮询（如需要）
```

---

## 2. 实现配置文件

**`config.ts`**:
```typescript
export const YOUR_PROVIDER_CONFIG = {
  baseURL: 'https://api.example.com',
  statusEndpoint: '/task/status',  // 异步任务查询端点
  pollInterval: 3000,              // 轮询间隔（毫秒）
  maxPollAttempts: 120             // 最大轮询次数
} as const
```

---

## 3. 实现主适配器类

**`[Provider]Adapter.ts`**:
```typescript
import axios, { AxiosInstance } from 'axios'
import {
  BaseAdapter,
  GenerateImageParams,
  GenerateVideoParams,
  ImageResult,
  VideoResult
} from '../base/BaseAdapter'
import { YOUR_PROVIDER_CONFIG } from './config'
import { findRoute } from './models'
import { parseImageResponse, parseVideoResponse } from './parsers'

export class YourProviderAdapter extends BaseAdapter {
  private apiClient: AxiosInstance

  constructor(apiKey: string) {
    super('YourProvider')
    this.apiClient = axios.create({
      baseURL: YOUR_PROVIDER_CONFIG.baseURL,
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      }
    })
  }

  async generateImage(params: GenerateImageParams): Promise<ImageResult> {
    try {
      const route = findRoute(params.model)
      if (!route || !route.buildImageRequest) {
        throw new Error(`Unsupported image model: ${params.model}`)
      }

      const { endpoint, requestData } = route.buildImageRequest(params)
      const response = await this.apiClient.post(endpoint, requestData)

      return parseImageResponse(response.data)
    } catch (error) {
      throw this.handleError(error)
    }
  }

  async generateVideo(params: GenerateVideoParams): Promise<VideoResult> {
    try {
      const route = findRoute(params.model)
      if (!route || !route.buildVideoRequest) {
        throw new Error(`Unsupported video model: ${params.model}`)
      }

      const { endpoint, requestData } = route.buildVideoRequest(params)
      const response = await this.apiClient.post(endpoint, requestData)

      // 如果是异步任务
      if (response.data.task_id) {
        const taskId = response.data.task_id

        // 如果提供了进度回调，内部轮询
        if (params.onProgress) {
          return await this.pollTaskStatus(taskId, params.model, params.onProgress)
        }

        // 否则返回 taskId
        return {
          taskId: taskId,
          status: 'QUEUED'
        }
      }

      // 如果是同步返回
      return parseVideoResponse(response.data, this)
    } catch (error) {
      throw this.handleError(error)
    }
  }

  async checkStatus(taskId: string): Promise<any> {
    const response = await this.apiClient.get(`${YOUR_PROVIDER_CONFIG.statusEndpoint}/${taskId}`)
    return response.data
  }

  // 异步轮询实现
  async pollTaskStatus(taskId: string, modelId: string, onProgress?: any): Promise<VideoResult> {
    const { pollUntilComplete } = await import('@/utils/polling')
    const { getExpectedPolls } = await import('@/utils/modelConfig')

    const estimatedPolls = getExpectedPolls(modelId)

    const result = await pollUntilComplete<VideoResult>({
      checkFn: async () => {
        const status = await this.checkStatus(taskId)
        return {
          status: status.status,
          result: status.result as VideoResult | undefined
        }
      },
      isComplete: (status) => status === 'COMPLETED' || status === 'SUCCESS',
      isFailed: (status) => status === 'FAILED',
      onProgress: (progress, status) => {
        if (onProgress) {
          onProgress({
            status: status as any,
            progress,
            message: this.getStatusMessage(status)
          })
        }
      },
      interval: YOUR_PROVIDER_CONFIG.pollInterval,
      maxAttempts: YOUR_PROVIDER_CONFIG.maxPollAttempts,
      estimatedAttempts: estimatedPolls
    })

    return result
  }

  private getStatusMessage(status: string): string {
    const messages: Record<string, string> = {
      'QUEUED': '排队中...',
      'PROCESSING': '生成中...',
      'COMPLETED': '完成',
      'FAILED': '失败'
    }
    return messages[status] || '处理中...'
  }
}
```

---

## 4. 实现模型路由

### 供应商前缀命名要求

所有模型路由文件和变量必须使用供应商前缀：

- **路由文件名**: 使用 `[provider]-[model-id].ts` 格式
- **变量名**: 使用 `[provider][Model]Route` 格式
- **模型 ID**: 使用 `[provider]-[model-id]` 格式

**`models/index.ts`**:
```typescript
import { model1Route } from './your-provider-model-1'

export interface ModelRoute {
  matches: (modelId: string) => boolean
  buildImageRequest?: (params: any) => { endpoint: string; requestData: any }
  buildVideoRequest?: (params: any) => { endpoint: string; requestData: any }
}

export const yourProviderModelRoutes: ModelRoute[] = [
  model1Route
]

export const findRoute = (modelId: string): ModelRoute | undefined => {
  return yourProviderModelRoutes.find(route => route.matches(modelId))
}
```

**`models/your-provider-model-1.ts`**:
```typescript
export const model1Route = {
  matches: (modelId: string) => modelId === 'your-provider-model-1',

  buildVideoRequest: (params: any) => {
    const images = params.images || []
    const prompt = params.prompt || ''
    const duration = params.duration || 5

    // 智能路由：根据图片数量选择端点
    if (images.length > 0) {
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
      // 文生视频
      return {
        endpoint: '/v1/text-to-video',
        requestData: {
          prompt,
          duration,
          aspect_ratio: params.aspectRatio || '16:9'
        }
      }
    }
  }
}
```

---

## 5. 实现响应解析器

**`parsers/videoParser.ts`**:
```typescript
import { VideoResult } from '@/adapters/base/BaseAdapter'
import type { YourProviderAdapter } from '../YourProviderAdapter'

export const parseVideoResponse = async (
  responseData: any,
  adapter: YourProviderAdapter
): Promise<VideoResult> => {
  if (responseData.video_url) {
    const videoUrl = responseData.video_url

    // ⚠️ 关键：保存到本地并设置 filePath
    try {
      const savedResult = await adapter['saveMediaLocally'](videoUrl, 'video')
      return {
        url: savedResult.url,
        filePath: savedResult.filePath,  // ⚠️ 必须设置，用于历史记录
        status: 'COMPLETED'
      }
    } catch (e) {
      adapter['log']('视频本地保存失败，回退为远程URL', e)
      return {
        url: videoUrl,
        status: 'COMPLETED'
      }
    }
  }

  throw new Error('No video returned from API')
}
```

**`parsers/imageParser.ts`**:
```typescript
import { ImageResult } from '@/adapters/base/BaseAdapter'

export const parseImageResponse = (responseData: any): ImageResult => {
  // 单图
  if (responseData.image_url) {
    return {
      url: responseData.image_url,
      status: 'COMPLETED'
    }
  }

  // 多图
  if (responseData.images && Array.isArray(responseData.images)) {
    const urls = responseData.images.map((img: any) => img.url)
    return {
      url: urls.join('|||'),  // ⚠️ 多图用 ||| 分隔
      status: 'COMPLETED'
    }
  }

  throw new Error('No image returned from API')
}
```

---

## 6. 添加参数 Schema 和 OptionsBuilder 配置

### 6.1 定义参数 Schema

**位置**: `src/models/your-provider-model-1.ts`

```typescript
import { ParamDef } from '../types/schema'

export const yourProviderModel1Params: ParamDef[] = [
  // ⚠️ 参数 ID 必须使用供应商前缀
  {
    id: 'yourProviderModel1VideoDuration',  // 使用前缀！
    type: 'dropdown',
    label: '时长',
    defaultValue: 5,
    options: [
      { value: 5, label: '5s' },
      { value: 10, label: '10s' }
    ]
  },
  {
    id: 'yourProviderModel1AspectRatio',  // 使用前缀！
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
    options: [
      { value: '16:9', label: '16:9' },
      { value: '9:16', label: '9:16' },
      { value: '1:1', label: '1:1' }
    ]
  }
]
```

### 6.2 添加 OptionsBuilder 配置

**位置**: `src/components/MediaGenerator/builders/configs/your-provider-models.ts`

```typescript
import { ModelConfig } from '../core/types'

export const yourProviderModel1Config: ModelConfig = {
  id: 'your-provider-model-1',
  type: 'video',
  provider: 'custom',  // 或创建新的 provider 类型

  // 参数映射（API 参数名 → UI 状态参数名）
  paramMapping: {
    duration: {
      source: ['yourProviderModel1VideoDuration', 'videoDuration'],
      defaultValue: 5
    },
    aspect_ratio: {
      source: 'yourProviderModel1AspectRatio',
      defaultValue: '16:9'
    }
  },

  // 特性配置
  features: {
    smartMatch: {
      enabled: true,
      paramKey: 'aspect_ratio',
      defaultRatio: '16:9'
    },
    imageUpload: {
      enabled: true,
      maxImages: 1,
      mode: 'single',
      paramKey: 'image_url',
      convertToBlob: false  // 根据实际需求设置
    }
  }
}
```

**注册配置**: 在 `src/components/MediaGenerator/builders/configs/index.ts` 中：

```typescript
import { yourProviderModel1Config } from './your-provider-models'

export function registerAllConfigs() {
  // ... 现有注册
  optionsBuilder.registerConfig(yourProviderModel1Config)
}
```

### 6.3 添加状态管理和参数映射

参考 [ai-guide-new-model.md](./ai-guide-new-model.md) 的步骤 2-4，使用供应商前缀的参数名。

---

## 7. 注册适配器到工厂

**`src/adapters/index.ts`**:
```typescript
import { YourProviderAdapter } from './your-provider/YourProviderAdapter'

export type AdapterType = 'ppio' | 'fal' | 'your-provider'  // 添加新类型

export class AdapterFactory {
  static createAdapter(config: AdapterConfig): MediaGeneratorAdapter {
    switch (config.type) {
      case 'ppio':
        return new PPIOAdapter(config.apiKey)
      case 'fal':
        return new FalAdapter(config.apiKey)
      case 'your-provider':  // 添加新 case
        return new YourProviderAdapter(config.apiKey)
      default:
        throw new Error(`Unsupported adapter type: ${config.type}`)
    }
  }
}
```

---

## 8. 配置 providers.json

**`src/config/providers.json`**:
```json
{
  "providers": [
    {
      "id": "your-provider",
      "name": "Your Provider",
      "type": "multi",
      "models": [
        {
          "id": "your-provider-model-1",
          "name": "Model 1",
          "type": "video",
          "description": "模型描述",
          "functions": ["文生视频", "图生视频"],
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

---

## 9. 添加 API Key 输入

**`src/components/SettingsModal.tsx`**:

搜索现有的 API Key 输入框，仿照添加：

```typescript
<div className="space-y-2">
  <label className="text-sm font-medium">Your Provider API Key</label>
  <input
    type="password"
    value={yourProviderApiKey}
    onChange={(e) => setYourProviderApiKey(e.target.value)}
    className="w-full px-3 py-2 border rounded-lg"
  />
</div>
```

保存逻辑：
```typescript
localStorage.setItem('your-provider_api_key', yourProviderApiKey)
```

---

## 10. 配置价格

**位置**: `src/config/pricing.ts`

```typescript
{
  providerId: 'your-provider',
  modelId: 'your-provider-model-1',
  currency: '¥',
  type: 'calculated',
  calculator: (params) => {
    // ⚠️ 使用供应商前缀的参数名，并提供回退
    const duration = params.yourProviderModel1VideoDuration
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

---

## 11. Tauri 权限配置（桌面应用）

**`src-tauri/capabilities/default.json`**:

在三个 HTTP 权限块中添加 CDN 域名：
```json
{
  "identifier": "http-client",
  "allow": [
    { "url": "https://your-cdn.com/*" }
  ]
}
```

**重要**: 必须重启应用才能生效。

---

## 检查清单

### 核心步骤（必须完成）
- [ ] 创建适配器目录和所有必要文件
- [ ] 实现主适配器类（继承 BaseAdapter）
- [ ] 实现至少一个模型路由
- [ ] 实现响应解析器（image/video/audio）
- [ ] 定义参数 Schema（使用供应商前缀）
- [ ] 添加 OptionsBuilder 配置
- [ ] 在 `configs/index.ts` 注册配置
- [ ] 添加状态管理和参数映射（使用供应商前缀）
- [ ] 在 `adapters/index.ts` 注册适配器
- [ ] 在 `providers.json` 添加供应商和模型配置
- [ ] 在 `SettingsModal.tsx` 添加 API Key 输入
- [ ] 在 `pricing.ts` 添加价格配置（使用供应商前缀参数）
- [ ] 在 Tauri 配置中添加 CDN 域名

### 测试步骤
- [ ] 测试文生/图生功能
- [ ] 测试参数修改和预设保存/加载
- [ ] 测试价格估算
- [ ] 测试错误处理（无效 API Key）
- [ ] 测试历史记录重新编辑

---

## 关键注意事项

### 1. 参数命名规范

**所有参数必须使用供应商前缀**，避免与其他供应商冲突：

```typescript
// ❌ 错误：使用通用参数名
{
  id: 'videoDuration',  // 会与其他供应商冲突
  type: 'dropdown',
  // ...
}

// ✅ 正确：使用供应商前缀
{
  id: 'yourProviderModel1VideoDuration',
  type: 'dropdown',
  // ...
}
```

### 2. OptionsBuilder 配置

使用配置驱动架构，优先使用模型特定参数，提供回退：

```typescript
paramMapping: {
  duration: {
    source: ['yourProviderModel1VideoDuration', 'videoDuration'],
    defaultValue: 5
  }
}
```

### 3. 本地保存

所有媒体必须调用 `saveMediaLocally` 保存到本地，并设置 `filePath`：

```typescript
const savedResult = await adapter['saveMediaLocally'](videoUrl, 'video')
return {
  url: savedResult.url,
  filePath: savedResult.filePath,  // ⚠️ 必须设置
  status: 'COMPLETED'
}
```

### 4. 智能路由

在模型路由中根据 `params.images` 判断文生/图生：

```typescript
if (images.length > 0) {
  // 图生视频
  return {
    endpoint: '/v1/image-to-video',
    requestData: { image: images[0], prompt, duration }
  }
} else {
  // 文生视频
  return {
    endpoint: '/v1/text-to-video',
    requestData: { prompt, duration, aspect_ratio: params.aspectRatio }
  }
}
```

### 5. 进度回调

异步任务支持 `onProgress` 回调，在 Adapter 内部轮询：

```typescript
if (params.onProgress) {
  return await this.pollTaskStatus(taskId, params.model, params.onProgress)
}
```

### 6. 错误处理

使用 `this.handleError(error)` 统一处理错误：

```typescript
try {
  // ...
} catch (error) {
  throw this.handleError(error)
}
```

---

## 常见错误

### ⚠️ 参数命名冲突

```typescript
// ❌ 错误：不同供应商使用相同参数名
// Provider A
{ id: 'videoDuration', ... }

// Provider B
{ id: 'videoDuration', ... }  // 冲突！

// ✅ 正确：使用供应商前缀
// Provider A
{ id: 'providerAModel1VideoDuration', ... }

// Provider B
{ id: 'providerBModel1VideoDuration', ... }
```

### ⚠️ 忘记设置 filePath

```typescript
// ❌ 错误：没有 filePath，历史记录无法恢复
return {
  url: videoUrl,
  status: 'COMPLETED'
}

// ✅ 正确：设置 filePath
const savedResult = await adapter['saveMediaLocally'](videoUrl, 'video')
return {
  url: savedResult.url,
  filePath: savedResult.filePath,
  status: 'COMPLETED'
}
```

### ⚠️ OptionsBuilder 配置缺失

```typescript
// ❌ 错误：没有注册配置
// 导致 buildGenerateOptions 报错找不到配置

// ✅ 正确：在 configs/index.ts 中注册
export function registerAllConfigs() {
  optionsBuilder.registerConfig(yourProviderModel1Config)
}
```

---

## 核心要点总结

1. **参数命名**: 所有参数使用供应商前缀，避免冲突
2. **OptionsBuilder**: 使用配置驱动架构，优先使用模型特定参数
3. **本地保存**: 所有媒体必须调用 `saveMediaLocally` 并设置 `filePath`
4. **智能路由**: 在模型路由中根据输入类型选择端点
5. **进度回调**: 异步任务支持 `onProgress` 回调
6. **错误处理**: 使用 `this.handleError(error)` 统一处理
7. **类型安全**: 完整的 TypeScript 类型定义
8. **向后兼容**: 参数映射提供回退机制
