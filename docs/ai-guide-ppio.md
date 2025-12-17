# PPIO (派欧云) 适配器专用指南

---

## 统一参数命名规范

**所有 PPIO 模型参数必须使用 `ppio` 前缀**（包括视频、图片、音频模型）：

```
ppio{ModelName}{ParameterName}
```

**示例**：
- `ppioKling25VideoDuration` - PPIO 可灵 2.5 视频时长
- `ppioViduQ1Mode` - PPIO Vidu Q1 模式
- `ppioHailuo23VideoResolution` - PPIO 海螺 2.3 分辨率
- `ppioMinimaxAudioSpec` - PPIO MiniMax 音频规格
- `ppioMinimaxVoiceId` - PPIO MiniMax 语音 ID
- `ppioMinimaxAudioSpeed` - PPIO MiniMax 语音速度

**原因**：
- 避免与其他供应商的相同模型参数冲突（如 Fal 的 Kling 2.5）
- 确保预设功能正确保存和恢复参数
- 确保价格计算使用正确的参数值
- 统一命名规范，便于维护和理解

---

## 核心特性与架构

### PPIO 适配器的特点

| 特性 | PPIO | Fal | KIE |
|------|------|-----|-----|
| **图片上传** | 使用 base64 编码 | 自动上传到 fal CDN | 上传到 KIE CDN |
| **轮询方式** | 手动轮询 | SDK 自动轮询 | 手动轮询 |
| **进度计算** | 基于轮询次数 | 基于轮询次数 | 基于轮询次数 |
| **本地保存** | 视频保存本地，音频仅返回 URL | App.tsx 统一处理 | Adapter 内部处理 |
| **API 结构** | 模型特定端点 | 模型特定端点 | 统一端点 |
| **状态查询** | 统一端点 `/async/task-result` | SDK 自动处理 | 统一端点 `/api/v1/jobs/recordInfo` |

### 关键设计原则

1. **Base64 编码**: 图片使用 base64 编码直接传递给 API（由 UI 层处理，路由直接使用）
2. **手动轮询**: 使用 `PPIOStatusHandler` 类处理任务状态轮询
3. **统一状态端点**: 所有模型使用 `/async/task-result` 查询任务状态
4. **本地保存**:
   - **视频**：调用 `saveMediaLocally` 并设置 `filePath`
   - **音频**：仅返回 URL，不保存本地（音频文件通常较小，按需下载）
5. **模型路由**: 每个模型有独立的路由文件，定义如何构建 API 请求

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

**位置**: `src/models/[model-id].ts`

```typescript
import { ParamDef } from '../types/schema'

export const ppioYourModelParams: ParamDef[] = [
  // ⚠️ 参数 ID 必须使用 ppio 前缀
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

  // 宽高比参数（带可视化）
  {
    id: 'ppioYourModelAspectRatio',  // 使用 ppio 前缀！
    type: 'dropdown',
    defaultValue: '16:9',
    resolutionConfig: {
      type: 'aspect_ratio',
      smartMatch: false,  // PPIO 模型通常不支持智能匹配
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
    ],
    // 图生视频时隐藏比例参数（如果 API 不支持）
    hidden: (values) => values.uploadedImages && values.uploadedImages.length > 0
  }
]
```

**注册 Schema**: 在 `src/models/index.ts` 中：

```typescript
export { ppioYourModelParams } from './your-model'

export const modelSchemaMap: Record<string, ParamDef[]> = {
  'your-model': ppioYourModelParams
}
```

---

## 步骤 2-4: 参数面板、状态管理、参数映射

参考 `./ai-guide-new-model.md` 的步骤 2-4，使用 ppio 前缀的参数名。

---

## 步骤 5: 添加 OptionsBuilder 配置

**位置**: `src/components/MediaGenerator/builders/configs/ppio-models.ts`

### 视频模型配置示例

```typescript
import { ModelConfig } from '../core/types'

/**
 * PPIO 视频模型配置
 */
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
    },
    negativePrompt: 'videoNegativePrompt'
  },

  features: {
    imageUpload: {
      enabled: true,
      maxImages: 1,
      mode: 'single',
      paramKey: 'images',
      convertToBlob: false  // PPIO 使用 base64，不转换为 Blob
    }
  },

  customHandlers: {
    afterBuild: async (options, context) => {
      // PPIO 特殊的图片处理逻辑
      if (context.uploadedImages.length > 0) {
        const { dataUrlToBlob, saveUploadImage } = await import('@/utils/save')
        const setUploadedFilePaths = (context.params as any).setUploadedFilePaths

        const uploadedFilePaths = (context.params as any).uploadedFilePaths || []
        const image = context.uploadedImages[0]
        options.images = [image]  // 直接使用 base64

        // 保存图片到本地（用于历史记录）
        if (uploadedFilePaths[0]) {
          options.uploadedFilePaths = [uploadedFilePaths[0]]
        } else {
          const blob = await dataUrlToBlob(image)
          const saved = await saveUploadImage(blob, 'persist')
          options.uploadedFilePaths = [saved.fullPath]
          setUploadedFilePaths([saved.fullPath])
        }
      }
    }
  }
}
```

