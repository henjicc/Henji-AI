# 3-1 创建PPIOProvider类

## 目标
一次性实现完整的 PPIOProvider 类，包含所有 PPIO 特定的逻辑。

## 文件位置
`src/core/providers/PPIOProvider.ts`

## 实现内容

### 类结构

```typescript
import { ProviderHandler } from './base/ProviderHandler'
import { ModelDefinition } from '@/core/types'
import { ProviderError, ProviderErrorCode } from './base/errors'

export class PPIOProvider extends ProviderHandler {
  constructor(apiKey: string) {
    super('ppio', 'https://api.ppio.cloud', apiKey)
  }

  protected async preprocessRequest(model: ModelDefinition, params: Record<string, any>): Promise<Record<string, any>>

  protected async postprocessResponse(response: any, model: ModelDefinition): Promise<any>

  private async convertImagesToBase64(images: string[]): Promise<string[]>

  private async uploadVideoToFalCDN(video: File | string): Promise<string>

  private async pollTask(taskId: string, polling: PollingConfig): Promise<any>

  private async saveUploadedFilePaths(images: string[], existingPaths: string[]): Promise<string[]>
}
```

### 1. preprocessRequest() - 预处理逻辑

**PPIO 特性**：
- 所有图片都转为 base64
- 视频上传到 Fal CDN（动作控制等模式需要）
- 保存图片文件路径（用于历史记录）
- 保存视频文件路径

```typescript
protected async preprocessRequest(
  model: ModelDefinition,
  params: Record<string, any>
): Promise<Record<string, any>> {
  const processedParams = { ...params }

  // 1. 处理图片：转为 base64
  if (params.images && params.images.length > 0) {
    this.log('开始转换图片为 base64...')
    processedParams.images = await this.convertImagesToBase64(params.images)

    // 保存图片文件路径
    const uploadedFilePaths = params.uploadedFilePaths || []
    const paths = await this.saveUploadedFilePaths(processedParams.images, uploadedFilePaths)
    processedParams.uploadedFilePaths = paths
  }

  // 2. 处理视频：上传到 Fal CDN（如果有）
  if (params.video) {
    this.log('开始上传视频到 Fal CDN...')
    processedParams.video = await this.uploadVideoToFalCDN(params.video)

    // 保存视频文件路径（如果是 File 对象）
    if (params.video instanceof File) {
      const { saveUploadVideo } = await import('@/utils/save')
      const saved = await saveUploadVideo(params.video, 'persist')
      processedParams.uploadedVideoFilePaths = [saved.fullPath]
    }
  }

  return processedParams
}
```

### 2. postprocessResponse() - 后处理逻辑

**PPIO 特性**：
- 所有异步任务需要轮询
- 检查 task_id 字段

```typescript
protected async postprocessResponse(
  response: any,
  model: ModelDefinition
): Promise<any> {
  // 如果响应包含 task_id，需要轮询
  if (response.task_id) {
    this.log(`检测到 task_id: ${response.task_id}，开始轮询...`)

    const polling = model.meta.polling || {
      interval: 3000,
      maxAttempts: 120
    }

    return this.pollTask(response.task_id, polling)
  }

  // 同步响应，直接返回
  return response
}
```

### 3. convertImagesToBase64() - 图片转换

```typescript
private async convertImagesToBase64(images: string[]): Promise<string[]> {
  return Promise.all(images.map(async (img) => {
    // 1. 如果已经是 base64，直接返回
    if (img.startsWith('data:')) {
      return img
    }

    // 2. 如果是远程 URL（非 localhost），直接返回
    if (img.startsWith('http') && !img.includes('localhost')) {
      return img
    }

    // 3. 本地文件或 localhost URL，读取并转为 base64
    try {
      const blob = await this.readLocalFile(img)
      return this.blobToBase64(blob)
    } catch (error) {
      this.log('图片转换失败:', error)
      throw new ProviderError(
        `图片转换失败: ${error.message}`,
        'ppio',
        ProviderErrorCode.FILE_READ_FAILED,
        { image: img }
      )
    }
  }))
}
```

### 4. uploadVideoToFalCDN() - 视频上传

```typescript
private async uploadVideoToFalCDN(video: File | string): Promise<string> {
  const falApiKey = this.getFalApiKey()
  if (!falApiKey) {
    throw new ProviderError(
      'Fal API key not found (required for video upload)',
      'ppio',
      ProviderErrorCode.API_KEY_MISSING
    )
  }

  // 1. 如果已经是 URL，直接返回
  if (typeof video === 'string' && video.startsWith('http')) {
    return video
  }

  // 2. 上传 File 对象到 Fal CDN
  if (video instanceof File) {
    try {
      const fal = await import('@fal-ai/client')
      fal.config({ credentials: falApiKey })

      this.log('上传视频到 Fal CDN...', { name: video.name, size: video.size })
      const url = await fal.storage.upload(video)
      this.log('视频上传成功:', url)

      return url
    } catch (error) {
      throw new ProviderError(
        `视频上传失败: ${error.message}`,
        'ppio',
        ProviderErrorCode.UPLOAD_FAILED,
        error
      )
    }
  }

  throw new Error('Unsupported video format')
}
```

