import { createLogger } from '@/core/logging'
import { nativeFetch } from '@/platform/desktopApi'

const logger = createLogger('services.modelscopeCustomModels.availability')

const LIST_PROVIDERS_ENDPOINT = 'https://www.modelscope.cn/api/v1/inference/list_model_providers'
const REQUEST_TIMEOUT_MS = 10000

/**
 * 魔搭 API-Inference 只覆盖平台挑选的一个子集，且官方明确说明「较早的模型可能逐渐下架」。
 * 模型在魔搭有页面 ≠ 支持 API-Inference 调用，必须查这个接口才能确定。
 *
 * 不支持的模型也能正常提交任务，但必然失败，所以要在用户保存自定义模型前就拦下来。
 */
export type ModelscopeAvailability =
  /** 确认支持 API-Inference */
  | { state: 'available'; costTier?: string; magicGrainCost?: number }
  /** 模型在魔搭存在，但没有开放 API-Inference（接口返回 Providers: null） */
  | { state: 'unavailable' }
  /**
   * 模型 ID 在魔搭查不到。接口对不存在的 ID 返回 HTTP 500（已用多个假 ID 复现），
   * 但 500 同时也是通用服务端错误码，所以文案要同时覆盖「拼错了」和「魔搭挂了」。
   */
  | { state: 'not-found' }
  /** 校验本身没跑成（断网、超时、其他非 2xx），无法判定 */
  | { state: 'unknown'; reason: string }

interface ListProvidersResponse {
  Data?: {
    Providers?: Array<{ CostTier?: unknown; EstimatedMagicGrainCost?: unknown }> | null
    TotalCount?: unknown
  } | null
  Success?: unknown
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined
}

function readNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

/**
 * 查询某个魔搭模型 ID 是否支持 API-Inference 调用。
 *
 * 判定失败（`unknown`）时调用方**不应该**当成"不支持"处理——校验跑不通是我们这边的
 * 问题，不该因此挡住用户；`unavailable` 与 `not-found` 才是应该拦下的结论。
 */
export async function checkModelscopeModelAvailability(
  modelId: string
): Promise<ModelscopeAvailability> {
  const trimmed = modelId.trim()
  if (!trimmed) {
    return { state: 'not-found' }
  }

  const url = `${LIST_PROVIDERS_ENDPOINT}?ModelId=${encodeURIComponent(trimmed)}`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

  try {
    const response = await nativeFetch(url, { method: 'GET', signal: controller.signal })
    if (response.status === 500) {
      // 魔搭对查不到的 ModelId 统一返回 500，而不是 404 或 200+空结果
      return { state: 'not-found' }
    }
    if (!response.ok) {
      return { state: 'unknown', reason: `HTTP ${response.status}` }
    }

    const payload = (await response.json()) as ListProvidersResponse
    const providers = payload?.Data?.Providers

    if (!Array.isArray(providers) || providers.length === 0) {
      return { state: 'unavailable' }
    }

    const first = providers[0]
    return {
      state: 'available',
      costTier: readString(first?.CostTier),
      magicGrainCost: readNumber(first?.EstimatedMagicGrainCost)
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    logger.warn('魔搭模型可用性校验未完成', { event: 'modelscope.availability.check_failed', modelId: trimmed, reason })
    return { state: 'unknown', reason }
  } finally {
    clearTimeout(timer)
  }
}