### 图片模型配置示例

```typescript
/**
 * PPIO 图片模型配置
 */
export const ppioYourImageModelConfig: ModelConfig = {
  id: 'your-image-model',
  type: 'image',
  provider: 'ppio',

  paramMapping: {
    resolutionQuality: 'resolutionQuality',
    customWidth: 'customWidth',
    customHeight: 'customHeight',
    maxImages: 'maxImages'
  },

  customHandlers: {
    afterBuild: async (options, context) => {
      const params = context.params

      // 处理图片上传（PPIO 图片模型需要转换为 blob 并保存）
      if (context.uploadedImages.length > 0) {
        const { dataUrlToBlob, saveUploadImage } = await import('@/utils/save')
        const setUploadedFilePaths = params.setUploadedFilePaths
        const uploadedFilePaths = params.uploadedFilePaths || []

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

      // 处理分辨率计算
      const selectedResolution = params.selectedResolution
      const quality = params.resolutionQuality === '2K' ? '2K' : '4K'

      if (selectedResolution === 'smart') {
        // 智能匹配模式
        if (context.uploadedImages.length > 0) {
          const { calculateSmartResolution } = await import('../../utils/resolutionUtils')
          try {
            const smartSize = await calculateSmartResolution(context.uploadedImages[0], quality)
            options.size = smartSize
          } catch (error) {
            // 失败时使用默认比例
            const { getActualResolution } = await import('../../utils/resolutionUtils')
            options.size = getActualResolution('1:1', quality)
          }
        } else {
          // 没有图片时，智能模式默认使用 1:1
          const { getActualResolution } = await import('../../utils/resolutionUtils')
          options.size = getActualResolution('1:1', quality)
        }
      } else if (selectedResolution) {
        // 具体比例模式（如 '1:1', '16:9' 等）
        const { getActualResolution } = await import('../../utils/resolutionUtils')
        options.size = getActualResolution(selectedResolution, quality)
      }
    }
  }
}
```

### 音频模型配置示例

```typescript
/**
 * PPIO MiniMax 音频模型配置
 */
export const ppioMinimaxAudioModelConfig: ModelConfig = {
  id: 'minimax-speech-2.6',
  type: 'audio',
  provider: 'ppio',

  paramMapping: {
    spec: 'ppioMinimaxAudioSpec',
    voiceId: 'ppioMinimaxVoiceId',
    emotion: 'ppioMinimaxAudioEmotion',
    speed: 'ppioMinimaxAudioSpeed',
    volume: 'ppioMinimaxAudioVol'
  },

  features: {
    // 音频模型通常不需要图片上传
  }
}
```

**注册配置**: 在 `src/components/MediaGenerator/builders/configs/index.ts` 中：

```typescript
import { ppioYourVideoModelConfig } from './ppio-models'

export function registerAllConfigs() {
  // ... 现有注册
  optionsBuilder.registerConfig(ppioYourVideoModelConfig)
}
```

---

## 步骤 6: 创建模型路由

**位置**: `src/adapters/ppio/models/[model-id].ts`

**⚠️ 重要：端点路径规则**

PPIO API 端点分为同步和异步两种类型：

| 任务类型 | 端点前缀 | 示例 | 说明 |
|---------|---------|------|------|
| **异步任务** | `/async/` | `/async/vidu-q1-img2video` | 视频生成（需要轮询） |
| **同步任务** | 无前缀 | `/minimax-speech-2.6-hd` | 音频生成、图片生成 |

**端点命名规则**：
- 文生视频：`/async/{model-name}-t2v`
- 图生视频：`/async/{model-name}-i2v`
- 文生图：`/{model-name}` （同步任务）
- 音频生成：`/{model-name}` （同步任务）

### 视频模型路由模板

```typescript
import { GenerateVideoParams } from '@/adapters/base/BaseAdapter'

/**
 * Your Video Model 模型路由
 */
export const yourVideoModelRoute = {
  // 模型ID识别
  matches: (modelId: string) => modelId === 'your-video-model',

  // 构建视频生成请求
  buildVideoRequest: (params: GenerateVideoParams) => {
    const images = params.images || []
    const duration = params.duration || 5
    const aspectRatio = params.aspectRatio || '16:9'
    const prompt = (params.prompt || '').slice(0, 2500)

    if (!prompt || prompt.trim() === '') {
      throw new Error('视频生成需要提供非空的 prompt')
    }

    let endpoint: string
    let requestData: any

    if (images.length > 0) {
      // 图生视频
      endpoint = '/async/your-model-i2v'

      requestData = {
        images: [images[0]],  // 直接使用，UI 层已处理格式
        prompt,
        duration: String(duration)
      }
    } else {
      // 文生视频
      endpoint = '/async/your-model-t2v'
      requestData = {
        prompt,
        duration: String(duration),
        aspect_ratio: aspectRatio
      }
    }

    // 添加可选参数
    if (params.negativePrompt) {
      requestData.negative_prompt = params.negativePrompt
    }

    return { endpoint, requestData }
  }
}
```

