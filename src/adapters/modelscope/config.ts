export const MODELSCOPE_CONFIG = {
  baseURL: 'https://api-inference.modelscope.cn',
  statusEndpoint: '/v1/tasks',
  pollInterval: 3000,
  maxPollAttempts: 120
} as const

// 预设模型列表（方便修改）
export const PRESET_MODELS = [
  { id: 'Tongyi-MAI/Z-Image-Turbo', name: 'Z-Image-Turbo' },
  { id: 'Qwen/Qwen-Image', name: 'Qwen-image' },
  { id: 'black-forest-labs/FLUX.1-Krea-dev', name: 'FLUX.1-Krea-dev' }
] as const