### 5. pollTask() - 任务轮询

```typescript
private async pollTask(taskId: string, polling: PollingConfig): Promise<any> {
  const { interval, maxAttempts } = polling

  for (let i = 0; i < maxAttempts; i++) {
    // 延迟
    await new Promise(resolve => setTimeout(resolve, interval))

    // 查询状态
    try {
      const status = await this.get(`/tasks/${taskId}`)

      this.log(`轮询进度: ${i + 1}/${maxAttempts}`, {
        status: status.status,
        taskId
      })

      // 完成
      if (status.status === 'completed' || status.status === 'success') {
        this.log('任务完成')
        return status
      }

      // 失败
      if (status.status === 'failed' || status.status === 'error') {
        throw new Error(status.error || status.message || 'Task failed')
      }

      // 继续轮询（处理中、排队中等状态）
    } catch (error) {
      // 如果是查询错误（非任务失败），继续轮询
      if (i === maxAttempts - 1) {
        throw error
      }
    }
  }

  // 超时
  throw new ProviderError(
    `任务超时: ${taskId}`,
    'ppio',
    ProviderErrorCode.POLLING_TIMEOUT,
    { taskId, maxAttempts }
  )
}
```

### 6. saveUploadedFilePaths() - 保存文件路径

```typescript
private async saveUploadedFilePaths(
  images: string[],
  existingPaths: string[]
): Promise<string[]> {
  const { dataUrlToBlob, saveUploadImage } = await import('@/utils/save')

  const paths: string[] = []

  for (let i = 0; i < images.length; i++) {
    // 如果已有路径，复用
    if (existingPaths[i]) {
      paths.push(existingPaths[i])
      continue
    }

    // 如果是 base64，保存到本地
    if (images[i].startsWith('data:')) {
      const blob = await dataUrlToBlob(images[i])
      const saved = await saveUploadImage(blob, 'persist', { maxDimension: 6000 })
      paths.push(saved.fullPath)
    } else {
      // 远程 URL，不保存
      paths.push('')
    }
  }

  return paths
}
```

## 参考旧代码

### 图片转换逻辑
- 位置：`old-Henji-AI/src/adapters/ppio/PPIOAdapter.ts` 第84-129行
- 参考：图片转 base64 的完整流程

### 视频上传逻辑
- 位置：`old-Henji-AI/src/adapters/ppio/PPIOAdapter.ts` 第156-245行
- 参考：视频处理和上传到 Fal CDN

### 轮询逻辑
- 位置：`old-Henji-AI/src/adapters/ppio/statusHandler.ts`
- 参考：完整的轮询实现

### 文件路径保存
- 位置：`old-Henji-AI/src/components/MediaGenerator/builders/configs/ppio-models.ts` 第50-89行
- 参考：customHandlers.afterBuild 中的文件保存逻辑

## 实现步骤

1. 创建文件 `src/core/providers/PPIOProvider.ts`
2. 实现类结构和构造函数
3. 实现 preprocessRequest() 方法
4. 实现 postprocessResponse() 方法
5. 实现 convertImagesToBase64() 方法
6. 实现 uploadVideoToFalCDN() 方法
7. 实现 pollTask() 方法
8. 实现 saveUploadedFilePaths() 方法
9. 添加完整的 JSDoc 注释
10. TypeScript 编译验证

## 验证标准
- [ ] TypeScript 编译无错误
- [ ] 所有方法都有完整的类型定义
- [ ] 所有方法都有 JSDoc 注释
- [ ] 错误处理完善（使用 ProviderError）
- [ ] 日志输出清晰

## 预计工时
4-5小时

## 注意事项

1. **复用基类方法**
   - readLocalFile()
   - blobToBase64()
   - dataURItoBlob()
   - getFalApiKey()
   - log()

2. **错误处理**
   - 所有错误使用 ProviderError
   - 包含足够的调试信息
   - 区分不同的错误类型

3. **日志输出**
   - 关键步骤都要输出日志
   - 便于调试和追踪问题

4. **兼容性**
   - 处理 Tauri 的 asset:// 协议
   - 处理 Windows/macOS 路径差异
   - 处理本地文件和远程 URL

## 完成标志
实现完成后，应该能这样使用：

```typescript
import { PPIOProvider } from '@/core/providers/PPIOProvider'

const provider = new PPIOProvider('your-api-key')

const result = await provider.generate(kling26ProModel, {
  prompt: 'A beautiful sunset',
  ppioKling26VideoDuration: 10,
  images: ['asset://...'],
  video: new File([...], 'video.mp4')
})
```