### 图片模型路由模板

```typescript
import { GenerateImageParams } from '@/adapters/base/BaseAdapter'

/**
 * Your Image Model 模型路由
 */
export const yourImageModelRoute = {
  // 模型ID识别
  matches: (modelId: string) => modelId.includes('your-image-model'),

  // 构建图片生成请求
  buildImageRequest: (params: GenerateImageParams) => {
    const endpoint = '/your-image-model'

    const requestData: any = {
      prompt: params.prompt,
      watermark: false
    }

    // 处理上传的图片
    if (params.images && params.images.length > 0) {
      requestData.images = params.images
    }

    // 处理分辨率设置
    if (params.size) {
      requestData.size = params.size
    }

    // 添加其他参数
    if (params.max_images !== undefined) {
      requestData.max_images = params.max_images
    }

    return { endpoint, requestData }
  }
}
```

### 音频模型路由模板

```typescript
import { GenerateAudioParams } from '@/adapters/base/BaseAdapter'

/**
 * MiniMax Speech 2.6 音频模型路由（实际案例）
 */
export const minimaxSpeech26Route = {
  // 模型ID识别
  matches: (modelId: string) =>
    modelId === 'minimax-speech-2.6' ||
    modelId === 'minimax-speech-2.6-hd' ||
    modelId === 'minimax-speech-2.6-turbo',

  // 构建音频生成请求
  buildAudioRequest: (params: GenerateAudioParams) => {
    let endpoint = ''

    // 根据模型选择端点
    if (params.model === 'minimax-speech-2.6') {
      const spec = params.ppioMinimaxAudioSpec === 'turbo' ? 'turbo' : 'hd'
      endpoint = spec === 'turbo'
        ? '/minimax-speech-2.6-turbo'
        : '/minimax-speech-2.6-hd'
    } else if (params.model === 'minimax-speech-2.6-hd') {
      endpoint = '/minimax-speech-2.6-hd'
    } else if (params.model === 'minimax-speech-2.6-turbo') {
      endpoint = '/minimax-speech-2.6-turbo'
    } else {
      throw new Error(`Unsupported audio model: ${params.model}`)
    }

    const requestData: any = {
      text: params.text,
      output_format: params.output_format || 'url'
    }

    // 构建 voice_setting（仅在有值时添加）
    const voice_setting: any = {}
    if (params.ppioMinimaxVoiceId) {
      voice_setting.voice_id = params.ppioMinimaxVoiceId
    }
    if (params.ppioMinimaxAudioSpeed !== undefined) {
      voice_setting.speed = params.ppioMinimaxAudioSpeed
    }
    if (params.ppioMinimaxAudioVol !== undefined) {
      voice_setting.vol = params.ppioMinimaxAudioVol
    }
    if (params.ppioMinimaxAudioPitch !== undefined) {
      voice_setting.pitch = params.ppioMinimaxAudioPitch
    }
    if (params.ppioMinimaxAudioEmotion) {
      voice_setting.emotion = params.ppioMinimaxAudioEmotion
    }
    if (Object.keys(voice_setting).length > 0) {
      requestData.voice_setting = voice_setting
    }

    // 构建 audio_setting（仅在有值时添加）
    const audio_setting: any = {}
    if (params.ppioMinimaxAudioSampleRate !== undefined) {
      audio_setting.sample_rate = params.ppioMinimaxAudioSampleRate
    }
    if (params.ppioMinimaxAudioBitrate !== undefined) {
      audio_setting.bitrate = params.ppioMinimaxAudioBitrate
    }
    if (params.ppioMinimaxAudioFormat) {
      audio_setting.format = params.ppioMinimaxAudioFormat
    }
    if (Object.keys(audio_setting).length > 0) {
      requestData.audio_setting = audio_setting
    }

    return { endpoint, requestData }
  }
}
```

**关键点**：
- 使用 `ppio` 前缀的参数名（如 `ppioMinimaxAudioSpec`）
- 嵌套对象（`voice_setting`, `audio_setting`）仅在有值时添加
- 根据 `spec` 参数动态选择端点
- 音频端点不需要 `/async` 前缀（同步任务）

**注册路由**: 在 `src/adapters/ppio/models/index.ts` 中：

```typescript
import { yourVideoModelRoute } from './your-video-model'

export const ppioModelRoutes: ModelRoute[] = [
  // ... 现有路由
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
  "description": "模型描述",
  "functions": ["视频生成"],
  "progressConfig": {
    "type": "polling",
    "expectedPolls": 40
  }
}
```

**如何确定预估值**:

| 模型速度 | 平均完成时间 | 推荐 expectedPolls |
|----------|--------------|--------------------|
| 超快     | <30秒        | 10-15              |
| 快速     | 30-60秒      | 15-25              |
| 中速     | 1-2分钟      | 25-40              |
| 慢速     | 2-5分钟      | 40-100             |

**计算公式**: `expectedPolls ≈ 平均完成时间(秒) / 3秒 × 80%`

**PPIO 配置**:
- 轮询间隔: 3000ms (3秒)
- 最大轮询次数: 120 次 (6分钟)

