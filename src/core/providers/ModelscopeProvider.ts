/**
 * ModelscopeProvider - 魔搭（ModelScope）供应商实现
 *
 * 特性：
 * - 通过 Tauri invoke 调用后端接口
 * - 图片编辑需要先上传到通用文件上传服务
 * - 异步任务轮询
 */

import { invoke } from '@tauri-apps/api/core'
import { ProviderHandler } from './base/ProviderHandler'
import { ModelDefinition } from '@/core/types'
import {
  ProviderError,
  ProviderErrorCode,
  createInvalidResponseError
} from './base/errors'
import { GenerateResult, PollingConfig, ProgressStatus } from './base/types'
import { UploadService } from '@/services/upload/UploadService'
import { isDataURI, isLocalPath } from './base/utils'
import { saveImageFromUrl } from '@/utils/save'

interface ModelscopeTaskResponse {
  task_id: string
  request_id: string
}

interface ModelscopeTaskStatus {
  task_status: string
  output_images?: string[]
  request_id: string
}

export class ModelscopeProvider extends ProviderHandler {
  constructor(apiKey: string) {
    super('modelscope', 'https://api-inference.modelscope.cn', apiKey, {
      timeout: 120000,
      options: { debug: true }
    })
  }

  protected async preprocessRequest(
    _model: ModelDefinition,
    // NOTE: 保持与 ProviderHandler 签名一致（Record<string, any>）
    params: Record<string, any>
  ): Promise<Record<string, any>> {
    const processed = { ...params }

    const imageValues: Array<string | File | Blob> = []

    if (Array.isArray(params.image_url)) {
      imageValues.push(...params.image_url)
    }

    if (Array.isArray(params.image_urls)) {
      imageValues.push(...params.image_urls)
    }

    if (Array.isArray(params.images)) {
      imageValues.push(...params.images)
    }

    if (params.image) {
      imageValues.push(params.image)
    }

    if (imageValues.length > 0) {
      const uploaded: string[] = []
      for (const item of imageValues) {
        uploaded.push(await this.uploadImageToGeneralUpload(item))
      }
      processed.image_url = uploaded
    }

    this.stripInternalFields(processed)
    return processed
  }

  protected async postprocessResponse(
    response: ModelscopeTaskResponse,
    model: ModelDefinition
  ): Promise<ModelscopeTaskStatus> {
    const taskId = response?.task_id
    if (!taskId) {
      throw createInvalidResponseError(
        this.providerName,
        response,
        'No task_id in response'
      )
    }

    const polling: PollingConfig = model.meta.polling || {
      interval: 3000,
      maxAttempts: 120
    }

    const result = await this.pollTaskStatus<ModelscopeTaskStatus>(taskId, polling, (id) =>
      this.checkModelscopeStatus(id)
    )

    return result
  }

  protected async saveMedia(
    response: ModelscopeTaskStatus,
    type: 'image' | 'video' | 'audio'
  ): Promise<GenerateResult> {
    const urls = response?.output_images

    if (type === 'image' && Array.isArray(urls) && urls.length > 0) {
      if (urls.length > 1) {
        const saved = await Promise.all(
          urls.map(async (url) => {
            try {
              const { fullPath } = await saveImageFromUrl(url)
              return { url, filePath: fullPath }
            } catch {
              return { url, filePath: '' }
            }
          })
        )

        return {
          url: saved.map((item) => item.url).join('|||'),
          filePath: saved.map((item) => item.filePath).join('|||'),
          status: 'completed',
          metadata: response
        }
      }

      const { fullPath } = await saveImageFromUrl(urls[0])
      return {
        url: urls[0],
        filePath: fullPath,
        status: 'completed',
        metadata: response
      }
    }

    return super.saveMedia(response, type)
  }

  protected async execute(
    _endpoint: string,
    // NOTE: 保持与 ProviderHandler 签名一致（data: any）
    data: any
  ): Promise<any> {
    try {
      return await invoke<ModelscopeTaskResponse>('modelscope_submit_task', {
        apiKey: this.apiKey,
        request: data
      })
    } catch (error: any) {
      throw new ProviderError(
        `ModelScope submit failed: ${error?.message || error}`,
        this.providerName,
        ProviderErrorCode.API_REQUEST_FAILED,
        { error }
      )
    }
  }

  private async checkModelscopeStatus(taskId: string): Promise<ProgressStatus> {
    const status = await invoke<ModelscopeTaskStatus>('modelscope_check_status', {
      apiKey: this.apiKey,
      taskId
    })

    const mapped = this.mapModelscopeStatus(status.task_status)

    if (mapped === 'COMPLETED') {
      return { status: 'COMPLETED', result: status }
    }

    if (mapped === 'FAILED') {
      return { status: 'FAILED', error: status.task_status }
    }

    return { status: mapped }
  }

  private mapModelscopeStatus(status: string): ProgressStatus['status'] {
    const map: Record<string, ProgressStatus['status']> = {
      PENDING: 'IN_QUEUE',
      QUEUED: 'IN_QUEUE',
      RUNNING: 'IN_PROGRESS',
      PROCESSING: 'IN_PROGRESS',
      SUCCEED: 'COMPLETED',
      FAILED: 'FAILED'
    }

    return map[status] || 'IN_PROGRESS'
  }

  private async uploadImageToGeneralUpload(value: string | File | Blob): Promise<string> {
    const uploadService = UploadService.getInstance()

    if (value instanceof File || value instanceof Blob) {
      return uploadService.uploadFile(value, value instanceof File ? value.name : 'image.png')
    }

    if (typeof value !== 'string') {
      throw new ProviderError(
        'Invalid image value',
        this.providerName,
        ProviderErrorCode.VALIDATION_FAILED
      )
    }

    if (value.startsWith('http://asset.localhost/')) {
      const encodedPath = value.replace('http://asset.localhost/', '')
      const decodedPath = decodeURIComponent(encodedPath)
      const blob = await this.readLocalFile(decodedPath)
      return uploadService.uploadFile(blob, 'image.png')
    }

    if (value.startsWith('http://tauri.localhost/')) {
      const encodedPath = value.replace('http://tauri.localhost/', '')
      const decodedPath = decodeURIComponent(encodedPath)
      const blob = await this.readLocalFile(decodedPath)
      return uploadService.uploadFile(blob, 'image.png')
    }

    if (value.startsWith('http')) {
      return value
    }

    if (isDataURI(value)) {
      const blob = this.dataURItoBlob(value)
      return uploadService.uploadFile(blob, 'image.png')
    }

    if (isLocalPath(value)) {
      const blob = await this.readLocalFile(value)
      return uploadService.uploadFile(blob, 'image.png')
    }

    return uploadService.uploadFile(value, 'image.png')
  }

  private stripInternalFields(params: Record<string, any>): void {
    const internalFields = [
      'images',
      'image',
      'image_urls',
      'uploadedImages',
      'uploadedFilePaths',
      'uploadedVideos',
      'uploadedVideoFilePaths'
    ]

    for (const key of internalFields) {
      if (key in params) {
        delete params[key]
      }
    }
  }
}
