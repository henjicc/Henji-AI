/**
 * PPIOProvider - PPIO 供应商实现
 *
 * 特性：
 * - 所有图片转为 base64 格式
 * - 视频上传到通用文件上传服务
 * - 异步任务轮询
 * - 自动保存上传文件路径
 */

import { ProviderHandler } from './base/ProviderHandler'
import { ModelDefinition } from '@/core/types'
import {
  ProviderError,
  ProviderErrorCode,
  createPollingTimeoutError,
  createInvalidResponseError,
} from './base/errors'
import { PollingConfig, GenerateResult } from './base/types'
import { saveImageFromUrl, saveVideoFromUrl, saveAudioFromUrl } from '@/utils/save'
import { UploadService } from '@/services/upload/UploadService'
import { isDataURI, isLocalPath } from './base/utils'

/**
 * PPIO Provider 类
 */
export class PPIOProvider extends ProviderHandler {
  /**
   * 构造函数
   *
   * @param apiKey - PPIO API 密钥
   */
  constructor(apiKey: string) {
    super('ppio', 'https://api.ppinfra.com/v3', apiKey, {
      timeout: 120000,
      options: { debug: true },
    })
  }

  /**
   * 预处理请求参数
   *
   * PPIO 特定处理：
   * 1. 图片转为 base64 格式
   * 2. 视频上传到通用文件上传服务
   * 3. 保存上传文件路径
   *
   * @param model - 模型定义
   * @param params - 原始参数
   * @returns Promise<处理后的参数>
   */
  protected async preprocessRequest(
    model: ModelDefinition,
    params: Record<string, any>
  ): Promise<Record<string, any>> {
    const processedParams = { ...params }

    this.log('开始预处理参数', { modelId: model.meta.id })

    // 1. 处理图片：转为 base64
    // 注意：同时处理 images（复数）和 image（单数）两种字段名
    // 因为不同 API 使用不同的字段名
    const fieldsToProcess: Array<{ field: string; data: string[] }> = []

    if (params.images && Array.isArray(params.images) && params.images.length > 0) {
      fieldsToProcess.push({ field: 'images', data: params.images })
    }
    if (params.image && Array.isArray(params.image) && params.image.length > 0) {
      fieldsToProcess.push({ field: 'image', data: params.image })
    }

    if (fieldsToProcess.length > 0) {
      this.log('开始转换图片为 base64...', {
        fields: fieldsToProcess.map(f => ({ field: f.field, count: f.data.length }))
      })

      try {
        // 只转换一次（使用第一个有效的图片数组）
        const primaryField = fieldsToProcess[0]
        const convertedImages = await this.convertImagesToBase64(primaryField.data)

        // 更新所有图片字段为转换后的 base64
        for (const { field } of fieldsToProcess) {
          processedParams[field] = convertedImages
        }

        // 保存图片文件路径（用于历史记录）
        const existingPaths = params.uploadedFilePaths || []
        processedParams.uploadedFilePaths = await this.saveUploadedFilePaths(
          convertedImages,
          existingPaths
        )

        this.log('图片处理完成', {
          count: convertedImages.length,
          fields: fieldsToProcess.map(f => f.field),
          paths: processedParams.uploadedFilePaths,
        })
      } catch (error) {
        this.log('图片处理失败', { error })
        throw ProviderError.fromError(error, this.providerName)
      }
    }

    // 2. 处理视频：上传到通用文件上传服务（如果有）
    if (params.video) {
      this.log('检测到视频参数，开始处理...', {
        type: params.video instanceof File ? 'File' : 'string',
      })

      try {
        processedParams.video = await this.uploadVideoToGeneralUpload(params.video)

        // 保存视频文件路径（如果是 File 对象）
        if (params.video instanceof File) {
          const { saveUploadVideo } = await import('@/utils/save')
          const saved = await saveUploadVideo(params.video, 'persist')
          processedParams.uploadedVideoFilePaths = [saved.fullPath]

          this.log('视频文件路径已保存', {
            path: saved.fullPath,
          })
        }

        this.log('视频处理完成', { url: processedParams.video })
      } catch (error) {
        this.log('视频处理失败', { error })
        throw ProviderError.fromError(error, this.providerName)
      }
    }

    // 3. 处理参考视频数组：reference_video_urls
    if (Array.isArray(params.reference_video_urls) && params.reference_video_urls.length > 0) {
      this.log('检测到 reference_video_urls，开始处理...', {
        count: params.reference_video_urls.length
      })

      try {
        const processedRefs: string[] = []
        for (const item of params.reference_video_urls) {
          if (item instanceof File) {
            if (params.video && item === params.video && processedParams.video) {
              processedRefs.push(processedParams.video)
            } else {
              const url = await this.uploadVideoToGeneralUpload(item)
              processedRefs.push(url)
            }
          } else if (typeof item === 'string' && item.startsWith('http')) {
            processedRefs.push(item)
          } else if (processedParams.video && item === processedParams.video) {
            processedRefs.push(processedParams.video)
          } else if (processedParams.video && !item) {
            processedRefs.push(processedParams.video)
          } else if (typeof item === 'string') {
            const url = await this.uploadVideoToGeneralUpload(item)
            processedRefs.push(url)
          }
        }

        if (processedRefs.length > 0) {
          processedParams.reference_video_urls = processedRefs
        }

        // 如果 reference_video_urls 使用了 video 上传结果，避免重复发送 video 字段
        if (processedParams.video && processedRefs.includes(processedParams.video)) {
          delete processedParams.video
        }

        this.log('reference_video_urls 处理完成', { count: processedRefs.length })
      } catch (error) {
        this.log('reference_video_urls 处理失败', { error })
        throw ProviderError.fromError(error, this.providerName)
      }
    }

    this.log('参数预处理完成')
    return processedParams
  }