---

## 步骤 8: 配置价格

**位置**: `src/config/pricing.ts`

```typescript
// 1. 在 PRICES 常量中添加价格
const PRICES = {
  YOUR_PPIO_MODEL: 0.5,  // 人民币
  // ...
}

// 2. 在 pricingConfigs 数组中添加配置
{
  providerId: 'ppio',
  modelId: 'your-model',
  currency: '¥',
  type: 'calculated',
  calculator: (params) => {
    // 使用 ppio 前缀的参数名，并提供回退
    const duration = params.ppioYourModelVideoDuration
                  || params.videoDuration
                  || 5

    // 根据时长计算价格
    const basePrice = PRICES.YOUR_PPIO_MODEL
    return duration === 10 ? basePrice * 2 : basePrice
  }
}
```

---

## 实现架构

### 适配器结构

```
src/adapters/ppio/
├── PPIOAdapter.ts           # 主适配器类
├── config.ts                # API 配置
├── statusHandler.ts         # 状态轮询处理器
├── models/
│   ├── index.ts            # 路由注册
│   ├── seedream.ts         # 即梦 4.0 路由
│   ├── kling-2.5-turbo.ts  # 可灵 2.5 Turbo 路由
│   ├── vidu.ts             # Vidu Q1 路由
│   ├── minimax-hailuo-2.3.ts  # 海螺 2.3 路由
│   ├── minimax-hailuo-02.ts   # 海螺 02 路由
│   ├── pixverse.ts         # Pixverse V4.5 路由
│   ├── wan.ts              # Wan 2.5 Preview 路由
│   ├── seedance.ts         # Seedance V1 路由
│   └── minimax-speech-2.6.ts  # Minimax Speech 2.6 路由
└── parsers/
    ├── index.ts
    ├── imageParser.ts      # 图片响应解析
    ├── videoParser.ts      # 视频响应解析
    └── audioParser.ts      # 音频响应解析
```

### 核心文件说明

#### PPIOAdapter.ts

主适配器类，继承 BaseAdapter，实现:
- `generateImage()`: 图片生成方法
- `generateVideo()`: 视频生成方法
- `generateAudio()`: 音频生成方法
- `checkStatus()`: 查询任务状态
- `pollTaskStatus()`: 轮询任务直到完成

**关键实现**:

```typescript
async generateVideo(params: GenerateVideoParams): Promise<VideoResult> {
  try {
    // 1. 查找路由
    const route = findRoute(params.model)
    if (!route || !route.buildVideoRequest) {
      throw new Error(`Unsupported video model: ${params.model}`)
    }

    // 2. 构建请求
    const { endpoint, requestData } = route.buildVideoRequest(params)

    // 3. 发送请求
    const response = await this.apiClient.post(endpoint, requestData)

    if (!response.data.task_id) {
      throw new Error('No task ID returned from API')
    }

    const taskId = response.data.task_id

    // 4. 如果提供了进度回调，在 Adapter 内部轮询
    if (params.onProgress) {
      return await this.statusHandler.pollTaskStatus(taskId, params.model, params.onProgress)
    }

    // 5. 否则返回 taskId，让 App 层控制轮询
    return {
      taskId: taskId,
      status: 'TASK_STATUS_QUEUED'
    }
  } catch (error) {
    throw this.handleError(error)
  }
}
```

#### statusHandler.ts

状态管理器，负责任务状态查询和轮询:

```typescript
export class PPIOStatusHandler {
  /**
   * 检查任务状态
   */
  async checkStatus(taskId: string): Promise<TaskStatus> {
    const response = await this.apiClient.get(PPIO_CONFIG.statusEndpoint, {
      params: { task_id: taskId }
    })

    const taskData = response.data.task
    const result: TaskStatus = {
      taskId: taskData.task_id,
      status: taskData.status
    }

    // 如果任务成功，添加结果数据
    if (taskData.status === 'TASK_STATUS_SUCCEEDED' || taskData.status === 'TASK_STATUS_SUCCEED') {
      if (response.data.images && response.data.images.length > 0) {
        result.result = await parseImageResponse(response.data)
      } else if (response.data.videos && response.data.videos.length > 0) {
        result.result = await parseVideoResponse(response.data, this.adapter)
      } else if (response.data.audios && response.data.audios.length > 0) {
        result.result = await parseAudioResponse(response.data)
      }
    }

    return result
  }

  /**
   * 轮询任务状态直到完成
   */
  async pollTaskStatus(
    taskId: string,
    modelId: string,
    onProgress?: (status: ProgressStatus) => void
  ): Promise<VideoResult> {
    const estimatedPolls = getExpectedPolls(modelId)

    const result = await pollUntilComplete<VideoResult>({
      checkFn: async () => {
        const status = await this.checkStatus(taskId)
        return {
          status: status.status,
          result: status.result as VideoResult | undefined
        }
      },
      isComplete: (status) => status === 'TASK_STATUS_SUCCEED' || status === 'TASK_STATUS_SUCCEEDED',
      isFailed: (status) => status === 'TASK_STATUS_FAILED',
      onProgress: (progress, status) => {
        if (onProgress) {
          let message = '生成中...'
          if (status === 'TASK_STATUS_QUEUED') {
            message = '排队中...'
          } else if (status === 'TASK_STATUS_PROCESSING') {
            message = '正在生成...'
          }

          onProgress({
            status: status as any,
            progress,
            message
          })
        }
      },
      interval: PPIO_CONFIG.pollInterval,
      maxAttempts: PPIO_CONFIG.maxPollAttempts,
      estimatedAttempts: estimatedPolls
    })

    return result
  }
}
```

