import { ParamDef } from '../types/schema'

// 魔搭API支持的分辨率范围
// SD系列: [64x64, 2048x2048]
// FLUX: [64x64, 1024x1024]
// Qwen-Image: [64x64, 1664x1664]
// 为了兼容性，我们使用保守的最大值 1024x1024

const MAX_PIXELS = 1024 * 1024 // 1048576

// 计算每个比例在最大像素数限制下的最大尺寸
const calculateMaxSize = (widthRatio: number, heightRatio: number): { width: number; height: number } => {
  const ratio = widthRatio / heightRatio
  const height = Math.sqrt(MAX_PIXELS / ratio)
  const width = height * ratio

  // 取整到8的倍数（便于编码）
  const finalWidth = Math.floor(width / 8) * 8
  const finalHeight = Math.floor(height / 8) * 8

  return { width: finalWidth, height: finalHeight }
}

// 预计算所有比例的最大尺寸
export const modelscopePresetSizes: Record<string, { width: number; height: number }> = {
  '21:9': calculateMaxSize(21, 9),
  '16:9': calculateMaxSize(16, 9),
  '3:2': calculateMaxSize(3, 2),
  '4:3': calculateMaxSize(4, 3),
  '1:1': { width: 1024, height: 1024 },
  '3:4': calculateMaxSize(3, 4),
  '2:3': calculateMaxSize(2, 3),
  '9:16': calculateMaxSize(9, 16),
  '9:21': calculateMaxSize(9, 21)
}

// 魔搭通用参数（所有模型共享）
export const modelscopeCommonParams: ParamDef[] = [
  {
    id: 'imageSize',
    type: 'dropdown',
    label: '分辨率',
    defaultValue: '1:1',
    resolutionConfig: {
      type: 'aspect_ratio',
      smartMatch: false,
      visualize: true,
      customInput: true,
      extractRatio: (value) => {
        if (value.includes(':')) {
          const [w, h] = value.split(':').map(Number)
          return w / h
        }
        if (value === '自定义') {
          return null
        }
        return null
      }
    },
    options: [
      { value: '21:9', label: '21:9' },
      { value: '16:9', label: '16:9' },
      { value: '3:2', label: '3:2' },
      { value: '4:3', label: '4:3' },
      { value: '1:1', label: '1:1' },
      { value: '3:4', label: '3:4' },
      { value: '2:3', label: '2:3' },
      { value: '9:16', label: '9:16' },
      { value: '9:21', label: '9:21' }
    ]
  },
  {
    id: 'steps',
    type: 'number',
    label: '采样步数',
    min: 1,
    max: 100,
    step: 1,
    defaultValue: 30,
    widthClassName: 'w-24',
    tooltip: '采样步数越多，生成的图像越精细，但耗时也越长。建议值：20-50',
    tooltipDelay: 500
  },
  {
    id: 'guidance',
    type: 'number',
    label: '提示词引导系数',
    min: 1.5,
    max: 20,
    step: 0.5,
    precision: 1,
    defaultValue: 7.5,
    widthClassName: 'w-24',
    tooltip: '控制生成结果与提示词的匹配程度。值越高，越严格遵循提示词。建议值：5-10',
    tooltipDelay: 500
  },
  {
    id: 'negativePrompt',
    type: 'text',
    label: '负面提示词',
    placeholder: '输入不希望出现的内容...',
    tooltip: '描述不希望在图像中出现的元素，如：lowres, bad anatomy, blurry',
    tooltipDelay: 500
  }
]

// 从 localStorage 加载自定义模型列表
const loadCustomModels = (): Array<{ id: string; name: string }> => {
  try {
    const stored = localStorage.getItem('modelscope_custom_models')
    if (stored) {
      return JSON.parse(stored)
    }
  } catch (e) {
    console.error('Failed to load custom models:', e)
  }
  return []
}

// 自定义模型专用参数（在通用参数基础上添加模型选择和管理按钮）
export const modelscopeCustomParams: ParamDef[] = [
  {
    id: 'modelscopeCustomModel',
    type: 'dropdown',
    label: '模型',
    defaultValue: '',
    options: (values) => {
      const customModels = loadCustomModels()
      if (customModels.length === 0) {
        return [{ value: '', label: '请先添加自定义模型' }]
      }
      return customModels.map(m => ({ value: m.id, label: m.name }))
    },
    placeholder: '选择模型'
  },
  ...modelscopeCommonParams
]