  /**
   * 后处理 API 响应
   *
   * PPIO 特定处理：
   * - 检测异步任务并轮询状态
   *
   * @param response - API 原始响应
   * @param model - 模型定义
   * @returns Promise<最终响应数据>
   */
  protected async postprocessResponse(
    response: any,
    model: ModelDefinition
  ): Promise<any> {
    this.log('开始后处理响应', { response })

    // 如果响应包含 task_id，需要轮询
    if (response.task_id) {
      this.log(`检测到异步任务: ${response.task_id}，开始轮询...`)

      const polling = model.meta.polling || {
        interval: 3000,
        maxAttempts: 120,
      }

      return this.pollTask(response.task_id, polling)
    }

    // 同步响应，直接返回
    this.log('同步响应，无需轮询')
    return response
  }

  /**
   * 将图片数组转换为 base64 格式
   *
   * 处理逻辑：
   * - data: 开头 → 直接返回（已经是 base64）
   * - http://asset.localhost/ 开头 → 解码并读取本地文件
   * - http(s) 开头且非 localhost → 直接返回（远程 URL）
   * - 其他 → 读取本地文件并转为 base64
   *
   * @param images - 图片数组（可能是本地路径、data URI、远程 URL）
   * @returns Promise<base64 数组>
   */
  private async convertImagesToBase64(images: string[]): Promise<string[]> {
    return Promise.all(
      images.map(async (img) => {
        // 1. 如果已经是 base64（data URI），直接返回
        if (img.startsWith('data:')) {
          this.log('图片已经是 base64 格式', { preview: img.substring(0, 50) })
          return img
        }

        // 2. 如果是 Tauri asset 协议的 HTTP 格式，解码并读取
        if (img.startsWith('http://asset.localhost/')) {
          try {
            // 提取并解码文件路径
            const encodedPath = img.replace('http://asset.localhost/', '')
            const decodedPath = decodeURIComponent(encodedPath)

            this.log('检测到 Tauri asset URL，读取本地文件...', {
              url: img.substring(0, 80) + '...',
              path: decodedPath
            })

            const blob = await this.readLocalFile(decodedPath)
            const base64 = await this.blobToBase64(blob)

            // 构造完整的 data URI
            const mimeType = blob.type || 'image/jpeg'
            const dataURI = `data:${mimeType};base64,${base64}`

            this.log('图片转换成功', {
              size: blob.size,
              mimeType,
            })

            return dataURI
          } catch (error: any) {
            this.log('图片转换失败', { url: img.substring(0, 80) + '...', error })
            throw new ProviderError(
              `图片转换失败: ${error.message}`,
              this.providerName,
              ProviderErrorCode.FILE_READ_FAILED,
              { image: img, originalError: error }
            )
          }
        }

        // 3. 如果是远程 URL（非 localhost），直接返回
        if (img.startsWith('http') && !img.includes('localhost')) {
          this.log('图片是远程 URL，直接使用', { url: img })
          return img
        }

        // 4. 本地文件路径，读取并转为 base64
        try {
          this.log('读取本地图片文件...', { path: img })

          const blob = await this.readLocalFile(img)
          const base64 = await this.blobToBase64(blob)

          // 构造完整的 data URI
          const mimeType = blob.type || 'image/jpeg'
          const dataURI = `data:${mimeType};base64,${base64}`

          this.log('图片转换成功', {
            path: img,
            size: blob.size,
            mimeType,
          })

          return dataURI
        } catch (error: any) {
          this.log('图片转换失败', { path: img, error })
          throw new ProviderError(
            `图片转换失败: ${error.message}`,
            this.providerName,
            ProviderErrorCode.FILE_READ_FAILED,
            { image: img, originalError: error }
          )
        }
      })
    )
  }