#### parsers/videoParser.ts

解析 PPIO 视频响应并保存到本地:

```typescript
export const parseVideoResponse = async (
  responseData: any,
  adapter: BaseAdapter
): Promise<VideoResult> => {
  if (responseData.videos && responseData.videos.length > 0) {
    const videoUrl = responseData.videos[0].video_url

    // 使用基类的保存方法
    try {
      const savedResult = await adapter['saveMediaLocally'](videoUrl, 'video')
      return {
        url: savedResult.url,
        filePath: savedResult.filePath,
        status: 'TASK_STATUS_SUCCEEDED'
      }
    } catch (e) {
      adapter['log']('视频本地保存失败，回退为远程URL', e)
      return {
        url: videoUrl,
        status: 'TASK_STATUS_SUCCEEDED'
      }
    }
  }

  throw new Error('No video returned from API')
}
```

---

## 已实现的模型

| 模型 ID | 类型 | 核心参数 | 功能 | 预估轮询次数 |
|---------|------|----------|------|--------------|
| `seedream-4.0` | 图片生成 | `selectedResolution`, `resolutionQuality`, `maxImages` | 文生图, 图生图, 智能分辨率匹配, 批量生成 | - |
| `kling-2.5-turbo` | 视频生成 | `ppioKling25VideoDuration`, `ppioKling25AspectRatio`, `ppioKling25CfgScale` | 文生视频, 图生视频 | 40次 |
| `vidu-q1` | 视频生成 | `ppioViduQ1Mode`, `ppioViduQ1AspectRatio`, `ppioViduQ1Style` | 文生视频, 图生视频, 首尾帧模式, 参考生视频 | 60次 |
| `minimax-hailuo-2.3` | 视频生成 | `ppioHailuo23VideoDuration`, `ppioHailuo23VideoResolution` | 文生视频, 图生视频 | 40次 |
| `minimax-hailuo-02` | 视频生成 | 与 Hailuo 2.3 相同 | 文生视频, 图生视频（最多2张） | 40次 |
| `pixverse-v4.5` | 视频生成 | `ppioPixverse45VideoResolution`, `ppioPixverse45VideoAspectRatio` | 文生视频, 图生视频 | 40次 |
| `wan-2.5-preview` | 视频生成 | `ppioWan25VideoDuration`, `ppioWan25AspectRatio` | 文生视频, 图生视频 | 40次 |
| `seedance-v1` | 视频生成 | `ppioSeedanceV1Resolution`, `ppioSeedanceV1AspectRatio` | 文生视频, 图生视频（最多2张） | 40次 |
| `minimax-speech-2.6` | 音频生成 | `ppioMinimaxAudioSpec`, `ppioMinimaxAudioEmotion`, `ppioMinimaxAudioSpeed` | 文本转语音, 多语言支持, 情绪控制 | - |

---

## 关键概念详解

### 1. Base64 图片处理（重要）

PPIO 适配器接收的图片数据已经是正确格式（来自 UI 层的 OptionsBuilder 处理），**模型路由直接使用即可**：

```typescript
// 正确：直接使用（推荐）
const images = params.images || []
if (images.length > 0) {
  requestData.images = [images[0]]  // 单图
  // 或 requestData.images = images  // 多图
}

// 不需要：提取 base64（UI 层已处理）
// ❌ const base64 = images[0].split(',')[1]  // 不需要这样做
```

**说明**：
- 图片格式由 OptionsBuilder 的 `customHandlers.afterBuild` 统一处理
- 模型路由只负责构建 API 请求，不处理图片格式转换
- 如果 API 需要特殊格式（如移除 `data:` 前缀），在路由中处理

### 2. 图片本地保存

PPIO 视频模型需要保存上传的图片到本地，避免 `history.json` 文件体积膨胀：

```typescript
// 在 customHandlers.afterBuild 中
if (context.uploadedImages.length > 0) {
  // 处理图片并保存本地路径
  const { dataUrlToBlob, saveUploadImage } = await import('@/utils/save')
  const setUploadedFilePaths = (context.params as any).setUploadedFilePaths
  
  // 保留 base64 用于 API
  options.images = context.uploadedImages
  
  // 保存本地路径用于历史记录
  const paths = await Promise.all(
    context.uploadedImages.map(async (img, index) => {
      const existingPath = (context.params as any).uploadedFilePaths?.[index]
      if (existingPath) return existingPath
      
      const blob = await dataUrlToBlob(img)
      const saved = await saveUploadImage(blob, 'persist')
      return saved.fullPath
    })
  )
  
  options.uploadedFilePaths = paths
  setUploadedFilePaths(paths)
}
```

