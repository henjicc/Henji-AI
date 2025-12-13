import { ParamDef } from '../types/schema'
import { logError } from '../utils/errorLogger'

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
    id: 'modelscopeImageSize',
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
    id: 'modelscopeSteps',
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
    id: 'modelscopeGuidance',
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
    id: 'modelscopeNegativePrompt',
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
const loadCustomModels = (): Array<{
  id: string
  name: string
  modelType: {
    imageGeneration: boolean
    imageEditing: boolean
  }
}> => {
  try {
    const stored = localStorage.getItem('modelscope_custom_models')
    if (stored) {
      const models = JSON.parse(stored)
      // 兼容旧数据：如果没有 modelType 字段，默认为图片生成
      return models.map((m: any) => ({
        ...m,
        modelType: m.modelType || { imageGeneration: true, imageEditing: false }
      }))
    }
  } catch (e) {
    logError('Failed to load custom models:', e)
  }
  return []
}

// 获取当前选中的自定义模型信息
const getCurrentCustomModel = (modelId: string) => {
  const models = loadCustomModels()
  return models.find(m => m.id === modelId)
}

// 魔搭 Z-Image-Turbo 专用参数（移除 guidance，修改 steps 默认值）
export const modelscopeZImageTurboParams: ParamDef[] = [
  {
    id: 'modelscopeImageSize',
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
    id: 'modelscopeSteps',
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
    id: 'modelscopeNegativePrompt',
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
    options: (_values: any) => {
      const customModels = loadCustomModels()
      if (customModels.length === 0) {
        return [{ value: '', label: '请先添加模型' }]
      }
      return customModels.map(m => ({ value: m.id, label: m.name }))
    },
    placeholder: '选择模型'
  },
  {
    id: 'modelscopeImageSize',
    type: 'dropdown',
    label: '分辨率',
    defaultValue: '1:1',
    resolutionConfig: {
      type: 'aspect_ratio',
      smartMatch: false,
      visualize: true,
      customInput: true,
      // 基数配置
      baseSize: 1440,
      baseSizeEditable: true,
      baseSizeMin: 512,
      baseSizeMax: 2048,
      baseSizeStep: 8,
      // 边界限制配置（新增）
      minSize: 64,   // 最小边长
      maxSize: 2048, // 最大边长
      extractRatio: (value) => {
        if (value === 'smart') return null
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
    options: (values) => {
      const baseOptions = [
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

      // 检查当前选中的模型是否支持图片编辑
      const currentModel = getCurrentCustomModel(values.modelscopeCustomModel)
      const supportsImageEditing = currentModel?.modelType?.imageEditing || false

      // 如果支持图片编辑，始终显示智能选项
      if (supportsImageEditing) {
        return [{ value: 'smart', label: '智能' }, ...baseOptions]
      }

      return baseOptions
    },
    // 选择图片编辑模型时自动切换到智能模式
    autoSwitch: {
      condition: (values) => {
        const currentModel = getCurrentCustomModel(values.modelscopeCustomModel)
        const supportsImageEditing = currentModel?.modelType?.imageEditing || false
        // 只要是图片编辑模型就切换到智能模式
        return supportsImageEditing
      },
      value: 'smart'
    }
  },
  {
    id: 'modelscopeSteps',
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
    id: 'modelscopeGuidance',
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
  }
]
