/**
 * GenerationService - unified AI runtime gateway.
 *
 * Frontend only prepares model params and delegates execution to Rust backend.
 */

import { registry } from '@/core/ModelRegistry'
import { findSquareAspectValue, getAspectChoiceParams, isSmartAspectValue, resolveClosestAspectValue } from '@/core/params/ratioResolution'
import { createProgressTracker, resolveProgressSpec } from '@/core/progress/progressTracker'
import type { GenerateResult, ProgressStatus } from '@/core/providers/base'
import type { ModelDefinition, ProviderId } from '@/core/types'
import { UploadService } from '@/services/upload/UploadService'
import { logInfo } from '@/utils/errorLogger'
import { recordApiTrace } from '@/utils/testMode'
import {
  aiCancelTask,
  aiContinuePolling,
  aiGenerate,
  aiGetProviderKeyStatus,
  aiRemoveProviderApiKey,
  aiSetProviderApiKey,
  type AiGenerateResponseDto,
  type ProviderKeyStatusDto,
} from '@/commands/aiRuntime'

/**
 * Backward-compatible type kept for API stability.
 */
export type ProviderFactory = never

function getErrorMessage(error: unknown): string {
  if (typeof error === 'string') {
    const trimmed = error.trim()
    return trimmed.length > 0 ? trimmed : 'Generation failed'
  }

  if (error instanceof Error) {
    return error.message
  }

  if (error && typeof error === 'object') {
    const record = error as Record<string, unknown>
    if (typeof record.message === 'string' && record.message.trim().length > 0) {
      return record.message
    }
  }

  return 'Generation failed'
}

function attachUploadRuntimeParams(params: Record<string, unknown>): Record<string, unknown> {
  const uploadService = UploadService.getInstance()
  const next = {
    ...params,
    __upload_provider: uploadService.getCurrentProvider(),
    __upload_fallback: uploadService.isFallbackEnabled(),
  }
  logInfo('[GenerationService] 上传策略', {
    provider: next.__upload_provider,
    fallbackEnabled: next.__upload_fallback,
  })
  return next
}