**关键原则**：
- `options.images` 保留 base64 数据用于 API 调用
- `options.uploadedFilePaths` 保存本地文件路径用于历史记录
- 避免将 base64 数据直接保存到 `history.json`

### 3. 状态映射

PPIO API 返回的状态需要正确映射，注意成功状态有两种拼写：

```typescript
// API 状态
'TASK_STATUS_QUEUED'      // 排队中
'TASK_STATUS_PROCESSING'  // 处理中
'TASK_STATUS_SUCCEED'     // 成功（注意：不是 SUCCEEDED）
'TASK_STATUS_SUCCEEDED'   // 成功（某些模型）
'TASK_STATUS_FAILED'      // 失败

// 检查完成状态时需要同时检查两种拼写
isComplete: (status) =>
  status === 'TASK_STATUS_SUCCEED' ||
  status === 'TASK_STATUS_SUCCEEDED'
```

### 4. 轮询配置

PPIO 使用统一的轮询配置，定义在 `src/adapters/ppio/config.ts` 中：

```typescript
export const PPIO_CONFIG = {
  baseURL: 'https://api.ppinfra.com/v3',
  statusEndpoint: '/async/task-result',
  pollInterval: 3000,        // 3秒轮询一次
  maxPollAttempts: 120       // 最多轮询 120 次（6分钟）
} as const
```

### 5. 模式切换（Mode Switch）

某些模型支持多种模式（如 Vidu Q1），通过 `autoSwitch` 配置和路由逻辑实现：

#### 参数定义（使用 autoSwitch）

```typescript
{
  id: 'ppioViduQ1Mode',
  type: 'dropdown',
  defaultValue: 'text-image-to-video',
  autoSwitch: {
    watchKeys: ['uploadedImages'],  // 监听图片上传
    condition: (values) => {
      const count = values.uploadedImages?.length || 0
      const targetMode = count === 0 || count === 1 ? 'text-image-to-video' :
                        count === 2 ? 'start-end-frame' : 'reference-to-video'
      return values.ppioViduQ1Mode !== targetMode
    },
    value: (values) => {
      // 返回目标模式
      const count = values.uploadedImages?.length || 0
      if (count === 0 || count === 1) return 'text-image-to-video'
      if (count === 2) return 'start-end-frame'
      return 'reference-to-video'
    }
  },
  options: [
    { value: 'text-image-to-video', label: '文/图生视频' },
    { value: 'start-end-frame', label: '首尾帧' },
    { value: 'reference-to-video', label: '参考生视频' }
  ]
}
```

#### 路由实现（vidu.ts 实际案例）

```typescript
export const viduQ1Route = {
  matches: (modelId: string) => modelId.includes('vidu-q1'),

  buildVideoRequest: (params: GenerateVideoParams) => {
    const mode = params.mode || 'text-image-to-video'
    const images = params.images || []

    let endpoint: string
    let requestData: any = {
      prompt: params.prompt,
      duration: params.duration || 5,
      resolution: params.resolution || '1080p',
      seed: params.seed,
      movement_amplitude: params.movementAmplitude || 'auto',
      bgm: params.bgm || false
    }

    switch (mode) {
      case 'text-image-to-video':
        // 文/图生视频：根据是否有图片选择端点
        if (images.length > 0) {
          endpoint = '/async/vidu-q1-img2video'
          requestData.images = [images[0]]  // 只取第一张图片
          // 图生视频不支持 aspect_ratio 和 style
        } else {
          endpoint = '/async/vidu-q1-text2video'
          requestData.aspect_ratio = params.aspectRatio || '16:9'
          requestData.style = params.style || 'general'
        }
        break

      case 'start-end-frame':
        // 首尾帧：需要2张图片
        if (images.length < 2) {
          throw new Error('首尾帧模式需要至少2张图片')
        }
        endpoint = '/async/vidu-q1-startend2video'
        requestData.images = [images[0], images[1]]  // 取前两张作为首尾帧
        // 首尾帧不支持 aspect_ratio 和 style
        break

      case 'reference-to-video':
        // 参考生视频：需要1-7张图片且prompt必须
        if (images.length < 1 || images.length > 7) {
          throw new Error('参考生视频模式需要1-7张图片')
        }
        if (!params.prompt || params.prompt.trim() === '') {
          throw new Error('参考生视频模式必须提供文本提示词')
        }
        endpoint = '/async/vidu-q1-reference2video'
        requestData.images = images.slice(0, 7)  // 最多取7张
        requestData.aspect_ratio = params.aspectRatio || '16:9'
        // 参考生视频不支持 style
        break

      default:
        throw new Error(`Unsupported video mode: ${mode}`)
    }

    return { endpoint, requestData }
  }
}
```

**关键点**：
- `autoSwitch` 根据图片数量自动切换模式
- 路由根据 `mode` 参数选择不同的 API 端点
- 每种模式支持不同的参数组合
- 添加参数验证（如图片数量检查）

### 6. 参数条件映射