  /**
   * 上传视频到通用文件上传服务
   *
   * 处理逻辑：
   * - 如果已经是 http(s) URL → 直接返回
   * - 如果是 File 对象 → 上传到 Fal CDN
   * - 其他 → 抛出错误
   *
   * @param video - 视频（File 对象或 URL 字符串）
   * @returns Promise<视频 URL>
   */
  private async uploadVideoToGeneralUpload(video: File | string): Promise<string> {
    // 1. 如果已经是 URL，直接返回
    if (typeof video === 'string' && video.startsWith('http')) {
      this.log('视频已经是 URL，直接使用', { url: video })
      return video
    }

    // 2. Data URI → Blob 上传
    if (typeof video === 'string' && isDataURI(video)) {
      try {
        const blob = this.dataURItoBlob(video)
        const uploadService = UploadService.getInstance()
        const url = await uploadService.uploadFile(blob, 'video.bin')
        this.log('视频上传成功', { url })
        return url
      } catch (error: any) {
        this.log('视频上传失败', { error })
        throw new ProviderError(
          `视频上传失败: ${error.message}`,
          this.providerName,
          ProviderErrorCode.UPLOAD_FAILED,
          { originalError: error }
        )
      }
    }

    // 3. 将本地路径/asset 转为 Blob 并上传
    if (typeof video === 'string') {
      if (video.startsWith('http://asset.localhost/')) {
        try {
          const encodedPath = video.replace('http://asset.localhost/', '')
          const decodedPath = decodeURIComponent(encodedPath)
          const blob = await this.readLocalFile(decodedPath)
          const uploadService = UploadService.getInstance()
          const url = await uploadService.uploadFile(blob, 'video.mp4')
          this.log('视频上传成功', { url })
          return url
        } catch (error: any) {
          this.log('视频上传失败', { error })
          throw new ProviderError(
            `视频上传失败: ${error.message}`,
            this.providerName,
            ProviderErrorCode.UPLOAD_FAILED,
            { originalError: error }
          )
        }
      }

      if (video.startsWith('http://tauri.localhost/')) {
        try {
          const encodedPath = video.replace('http://tauri.localhost/', '')
          const decodedPath = decodeURIComponent(encodedPath)
          const blob = await this.readLocalFile(decodedPath)
          const uploadService = UploadService.getInstance()
          const url = await uploadService.uploadFile(blob, 'video.mp4')
          this.log('视频上传成功', { url })
          return url
        } catch (error: any) {
          this.log('视频上传失败', { error })
          throw new ProviderError(
            `视频上传失败: ${error.message}`,
            this.providerName,
            ProviderErrorCode.UPLOAD_FAILED,
            { originalError: error }
          )
        }
      }

      if (isLocalPath(video)) {
        try {
          const blob = await this.readLocalFile(video)
          const uploadService = UploadService.getInstance()
          const url = await uploadService.uploadFile(blob, 'video.mp4')
          this.log('视频上传成功', { url })
          return url
        } catch (error: any) {
          this.log('视频上传失败', { error })
          throw new ProviderError(
            `视频上传失败: ${error.message}`,
            this.providerName,
            ProviderErrorCode.UPLOAD_FAILED,
            { originalError: error }
          )
        }
      }
    }

    // 4. 上传 File 对象
    if (video instanceof File) {
      try {
        const uploadService = UploadService.getInstance()

        this.log('开始上传视频到通用上传服务...', {
          name: video.name,
          size: video.size,
          type: video.type,
        })

        const url = await uploadService.uploadFile(video, video.name)

        this.log('视频上传成功', { url })
        return url
      } catch (error: any) {
        this.log('视频上传失败', { error })
        throw new ProviderError(
          `视频上传失败: ${error.message}`,
          this.providerName,
          ProviderErrorCode.UPLOAD_FAILED,
          { originalError: error }
        )
      }
    }

    throw new ProviderError(
      '不支持的视频格式',
      this.providerName,
      ProviderErrorCode.VALIDATION_FAILED,
      { video }
    )
  }

