/**
 * Fal 适配器配置
 */
export const FAL_CONFIG = {
  baseURL: 'https://queue.fal.run',
  pollInterval: 1000,
  queuePollInterval: 2000,
  maxPollAttempts: 120
} as const

/**
 * 不同模型的预估轮询次数
 */
export const MODEL_ESTIMATED_POLLS: Record<string, number> = {
  'nano-banana-pro': 30,
  'nano-banana': 10,
  'flux': 60,
  'veo3.1': 60
}

/**
 * 获取模型的预估轮询次数
 */
export function getEstimatedPolls(modelId: string): number {
  // 注意：先检查 pro 版本，因为它也包含 'nano-banana' 字符串
  if (modelId.includes('nano-banana-pro')) return MODEL_ESTIMATED_POLLS['nano-banana-pro']
  if (modelId.includes('nano-banana')) return MODEL_ESTIMATED_POLLS['nano-banana']
  if (modelId.includes('flux')) return MODEL_ESTIMATED_POLLS['flux']
  if (modelId.includes('veo3.1')) return MODEL_ESTIMATED_POLLS['veo3.1']
  return 40 // 默认值
}
