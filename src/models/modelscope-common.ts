import { ParamDef } from '../types/schema'

// 魔搭API支持的分辨率范围
// SD系列: [64x64, 2048x2048]
// FLUX: [64x64, 1024x1024]
// Qwen-Image: [64x64, 1664x1664]
// 默认使用 1024 作为基数，用户可以根据需要调整

// 注意：不再需要预计算尺寸，改用基于基数的动态计算
// 分辨率将根据用户设置的基数实时计算

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
      // 基数配置
      baseSize: 1440,              // 默认基数 1440（与 fal Z-Image-Turbo 保持一致）
      baseSizeEditable: true,      // 允许用户编辑
      baseSizeMin: 512,            // 最小 512
      baseSizeMax: 2048,           // 最大 2048（与 fal Z-Image-Turbo 保持一致）
      baseSizeStep: 8,             // 步进 8
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
    className: 'flex-1',
    inputClassName: 'w-full',
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

// 魔搭 Z-Image-Turbo 专用参数（移除 guidance，修改 steps 默认值）
export const modelscopeZImageTurboParams: ParamDef[] = [
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
      baseSize: 1440,
      baseSizeEditable: true,
      baseSizeMin: 512,
      baseSizeMax: 2048,
      baseSizeStep: 8,
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
    defaultValue: 10,  // Z-Image-Turbo 默认为 10
    widthClassName: 'w-24',
    tooltip: '采样步数越多，生成的图像越精细，但耗时也越长。建议值：8-20',
    tooltipDelay: 500
  },
  {
    id: 'negativePrompt',
    type: 'text',
    label: '负面提示词',
    placeholder: '输入不希望出现的内容...',
    className: 'flex-1',
    inputClassName: 'w-full',
    tooltip: '描述不希望在图像中出现的元素，如：lowres, bad anatomy, blurry',
    tooltipDelay: 500
  }
]

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