  /**
   * 轮询任务状态
   *
   * @param taskId - 任务 ID
   * @param polling - 轮询配置
   * @returns Promise<最终结果>
   */
  private async pollTask(taskId: string, polling: PollingConfig): Promise<any> {
    const { interval, maxAttempts } = polling

    this.log('开始轮询任务', { taskId, interval, maxAttempts })

    for (let i = 0; i < maxAttempts; i++) {
      // 延迟
      await new Promise((resolve) => setTimeout(resolve, interval))

      try {
        // 查询状态 - 使用正确的 PPIO API 端点
        const response = await this.get(`/async/task-result?task_id=${taskId}`)

        // PPIO API 响应格式：{ task: { status, ... }, videos: [...], images: [...], audios: [...] }
        const taskStatus = response.task?.status
        const progress = response.task?.progress_percent

        this.log(`轮询进度: ${i + 1}/${maxAttempts}`, {
          status: taskStatus,
          progress,
          taskId,
        })

        // 任务完成
        if (taskStatus === 'TASK_STATUS_SUCCEED') {
          this.log('任务完成', { taskId, attempts: i + 1 })
          // 返回完整响应，包含 videos/images/audios
          return response
        }

        // 任务失败
        if (taskStatus === 'TASK_STATUS_FAILED') {
          const errorMsg = response.task?.reason || 'Task failed'
          this.log('任务失败', { taskId, error: errorMsg })

          throw new ProviderError(
            `任务失败: ${errorMsg}`,
            this.providerName,
            ProviderErrorCode.TASK_FAILED,
            { taskId, response }
          )
        }

        // 继续轮询（TASK_STATUS_QUEUED, TASK_STATUS_PROCESSING 等状态）
        this.log('任务进行中，继续轮询...', {
          status: taskStatus,
          progress,
        })
      } catch (error) {
        // 如果是 ProviderError，直接抛出
        if (error instanceof ProviderError) {
          throw error
        }

        // 如果是查询错误（非任务失败），继续轮询
        if (i === maxAttempts - 1) {
          // 最后一次尝试也失败了，抛出错误
          throw ProviderError.fromError(error, this.providerName)
        }

        this.log('查询状态出错，继续重试...', { error })
      }
    }

    // 超时
    this.log('轮询超时', { taskId, maxAttempts })
    throw createPollingTimeoutError(this.providerName, maxAttempts, maxAttempts)
  }

  /**
   * 保存上传文件路径
   *
   * 将 base64 图片保存到本地，并返回文件路径数组
   *
   * @param images - 图片数组（base64 或 URL）
   * @param existingPaths - 已有的文件路径
   * @returns Promise<文件路径数组>
   */
  private async saveUploadedFilePaths(
    images: string[],
    existingPaths: string[]
  ): Promise<string[]> {
    const { dataURItoBlob } = await import('@/utils/save')
    const { saveUploadImage } = await import('@/utils/save')

    const paths: string[] = []

    for (let i = 0; i < images.length; i++) {
      // 如果已有路径，复用
      if (existingPaths[i]) {
        paths.push(existingPaths[i])
        this.log(`复用已有文件路径: ${existingPaths[i]}`)
        continue
      }

      // 如果是 base64，保存到本地
      if (images[i].startsWith('data:')) {
        try {
          const blob = dataURItoBlob(images[i])
          const saved = await saveUploadImage(blob, 'persist', {
            maxDimension: 6000,
          })
          paths.push(saved.fullPath)

          this.log('图片已保存到本地', {
            index: i,
            path: saved.fullPath,
          })
        } catch (error) {
          this.log('保存图片失败', { index: i, error })
          // 保存失败不影响主流程，记录空路径
          paths.push('')
        }
      } else {
        // 远程 URL，不保存
        paths.push('')
        this.log('远程 URL 不保存', { index: i, url: images[i] })
      }
    }

    return paths
  }

