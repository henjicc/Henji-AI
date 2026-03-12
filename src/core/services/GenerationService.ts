/**
 * GenerationService - unified AI runtime gateway.
 *
 * Frontend only prepares model params and delegates execution to Rust backend.
 */

import { registry } from '@/core/ModelRegistry'
import { createProgressTracker, resolveProgressSpec } from '@/core/progress/progressTracker'
import type { GenerateResult, ProgressStatus } from '@/core/providers/base'
import type { ProviderId } from '@/core/types'
import {
  aiCancelTask,
  aiGenerate,
  aiGetProviderKeyStatus,
  aiRemoveProviderApiKey,
  aiSetProviderApiKey,
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

function formatFailedMetadata(metadata: Record<string, unknown> | undefined): string {
  if (!metadata || Object.keys(metadata).length === 0) return ''
  try {
    return `: ${JSON.stringify(metadata)}`
  } catch {
    return ''
  }
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

      const response = await aiGenerate({
        modelId,
        params,
      })

      if (response.status !== 'completed') {
        throw new Error(`Generation ${response.status}${formatFailedMetadata(response.metadata)}`)
      }

      progressTracker?.complete()

      return {
        status: response.status,
        url: response.url,
        filePath: response.filePath,
        metadata: response.metadata,
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