某些参数只在特定条件下传递给 API，可通过 `condition` 属性配置：

```typescript
paramMapping: {
  aspectRatio: {
    source: 'ppioPixverse45VideoAspectRatio',
    condition: (ctx) => ctx.uploadedImages.length === 0  // 仅文生视频时使用
  },
  fastMode: {
    source: 'ppioHailuo23FastMode',
    condition: (ctx) => ctx.uploadedImages.length > 0  // 仅图生视频时使用
  }
}
```

### 7. 参数隐藏

某些参数在特定条件下需要隐藏，可通过 `hidden` 属性配置：

```typescript
{
  id: 'ppioKling25AspectRatio',
  type: 'dropdown',
  // 图生视频时隐藏比例参数（API 不支持）
  hidden: (values) => values.uploadedImages && values.uploadedImages.length > 0
}
```

---

## 常见错误

| 错误类型 | 错误示例 | 正确做法 |
|----------|----------|----------|
| 图片处理错误 | 在路由中提取 base64：`const base64 = images[0].split(',')[1]` | 直接使用：`requestData.images = [images[0]]` |
| 状态检查错误 | `if (status === 'TASK_STATUS_SUCCEEDED')` | 同时检查两种拼写：`status === 'TASK_STATUS_SUCCEED' \|\| status === 'TASK_STATUS_SUCCEEDED'` |
| 图片保存错误 | 只设置 `options.images`，不保存本地路径 | 同时保存本地路径：`options.uploadedFilePaths = paths` |
| 参数命名错误 | 使用通用参数名 `videoDuration` | 使用 ppio 前缀：`ppioYourModelVideoDuration` |
| 端点路径错误 | 缺少 `/async` 前缀：`/your-model-t2v` | 异步任务包含 `/async` 前缀：`/async/your-model-t2v` |

---

## 最佳实践

### 1. 参数命名

始终使用 `ppio` 前缀命名参数，避免与其他供应商冲突：

```typescript
// ✅ 正确
ppioKling25VideoDuration
ppioViduQ1Mode
ppioHailuo23VideoResolution

// ❌ 错误
videoDuration  // 会与其他供应商冲突
mode
resolution
```

### 2. 错误处理

使用 try-catch 并提供友好的错误信息，利用 BaseAdapter 的错误处理机制：

```typescript
try {
  const result = await this.generateVideo(params)
  return result
} catch (error) {
  throw this.handleError(error)  // 使用 BaseAdapter 的错误处理
}
```

### 3. 轮询日志

添加详细的日志输出，便于调试和监控：

```typescript
import { logInfo, logError } from '@/utils/errorLogger'

logInfo('[PPIOAdapter] generateVideo 调用参数:', params)
logInfo('[PPIOAdapter] API端点:', endpoint)
logInfo('[PPIOAdapter] 请求数据:', requestData)
logInfo('[PPIOAdapter] API响应:', response.data)
```

### 4. 参数验证

在 `customHandlers` 中验证参数，确保模型调用的正确性：

```typescript
customHandlers: {
  validateParams: (params) => {
    const mode = params.ppioViduQ1Mode
    const imageCount = (params as any).uploadedImages?.length || 0

    if (mode === 'start-end-frame' && imageCount < 2) {
      throw new Error('首尾帧模式需要至少2张图片')
    }
    if (mode === 'reference-to-video' && (imageCount < 1 || imageCount > 7)) {
      throw new Error('参考生视频模式需要1-7张图片')
    }
  }
}
```

---

## 检查清单

### PPIO 特定步骤（必须完成）

- [ ] 在 `src/models/` 创建参数 Schema（使用 ppio 前缀）
- [ ] 在 `ParameterPanel.tsx` 添加渲染分支
- [ ] 在 `useMediaGeneratorState.ts` 添加状态（使用 ppio 前缀）
- [ ] 在 `handleSchemaChange` 和 `presetStateMapping` 中注册参数映射
- [ ] 在 `configs/ppio-models.ts` 添加 OptionsBuilder 配置
- [ ] 在 `configs/index.ts` 注册配置
- [ ] 在 `adapters/ppio/models/` 创建模型路由文件
  - [ ] 实现 `matches()` 方法
  - [ ] 实现 `buildImageRequest()` 或 `buildVideoRequest()` 或 `buildAudioRequest()`
  - [ ] 正确处理 base64 编码（移除 data: 前缀）
  - [ ] 使用正确的端点路径（包含 /async 前缀）
  - [ ] 添加参数验证和错误处理
- [ ] 在 `adapters/ppio/models/index.ts` 注册路由
- [ ] 在 `providers.json` 添加模型配置
  - [ ] 关键: `progressConfig.type` 必须是 `"polling"`
  - [ ] 设置合理的 `expectedPolls` 值
- [ ] 在 `pricing.ts` 添加价格配置
  - [ ] 使用 ppio 前缀的参数名，并提供回退
- [ ] 在 `customHandlers.afterBuild` 中处理图片保存
  - [ ] 保留 base64 数据用于 API (`options.images`)
  - [ ] 保存本地路径用于历史记录 (`options.uploadedFilePaths`)

