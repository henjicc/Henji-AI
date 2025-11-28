export const MODELSCOPE_CONFIG = {
  baseURL: 'https://api-inference.modelscope.cn',
  statusEndpoint: '/v1/tasks',
  pollInterval: 3000,
  maxPollAttempts: 120
} as const

// 预设模型列表（方便修改）
export const PRESET_MODELS = [
  { id: 'Tongyi-MAI/Z-Image-Turbo', name: 'Z-Image-Turbo' },
  { id: 'MusePublic/Qwen-image', name: 'Qwen-image' },
  { id: 'black-forest-labs/FLUX.1-Krea-dev', name: 'FLUX.1-Krea-dev' },
  { id: 'MusePublic/14_ckpt_SD_XL', name: '万象熔炉 | Anything XL' },
  { id: 'MusePublic/majicMIX_realistic', name: 'majicMIX realistic 麦橘写实' }
] as const
