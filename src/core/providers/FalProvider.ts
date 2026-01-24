/**
 * FalProvider - Fal 供应商实现
 *
 * 特性：
 * - 上传图片/视频到 Fal CDN
 * - 支持 sync_mode（fal.run）与异步（fal.subscribe）
 * - 自动保存生成结果到本地
 */

import { fal } from '@fal-ai/client'
import { ProviderHandler } from './base/ProviderHandler'
import { ModelDefinition } from '@/core/types'
import {
  ProviderError,
  ProviderErrorCode,
  createInvalidResponseError,
} from './base/errors'
import { GenerateResult } from './base/types'
import { isDataURI, isLocalPath, isRemoteURL } from './base/utils'
import { saveImageFromUrl, saveVideoFromUrl } from '@/utils/save'

type MediaValue = string | File

const IMAGE_KEYS = new Set([
  'image',
  'images',
  'image_url',
  'image_urls',
  'start_image_url',
  'end_image_url',
  'first_frame_image_url',
  'last_frame_image_url',
  'reference_image_urls',
  'input_urls',
])

const VIDEO_KEYS = new Set([
  'video',
  'video_url',
  'video_urls',
  'reference_video_urls',
])

/**
 * Fal Provider 类
 */
export class FalProvider extends ProviderHandler {
  /**
   * 构造函数
   *
   * @param apiKey - Fal API 密钥
   */
  constructor(apiKey: string) {
    super('fal', 'https://fal.run', apiKey, {
      timeout: 120000,
      options: { debug: true },
    })

    // 配置官方 fal 客户端
    fal.config({ credentials: apiKey })
  }

  /**
   * 预处理请求参数
   *
   * Fal 特定处理：
   * - 上传图片/视频到 Fal CDN
   * - 移除内部字段，避免污染 API 请求
   */
  protected async preprocessRequest(
    _model: ModelDefinition,
    params: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    const processedParams = { ...params }

    await this.transformMediaFields(processedParams, IMAGE_KEYS, (value) =>
      this.uploadToFalStorage(value, 'image')
    )

    await this.transformMediaFields(processedParams, VIDEO_KEYS, (value) =>
      this.uploadToFalStorage(value, 'video')
    )

    this.stripInternalFields(processedParams)
    return processedParams
  }

  /**
   * 后处理响应（Fal 已在 execute 中完成轮询）
   */
  protected async postprocessResponse(
    response: unknown,
    _model: ModelDefinition
  ): Promise<unknown> {
    return response
  }

  /**
   * 执行 Fal 请求
   *
   * - sync_mode: 使用 fal.run
   * - 否则：使用 fal.subscribe 自动轮询
   */
  protected async execute(endpoint: string, data: any): Promise<any> {
    const syncMode = data?.sync_mode === true
    const { sync_mode: _sync, ...input } = data || {}

    if (syncMode) {
      return await fal.run(endpoint, { input })
    }

    return await fal.subscribe(endpoint, {
      input,
      logs: false,
    })
  }

  /**
   * 从响应中提取媒体 URL（覆盖基类）
   */
  protected extractMediaUrl(response: any): string {
    const data = response?.data || response

    // 图片
    if (data?.images && Array.isArray(data.images) && data.images.length > 0) {
      const first = data.images[0]
      return typeof first === 'string' ? first : (first.url || '')
    }

    // 视频
    if (data?.video?.url) {
      return data.video.url
    }

    return (
      data?.url ||
      data?.image_url ||
      data?.video_url ||
      data?.output ||
      data?.result?.url ||
      ''
    )
  }

  /**
   * 保存媒体文件（支持多图）
   */
  protected async saveMedia(
    response: any,
    type: 'image' | 'video' | 'audio'
  ): Promise<GenerateResult> {
    if (type === 'image') {
      const data = response?.data || response
      const images = data?.images

      if (Array.isArray(images) && images.length > 1) {
        const urls: string[] = []
        const paths: string[] = []

        for (const img of images) {
          const url = typeof img === 'string' ? img : img?.url
          if (!url) continue
          urls.push(url)
          try {
            const { fullPath } = await saveImageFromUrl(url)
            paths.push(fullPath)
          } catch {
            paths.push('')
          }
        }

        return {
          url: urls.join('|||'),
          filePath: paths.join('|||'),
          status: 'completed',
          metadata: response,
        }
      }
    }

    const url = this.extractMediaUrl(response)
    if (!url) {
      throw createInvalidResponseError(
        this.providerName,
        response,
        'No media URL found in response'
      )
    }

    if (type === 'image') {
      const { fullPath } = await saveImageFromUrl(url)
      return { url, filePath: fullPath, status: 'completed', metadata: response }
    }

    if (type === 'video') {
      const { fullPath } = await saveVideoFromUrl(url)
      return { url, filePath: fullPath, status: 'completed', metadata: response }
    }

    throw new ProviderError(
      `Unsupported media type: ${type}`,
      this.providerName,
      ProviderErrorCode.VALIDATION_FAILED
    )
  }

  private async uploadToFalStorage(value: MediaValue, kind: 'image' | 'video'): Promise<string> {
    if (value instanceof File) {
      return await fal.storage.upload(value)
    }

    if (typeof value !== 'string') {
      throw new ProviderError(
        `Invalid ${kind} value`,
        this.providerName,
        ProviderErrorCode.VALIDATION_FAILED
      )
    }

    if (value.startsWith('http://asset.localhost/')) {
      const encodedPath = value.replace('http://asset.localhost/', '')
      const decodedPath = decodeURIComponent(encodedPath)
      const blob = await this.readLocalFile(decodedPath)
      return await fal.storage.upload(blob)
    }

    if (isRemoteURL(value)) {
      return value
    }

    if (isDataURI(value)) {
      const blob = this.dataURItoBlob(value)
      return await fal.storage.upload(blob)
    }

    if (isLocalPath(value)) {
      const blob = await this.readLocalFile(value)
      return await fal.storage.upload(blob)
    }

    return value
  }

  private async transformMediaFields(
    target: Record<string, unknown>,
    keys: Set<string>,
    transformer: (value: MediaValue) => Promise<string>
  ): Promise<void> {
    const entries = Object.entries(target)
    for (const [key, rawValue] of entries) {
      if (rawValue && typeof rawValue === 'object' && !Array.isArray(rawValue) && !(rawValue instanceof File)) {
        await this.transformMediaFields(rawValue as Record<string, unknown>, keys, transformer)
        continue
      }

      if (!keys.has(key)) {
        continue
      }

      if (Array.isArray(rawValue)) {
        const converted: string[] = []
        for (const item of rawValue) {
          if (typeof item === 'string' || item instanceof File) {
            converted.push(await transformer(item))
          }
        }
        target[key] = converted
        continue
      }

      if (typeof rawValue === 'string' || rawValue instanceof File) {
        target[key] = await transformer(rawValue)
      }
    }
  }

  private stripInternalFields(params: Record<string, unknown>): void {
    const internalFields = [
      'images',
      'videos',
      'uploadedImages',
      'uploadedVideos',
      'uploadedFilePaths',
      'uploadedVideoFilePaths',
      'editStateFile',
      'imageEditStates',
      'video',
    ]

    for (const key of internalFields) {
      if (key in params) {
        delete params[key]
      }
    }
  }
}