---

## 常见问题

### 1. 图片上传失败

**问题**: API 返回图片格式错误

**解决方案**:
- 检查是否正确提取 base64 数据（移除 data: 前缀）
- 检查图片格式是否支持 (JPEG, PNG, WebP)
- 检查图片大小是否超过限制
- 查看控制台错误信息

### 2. 任务轮询超时

**问题**: 任务轮询超过最大次数仍未完成

**解决方案**:
- 增加 `expectedPolls` 配置
- 检查 PPIO API 状态
- 查看任务是否失败 (`TASK_STATUS_FAILED`)
- 检查网络连接

### 3. 参数未生效

**问题**: 修改参数后生成结果未变化

**解决方案**:
- 检查参数是否在所有位置正确注册
- 检查 OptionsBuilder 配置的 paramMapping
- 检查模型路由是否正确使用参数
- 使用浏览器开发工具查看实际发送的请求
- 检查参数是否有 condition 限制

### 4. 历史记录文件过大

**问题**: `history.json` 文件体积暴增

**解决方案**:
- 确保在 `customHandlers.afterBuild` 中保存本地路径
- 不要将 base64 数据保存到 `uploadedFilePaths`
- 检查是否正确调用 `setUploadedFilePaths`

### 5. 模式切换不工作

**问题**: `autoSwitch` 不生效

**解决方案**:
- 检查 `autoSwitch.watchKeys` 是否正确
- 检查 `autoSwitch.condition` 逻辑
- 确认 `autoSwitch.value` 返回正确的值
- 查看控制台是否有相关错误

---

## 参考资料

- https://docs.ppinfra.com/
- ./ai-guide-new-provider.md
- ./ai-guide-new-model.md
- ./ai-guide-fal.md
- ./ai-guide-kie.md

---

## 核心要点总结

1. **参数命名**: 所有参数统一使用 `ppio` 前缀（包括视频、图片、音频模型），避免冲突
2. **Base64 编码**: 图片由 UI 层处理，模型路由直接使用 `params.images`
3. **本地保存**:
   - 视频：保存本地路径，避免 history.json 膨胀
   - 音频：仅返回 URL，不保存本地
4. **状态映射**: 同时检查 `TASK_STATUS_SUCCEED` 和 `TASK_STATUS_SUCCEEDED`
5. **轮询配置**: 使用 providers.json 配置 `expectedPolls`
6. **端点路径**:
   - 异步任务（视频）：需要 `/async` 前缀
   - 同步任务（音频、图片）：无前缀
7. **模型路由**: 每个模型独立路由文件，清晰的职责分离
8. **错误处理**: 使用 BaseAdapter.handleError() 统一错误格式

---

## 快速参考表

### 模型类型对应关系

| 模型类型 | 路由方法          | Adapter 方法  | 解析器             |
|----------|-------------------|---------------|--------------------|
| 图片     | buildImageRequest | generateImage | parseImageResponse |
| 视频     | buildVideoRequest | generateVideo | parseVideoResponse |
| 音频     | buildAudioRequest | generateAudio | parseAudioResponse |

### customHandlers 选择

| 场景             | 需要的处理器                | 说明               |
|------------------|-----------------------------|--------------------|
| 纯文生视频       | 不需要                      | 无图片上传         |
| 图生视频（单图） | afterBuild                  | 处理单张图片       |
| 图生视频（多图） | afterBuild                  | 处理多张图片       |
| 图生图           | afterBuild                  | 处理图片和分辨率   |
| 模式切换         | validateParams + afterBuild | 验证参数和处理图片 |

### features 配置

| 功能     | 配置项      | 必需场景                 |
|----------|-------------|--------------------------|
| 图片上传 | imageUpload | 图生图、图生视频         |
| 模式切换 | modeSwitch  | 多模式模型（如 Vidu Q1） |
| 智能匹配 | smartMatch  | 支持智能宽高比的模型     |

### paramMapping 形式

| 形式   | 示例                                         | 使用场景                |
|--------|----------------------------------------------|-------------------------|
| 字符串 | duration: 'ppioModelDuration'                | 简单的 1:1 映射         |
| 数组   | source: ['ppioModelParam', 'genericParam']   | 模型特定参数 + 通用回退 |
| 对象   | { source: 'param', defaultValue: 5 }         | 需要默认值的参数        |
| 条件   | { source: 'param', condition: (ctx) => ... } | 条件映射                |

### 与其他适配器对比

| 特性 | PPIO | Fal | KIE |
|------|------|-----|-----|
| 图片上传 | 使用 base64 编码 | 自动上传到 CDN | 上传到 KIE CDN |
| 轮询方式 | 手动轮询 | SDK 自动轮询 | 手动轮询 |
| 本地保存 | Adapter 内部处理 | App.tsx 统一处理 | Adapter 内部处理 |
| API 结构 | 模型特定端点 | 模型特定端点 | 统一端点 |
| 状态查询 | 统一端点 `/async/task-result` | SDK 自动处理 | 统一端点 `/api/v1/jobs/recordInfo` |

---
