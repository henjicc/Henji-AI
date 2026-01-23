/**
 * PPIOProvider - PPIO 供应商实现
 *
 * 特性：
 * - 所有图片转为 base64 格式
 * - 视频上传到 Fal CDN
 * - 异步任务轮询
 * - 自动保存上传文件路径
 */

import { ProviderHandler } from './base/ProviderHandler'
import { ModelDefinition } from '@/core/types'
import {
  ProviderError,
  ProviderErrorCode,
  createPollingTimeoutError,
} from './base/errors'
import { PollingConfig } from './base/types'

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
   * 2. 视频上传到 Fal CDN
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
    if (params.images && Array.isArray(params.images) && params.images.length > 0) {
      this.log('开始转换图片为 base64...', { count: params.images.length })

      try {
        processedParams.images = await this.convertImagesToBase64(params.images)

        // 保存图片文件路径（用于历史记录）
        const existingPaths = params.uploadedFilePaths || []
        processedParams.uploadedFilePaths = await this.saveUploadedFilePaths(
          processedParams.images,
          existingPaths
        )

        this.log('图片处理完成', {
          count: processedParams.images.length,
          paths: processedParams.uploadedFilePaths,
        })
      } catch (error) {
        this.log('图片处理失败', { error })
        throw ProviderError.fromError(error, this.providerName)
      }
    }

    // 2. 处理视频：上传到 Fal CDN（如果有）
    if (params.video) {
      this.log('检测到视频参数，开始处理...', {
        type: params.video instanceof File ? 'File' : 'string',
      })

      try {
        processedParams.video = await this.uploadVideoToFalCDN(params.video)

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
   * 上传视频到 Fal CDN
   *
   * 处理逻辑：
   * - 如果已经是 http(s) URL → 直接返回
   * - 如果是 File 对象 → 上传到 Fal CDN
   * - 其他 → 抛出错误
   *
   * @param video - 视频（File 对象或 URL 字符串）
   * @returns Promise<视频 URL>
   */
  private async uploadVideoToFalCDN(video: File | string): Promise<string> {
    // 1. 如果已经是 URL，直接返回
    if (typeof video === 'string' && video.startsWith('http')) {
      this.log('视频已经是 URL，直接使用', { url: video })
      return video
    }

    // 2. 上传 File 对象到 Fal CDN
    if (video instanceof File) {
      const falApiKey = this.getFalApiKey()
      if (!falApiKey) {
        throw new ProviderError(
          'Fal API 密钥未配置（视频上传需要 Fal CDN）',
          this.providerName,
          ProviderErrorCode.API_KEY_MISSING
        )
      }

      try {
        const fal = await import('@fal-ai/client')
        fal.config({ credentials: falApiKey })

        this.log('开始上传视频到 Fal CDN...', {
          name: video.name,
          size: video.size,
          type: video.type,
        })

        const url = await fal.storage.upload(video)

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
}
