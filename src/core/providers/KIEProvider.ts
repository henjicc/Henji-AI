/**
 * KIEProvider - KIE 供应商实现
 *
 * 特性：
 * - 上传图片/视频到 KIE CDN
 * - 异步任务轮询
 * - 自动保存生成结果到本地
 */

import axios, { AxiosInstance } from 'axios'
import { ProviderHandler } from './base/ProviderHandler'
import { ModelDefinition } from '@/core/types'
import {
  ProviderError,
  ProviderErrorCode,
  createInvalidResponseError,
} from './base/errors'
import { GenerateResult, PollingConfig, ProgressStatus } from './base/types'
import { isDataURI, isLocalPath, isRemoteURL } from './base/utils'
import {
  DEFAULT_INTERNAL_PROVIDER_FIELDS,
  stripInternalFields,
  transformMediaFields,
} from './base/paramTransforms'
import { saveImageFromUrl, saveVideoFromUrl } from '@/utils/save'

type MediaValue = string | File

const KIE_BASE_URL = 'https://api.kie.ai'
const KIE_UPLOAD_BASE_URL = 'https://kieai.redpandaai.co'
const CREATE_TASK_ENDPOINT = '/api/v1/jobs/createTask'
const STATUS_ENDPOINT = '/api/v1/jobs/recordInfo'
const FILE_UPLOAD_ENDPOINT = '/api/file-stream-upload'

const IMAGE_KEYS = new Set([
  'image',
  'images',
  'image_url',
  'image_urls',
  'image_input',
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
 * KIE Provider 类
 */
export class KIEProvider extends ProviderHandler {
  private uploadClient: AxiosInstance

  constructor(apiKey: string) {
    super('kie', KIE_BASE_URL, apiKey, {
      timeout: 120000,
      options: { debug: true },
    })

    this.uploadClient = axios.create({
      baseURL: KIE_UPLOAD_BASE_URL,
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    })
  }

  protected async preprocessRequest(
    _model: ModelDefinition,
    params: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    const processedParams = { ...params }

    await transformMediaFields(processedParams, IMAGE_KEYS, (value) =>
      this.uploadToKIE(value, 'image')
    )

    await transformMediaFields(processedParams, VIDEO_KEYS, (value) =>
      this.uploadToKIE(value, 'video')
    )

    stripInternalFields(processedParams, DEFAULT_INTERNAL_PROVIDER_FIELDS)
    return processedParams
  }

  protected async postprocessResponse(
    response: any,
    model: ModelDefinition
  ): Promise<any> {
    if (response?.code && response.code !== 200) {
      throw new ProviderError(
        response?.msg || 'KIE task creation failed',
        this.providerName,
        ProviderErrorCode.API_REQUEST_FAILED,
        { response }
      )
    }

    const taskId = response?.data?.taskId
    if (!taskId) {
      throw createInvalidResponseError(
        this.providerName,
        response,
        'No taskId in response'
      )
    }

    const polling: PollingConfig = model.meta.polling || {
      interval: 3000,
      maxAttempts: 200,
    }

    const result = await this.pollTaskStatus(taskId, polling, (id) =>
      this.checkKieStatus(id)
    )

    return result
  }

  protected async saveMedia(
    response: any,
    type: 'image' | 'video' | 'audio'
  ): Promise<GenerateResult> {
    const urls = response?.resultUrls

    if (Array.isArray(urls) && urls.length > 0) {
      if (type === 'image') {
        if (urls.length > 1) {
          const saved = await Promise.all(
            urls.map(async (url: string) => {
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
            metadata: response,
          }
        }

        const { fullPath } = await saveImageFromUrl(urls[0])
        return {
          url: urls[0],
          filePath: fullPath,
          status: 'completed',
          metadata: response,
        }
      }

      if (type === 'video') {
        const { fullPath } = await saveVideoFromUrl(urls[0])
        return {
          url: urls[0],
          filePath: fullPath,
          status: 'completed',
          metadata: response,
        }
      }
    }

    return super.saveMedia(response, type)
  }

  private async checkKieStatus(taskId: string): Promise<ProgressStatus> {
    const statusResponse = await this.get(STATUS_ENDPOINT, {
      params: { taskId },
    })

    if (statusResponse?.code && statusResponse.code !== 200) {
      throw new ProviderError(
        statusResponse?.msg || 'KIE status request failed',
        this.providerName,
        ProviderErrorCode.API_REQUEST_FAILED,
        { statusResponse }
      )
    }

    const statusData = statusResponse?.data
    const mappedStatus = this.mapKieStatus(statusData?.state)

    if (mappedStatus === 'COMPLETED') {
      if (statusData?.resultJson) {
        try {
          const parsed = JSON.parse(statusData.resultJson)
          return { status: 'COMPLETED', result: parsed }
        } catch {
          return { status: 'COMPLETED', result: {} }
        }
      }
      return { status: 'COMPLETED', result: {} }
    }

    if (mappedStatus === 'FAILED') {
      return {
        status: 'FAILED',
        error: statusData?.failMsg || 'Task failed',
      }
    }

    return { status: mappedStatus }
  }

  private mapKieStatus(state: string): ProgressStatus['status'] {
    const statusMap: Record<string, ProgressStatus['status']> = {
      waiting: 'IN_QUEUE',
      queuing: 'IN_QUEUE',
      generating: 'IN_PROGRESS',
      success: 'COMPLETED',
      fail: 'FAILED',
    }
    return statusMap[state] || 'IN_PROGRESS'
  }

  private async uploadToKIE(value: MediaValue, kind: 'image' | 'video'): Promise<string> {
    if (value instanceof File) {
      return await this.uploadFileToKIE(value, value.name || `${kind}.bin`)
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
      return await this.uploadFileToKIE(blob, `${kind}.bin`)
    }

    if (isRemoteURL(value)) {
      return value
    }

    if (isDataURI(value)) {
      const blob = this.dataURItoBlob(value)
      return await this.uploadFileToKIE(blob, `${kind}.bin`)
    }

    if (isLocalPath(value)) {
      const blob = await this.readLocalFile(value)
      return await this.uploadFileToKIE(blob, `${kind}.bin`)
    }

    return value
  }

  private async uploadFileToKIE(file: Blob, filename: string): Promise<string> {
    const formData = new FormData()
    formData.append('file', file, filename)
    formData.append('uploadPath', 'henji-uploads')

    const response = await this.uploadClient.post(FILE_UPLOAD_ENDPOINT, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })

    const data = response?.data?.data
    const fileUrl = data?.fileUrl || data?.downloadUrl

    if (!fileUrl) {
      throw new ProviderError(
        'KIE upload response missing file URL',
        this.providerName,
        ProviderErrorCode.UPLOAD_FAILED,
        { response: response?.data }
      )
    }

    return fileUrl
  }
}
