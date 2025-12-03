/**
 * Fal 适配器配置
 * 迁移到官方 SDK 后，大部分轮询配置已由 SDK 内部处理
 */
export const FAL_CONFIG = {
  // 模型预估轮询次数（用于异步模式的进度计算）
  modelEstimatedPolls: {
    'fal-ai/z-image/turbo': 5,
    'fal-ai/bytedance/seedream/v4/text-to-image': 30,
    'fal-ai/bytedance/seedream/v4/edit': 30,
    'nano-banana-pro': 30,
    'nano-banana': 10,
    'veo3.1': 60,
    'kling-image-o1': 25
  } as Record<string, number>,

  // 默认预估轮询次数
  defaultEstimatedPolls: 20
} as const

/**
 * 获取模型的预估轮询次数
 */
export function getEstimatedPolls(modelId: string): number {
  // 精确匹配
  if (FAL_CONFIG.modelEstimatedPolls[modelId]) {
    return FAL_CONFIG.modelEstimatedPolls[modelId]
  }

  // 模糊匹配
  if (modelId.includes('z-image/turbo')) return FAL_CONFIG.modelEstimatedPolls['fal-ai/z-image/turbo']
  if (modelId.includes('seedream/v4')) return FAL_CONFIG.modelEstimatedPolls['fal-ai/bytedance/seedream/v4/text-to-image']
  if (modelId.includes('nano-banana-pro')) return FAL_CONFIG.modelEstimatedPolls['nano-banana-pro']
  if (modelId.includes('nano-banana')) return FAL_CONFIG.modelEstimatedPolls['nano-banana']
  if (modelId.includes('veo3.1')) return FAL_CONFIG.modelEstimatedPolls['veo3.1']
  if (modelId.includes('kling-image')) return FAL_CONFIG.modelEstimatedPolls['kling-image-o1']

  return FAL_CONFIG.defaultEstimatedPolls
}