  /**
   * 从响应中提取媒体 URL（覆盖基类方法）
   *
   * PPIO 特定的 URL 提取逻辑
   *
   * @param response - API 响应
   * @returns 媒体 URL
   */
  protected extractMediaUrl(response: any): string {
    // PPIO API 响应格式（根据实际 API 返回）：
    // - response.videos[0] 或 response.videos[0].video_url (视频)
    // - response.images[0] 或 response.images[0].image_url (图片)
    // - response.audios[0] 或 response.audios[0].audio_url (音频)

    // 视频
    if (response?.videos && response.videos.length > 0) {
      const video = response.videos[0]
      // 兼容两种格式：直接是 URL 字符串，或者是包含 video_url 的对象
      return typeof video === 'string' ? video : (video.video_url || '')
    }

    // 图片
    if (response?.images && response.images.length > 0) {
      const image = response.images[0]
      // 兼容两种格式：直接是 URL 字符串，或者是包含 image_url 的对象
      return typeof image === 'string' ? image : (image.image_url || '')
    }

    // 音频
    if (response?.audios && response.audios.length > 0) {
      const audio = response.audios[0]
      // 兼容两种格式：直接是 URL 字符串，或者是包含 audio_url 的对象
      return typeof audio === 'string' ? audio : (audio.audio_url || '')
    }

    // 兼容旧格式
    return (
      response?.url ||
      response?.video_url ||
      response?.audio_url ||
      response?.output ||
      response?.data?.url ||
      response?.result?.url ||
      ''
    )
  }

  /**
   * 保存媒体文件到本地（覆盖基类方法）
   *
   * PPIO 特定处理：支持多张图片保存
   * 多张图片时，URL 和路径用 ||| 分隔
   *
   * @param response - API 响应数据
   * @param type - 媒体类型
   * @returns Promise<生成结果>
   */
  protected async saveMedia(
    response: any,
    type: 'image' | 'video' | 'audio'
  ): Promise<GenerateResult> {
    try {
      // 检查是否有多张图片
      if (type === 'image' && response?.images && response.images.length > 1) {
        this.log('检测到多张图片，开始批量保存', { count: response.images.length })

        const urls: string[] = []
        const filePaths: string[] = []

        for (const img of response.images) {
          const url = typeof img === 'string' ? img : (img.image_url || '')
          if (url) {
            urls.push(url)
            try {
              const { fullPath } = await saveImageFromUrl(url)
              filePaths.push(fullPath)
              this.log('图片保存成功', { url: url.substring(0, 50) + '...', filePath: fullPath })
            } catch (error) {
              this.log('图片保存失败，跳过', { url: url.substring(0, 50) + '...', error })
              filePaths.push('')
            }
          }
        }

        // 用 ||| 分隔多个 URL 和路径
        const combinedUrl = urls.join('|||')
        const combinedFilePath = filePaths.join('|||')

        this.log('多图片保存完成', { count: urls.length, filePaths: filePaths.length })

        return {
          url: combinedUrl,
          filePath: combinedFilePath,
          status: 'completed',
          metadata: response,
        }
      }

      // 单张图片或其他类型，使用基类逻辑
      const url = this.extractMediaUrl(response)

      if (!url) {
        throw createInvalidResponseError(
          this.providerName,
          response,
          'No media URL found in response'
        )
      }

      let filePath: string

      if (type === 'image') {
        const { fullPath } = await saveImageFromUrl(url)
        filePath = fullPath
      } else if (type === 'video') {
        const { fullPath } = await saveVideoFromUrl(url)
        filePath = fullPath
      } else if (type === 'audio') {
        const { fullPath } = await saveAudioFromUrl(url)
        filePath = fullPath
      } else {
        throw new Error(`Unsupported media type: ${type}`)
      }

      this.log('媒体文件已保存到本地', { url, filePath })

      return {
        url,
        filePath,
        status: 'completed',
        metadata: response,
      }
    } catch (error) {
      throw ProviderError.fromError(error, this.providerName)
    }
  }
}
