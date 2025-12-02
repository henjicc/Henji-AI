# 适配指南：添加新供应商

## 核心流程

```
创建适配器目录 → 实现适配器类 → 注册到工厂 → 配置 providers.json → 添加 API Key 输入
```

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

## 3. 实现主适配器类

**`[Provider]Adapter.ts`**:
```typescript
import axios, { AxiosInstance } from 'axios'
import {
  BaseAdapter,
  GenerateImageParams,
  GenerateVideoParams,
  GenerateAudioParams,
  ImageResult,
  VideoResult,
  AudioResult
} from '../base/BaseAdapter'
import { YOUR_PROVIDER_CONFIG } from './config'
import { findRoute } from './models'
import { parseImageResponse, parseVideoResponse, parseAudioResponse } from './parsers'

export class YourProviderAdapter extends BaseAdapter {
  private apiClient: AxiosInstance

  constructor(apiKey: string) {
    super('YourProvider')  // 供应商名称
    this.apiClient = axios.create({
      baseURL: YOUR_PROVIDER_CONFIG.baseURL,
      headers: {
        'Authorization': `Bearer ${apiKey}`,  // 根据实际 API 调整
        'Content-Type': 'application/json'
      }
    })
  }

  async generateImage(params: GenerateImageParams): Promise<ImageResult> {
    try {
      // 1. 查找路由
      const route = findRoute(params.model)
      if (!route || !route.buildImageRequest) {
        throw new Error(`Unsupported image model: ${params.model}`)
      }

      // 2. 构建请求
      const { endpoint, requestData } = route.buildImageRequest(params)

      // 3. 发送请求
      const response = await this.apiClient.post(endpoint, requestData)

      // 4. 解析响应
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

  async generateAudio(params: GenerateAudioParams): Promise<AudioResult> {
    try {
      const route = findRoute(params.model)
      if (!route || !route.buildAudioRequest) {
        throw new Error(`Unsupported audio model: ${params.model}`)
      }

      const { endpoint, requestData } = route.buildAudioRequest(params)
      const response = await this.apiClient.post(endpoint, requestData)

      const audioResult = await parseAudioResponse(response.data)

      // 保存到本地
      try {
        const savedResult = await this.saveMediaLocally(audioResult.url, 'audio')
        return {
          url: savedResult.url,
          filePath: savedResult.filePath
        }
      } catch (e) {
        this.log('音频本地保存失败，回退为远程URL', e)
        return audioResult
      }
    } catch (error) {
      throw this.handleError(error)
    }
  }

  async checkStatus(taskId: string): Promise<any> {
    const response = await this.apiClient.get(`${YOUR_PROVIDER_CONFIG.statusEndpoint}/${taskId}`)
    return response.data
  }

  // 如果需要异步轮询，实现此方法
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

## 4. 实现模型路由

**`models/index.ts`**:
```typescript
import { model1Route } from './model-1'
import { model2Route } from './model-2'

export interface ModelRoute {
  matches: (modelId: string) => boolean
  buildImageRequest?: (params: any) => { endpoint: string; requestData: any }
  buildVideoRequest?: (params: any) => { endpoint: string; requestData: any }
  buildAudioRequest?: (params: any) => { endpoint: string; requestData: any }
}

export const yourProviderModelRoutes: ModelRoute[] = [
  model1Route,
  model2Route
]

export const findRoute = (modelId: string): ModelRoute | undefined => {
  return yourProviderModelRoutes.find(route => route.matches(modelId))
}
```

**`models/[model-id].ts`**:
```typescript
export const model1Route = {
  matches: (modelId: string) => modelId === 'model-1',

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
          image: images[0],  // 根据 API 要求处理（URL/Base64）
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

## 5. 实现响应解析器

**`parsers/videoParser.ts`**:
```typescript
import { VideoResult } from '@/adapters/base/BaseAdapter'
import type { YourProviderAdapter } from '../YourProviderAdapter'

export const parseVideoResponse = async (
  responseData: any,
  adapter: YourProviderAdapter
): Promise<VideoResult> => {
  // 根据实际 API 响应格式解析
  if (responseData.video_url) {
    const videoUrl = responseData.video_url

    // ⚠️ 关键：保存到本地并设置 filePath
    // 历史记录只保存 filePath，不保存 url，防止 base64 数据膨胀
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

// ⚠️ 注意：图片解析器通常不直接保存到本地
// 图片保存由 App.tsx 统一处理（检查 filePath 是否存在）
// 但如果你的 Adapter 需要在解析器中保存，参考视频解析器的实现

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

**`parsers/audioParser.ts`**:
```typescript
import { AudioResult } from '@/adapters/base/BaseAdapter'

// ⚠️ 注意：音频解析器只返回 URL
// 实际保存由 Adapter 的 generateAudio 方法处理

export const parseAudioResponse = (responseData: any): AudioResult => {
  if (responseData.audio_url) {
    return { url: responseData.audio_url }
  }

  throw new Error('No audio returned from API')
}
```

**`parsers/index.ts`**:
```typescript
export { parseImageResponse } from './imageParser'
export { parseVideoResponse } from './videoParser'
export { parseAudioResponse } from './audioParser'
```

## 6. 注册适配器到工厂

**`src/adapters/index.ts`**:
```typescript
import { YourProviderAdapter } from './your-provider/YourProviderAdapter'

export type AdapterType = 'piaoyun' | 'fal' | 'your-provider'  // 添加新类型

export class AdapterFactory {
  static createAdapter(config: AdapterConfig): MediaGeneratorAdapter {
    switch (config.type) {
      case 'piaoyun':
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

## 7. 配置 providers.json

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
          "id": "model-1",
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

## 8. 添加 API Key 输入

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

## 9. Tauri 权限配置（桌面应用）

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

## 关键注意事项

1. **参数过滤**: API 文档可能有误，实际测试时过滤不支持的参数值
2. **智能路由**: 在模型路由中根据 `params.images` 判断文生/图生
3. **本地保存**: 所有媒体必须调用 `saveMediaLocally` 保存到本地
4. **进度回调**: 异步任务支持 `onProgress` 回调，在 Adapter 内部轮询
5. **错误处理**: 使用 `this.handleError(error)` 统一处理错误
6. **日志记录**: 使用 `this.log()` 记录关键信息

## 检查清单

- [ ] 创建适配器目录和所有必要文件
- [ ] 实现主适配器类（继承 BaseAdapter）
- [ ] 实现至少一个模型路由
- [ ] 实现响应解析器（image/video/audio）
- [ ] 在 `adapters/index.ts` 注册适配器
- [ ] 在 `providers.json` 添加供应商和模型配置
- [ ] 在 `SettingsModal.tsx` 添加 API Key 输入
- [ ] 在 Tauri 配置中添加 CDN 域名
- [ ] 测试文生/图生功能
- [ ] 测试错误处理（无效 API Key）