function formatFailedMetadata(metadata: Record<string, unknown> | undefined): string {
  if (!metadata || Object.keys(metadata).length === 0) return ''
  try {
    return `: ${JSON.stringify(metadata)}`
  } catch {
    return ''
  }
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

function getFirstImageSource(params: Record<string, unknown>): string | null {
  const candidates: unknown[] = [params.images, params.uploadedFilePaths]
  for (const candidate of candidates) {
    if (!isStringArray(candidate)) {
      continue
    }

    const first = candidate.find((item) => item.trim().length > 0)
    if (first) {
      return first
    }
  }

  return null
}

function resolveChoiceSmartAspectValues(
  model: ModelDefinition,
  params: Record<string, unknown>,
  hasReferenceImage: boolean,
  targetRatio: number
): void {
  const aspectParams = getAspectChoiceParams(model.params)
  for (const aspectParam of aspectParams) {
    const currentValue = params[aspectParam.id] ?? (
      aspectParam.apiField ? params[aspectParam.apiField] : undefined
    )

    if (!isSmartAspectValue(currentValue)) {
      continue
    }

    let resolvedValue = hasReferenceImage
      ? resolveClosestAspectValue(aspectParam, targetRatio)
      : findSquareAspectValue(aspectParam)

    if (resolvedValue === null) {
      resolvedValue = resolveClosestAspectValue(aspectParam, 1)
    }

    if (resolvedValue !== null) {
      params[aspectParam.id] = resolvedValue
      if (aspectParam.apiField) {
        params[aspectParam.apiField] = resolvedValue
      }
    }
  }
}

async function readImageRatio(imageSource: string): Promise<number | null> {
  if (typeof Image === 'undefined') {
    return null
  }

  return new Promise((resolve) => {
    const image = new Image()
    image.onload = () => {
      if (image.naturalWidth > 0 && image.naturalHeight > 0) {
        resolve(image.naturalWidth / image.naturalHeight)
        return
      }
      resolve(null)
    }
    image.onerror = () => resolve(null)
    image.src = imageSource
  })
}

async function normalizeSmartAspectParams(
  model: ModelDefinition,
  params: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const nextParams: Record<string, unknown> = { ...params }
  const firstImageSource = getFirstImageSource(nextParams)
  const imageRatio = firstImageSource ? await readImageRatio(firstImageSource) : null
  const hasReferenceImage = imageRatio !== null && Number.isFinite(imageRatio) && imageRatio > 0
  const targetRatio = hasReferenceImage ? imageRatio : 1

  if (hasReferenceImage) {
    nextParams.__firstImageRatio = targetRatio
  } else {
    delete nextParams.__firstImageRatio
  }

  resolveChoiceSmartAspectValues(model, nextParams, hasReferenceImage, targetRatio)

  return nextParams
}

function recordRuntimeTrace(
  modelId: string,
  params: Record<string, unknown>,
  trace: AiGenerateResponseDto['trace']
): void {
  if (!trace) {
    return
  }

  logInfo('[GenerationService] 实际 API 交互', trace)

  const prompt = typeof params.prompt === 'string'
    ? params.prompt
    : typeof params.text === 'string'
      ? params.text
      : undefined

  const model = registry.getModel(modelId)
  recordApiTrace({
    model: modelId,
    type: model?.meta.type,
    prompt,
    timestamp: new Date().toISOString(),
    trace
  })
}

export class GenerationService {
  private static instance: GenerationService | null = null

  private keyStatusCache: Map<string, boolean>

  private constructor() {
    this.keyStatusCache = new Map()
  }

  static getInstance(): GenerationService {
    if (!GenerationService.instance) {
      GenerationService.instance = new GenerationService()
    }
    return GenerationService.instance
  }

  async generate(
    modelId: string,
    params: Record<string, any>,
    onProgress?: (status: ProgressStatus) => void
  ): Promise<GenerateResult> {
    let progressTracker: ReturnType<typeof createProgressTracker> | null = null

    try {
      const model = registry.getModel(modelId)
      if (!model) {
        throw new Error(`Model not found: ${modelId}`)
      }

      const progressSpec = onProgress ? resolveProgressSpec(model, params as Record<string, unknown>) : null
      progressTracker = onProgress && progressSpec
        ? createProgressTracker(progressSpec, onProgress)
        : null
      progressTracker?.start()

      const normalizedParams = await normalizeSmartAspectParams(model, params as Record<string, unknown>)
      const response = await aiGenerate({
        modelId,
        params: attachUploadRuntimeParams(normalizedParams),
      })
      recordRuntimeTrace(modelId, params, response.trace)

      if (response.status !== 'completed') {
        throw new Error(`Generation ${response.status}${formatFailedMetadata(response.metadata)}`)
      }

      progressTracker?.complete()

      return {
        status: response.status,
        url: response.url,
        filePath: response.filePath,
        metadata: response.metadata,
        trace: response.trace,
      }
    } catch (error) {
      const message = getErrorMessage(error)
      progressTracker?.fail(message)
      throw new Error(`Generation failed for ${modelId}: ${message}`)
    }
  }

  async generateImage(
    modelId: string,
    params: Record<string, any>,
    onProgress?: (status: ProgressStatus) => void
  ): Promise<GenerateResult> {
    return this.generate(modelId, params, onProgress)
  }

  async generateVideo(
    modelId: string,
    params: Record<string, any>,
    onProgress?: (status: ProgressStatus) => void
  ): Promise<GenerateResult> {
    return this.generate(modelId, params, onProgress)
  }

  async generateAudio(
    modelId: string,
    params: Record<string, any>,
    onProgress?: (status: ProgressStatus) => void
  ): Promise<GenerateResult> {
    return this.generate(modelId, params, onProgress)
  }

  async continuePolling(
    modelId: string,
    taskId: string,
    params: Record<string, unknown> = {}
  ): Promise<GenerateResult> {
    try {
      const response = await aiContinuePolling({
        modelId,
        taskId,
        params,
      })
      recordRuntimeTrace(modelId, params, response.trace)

      if (response.status !== 'completed') {
        throw new Error(`Continue polling ${response.status}${formatFailedMetadata(response.metadata)}`)
      }

      return {
        status: response.status,
        url: response.url,
        filePath: response.filePath,
        metadata: response.metadata,
        trace: response.trace,
      }
    } catch (error) {
      const message = getErrorMessage(error)
      throw new Error(`Continue polling failed for ${modelId}: ${message}`)
    }
  }

  async setApiKey(provider: string, apiKey: string): Promise<void> {
    const trimmed = apiKey.trim()
    if (!trimmed) {
      await aiRemoveProviderApiKey(provider)
      this.keyStatusCache.set(provider, false)
      return
    }

    await aiSetProviderApiKey(provider, trimmed)
    this.keyStatusCache.set(provider, true)
  }

  async removeApiKey(provider: string): Promise<void> {
    await aiRemoveProviderApiKey(provider)
    this.keyStatusCache.set(provider, false)
  }

  async validateApiKey(provider: string): Promise<boolean> {
    const statusList = await aiGetProviderKeyStatus()
    this.syncKeyStatusCache(statusList)
    return this.keyStatusCache.get(provider) === true
  }

  async getConfiguredProviders(): Promise<string[]> {
    const statusList = await aiGetProviderKeyStatus()
    this.syncKeyStatusCache(statusList)
    return statusList.filter((item) => item.configured).map((item) => item.providerId)
  }

  async cancelTask(taskId: string): Promise<void> {
    await aiCancelTask(taskId)
  }

  registerProviderFactory(
    _providerId: ProviderId,
    _factory: ProviderFactory,
    _options?: { overwrite?: boolean }
  ): void {
    if (import.meta.env.DEV) {
      console.warn('[GenerationService] registerProviderFactory is deprecated in backend runtime mode')
    }
  }

  clearProviderCache(_provider?: string): void {
    // No-op: provider execution moved to backend runtime.
  }

  private syncKeyStatusCache(statusList: ProviderKeyStatusDto[]): void {
    this.keyStatusCache.clear()
    statusList.forEach((item) => {
      this.keyStatusCache.set(item.providerId, item.configured)
    })
  }

  static reset(): void {
    GenerationService.instance = null
  }
}

export const generationService = GenerationService.getInstance()
