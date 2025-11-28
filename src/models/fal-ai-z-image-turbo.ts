import { ParamDef } from '../types/schema'

// 预设最大像素数：1440*1440 = 2073600
const MAX_PIXELS = 2073600

// 计算每个比例在最大像素数限制下的最大尺寸
const calculateMaxSize = (widthRatio: number, heightRatio: number): { width: number; height: number } => {
  // 计算理想尺寸
  const ratio = widthRatio / heightRatio
  const height = Math.sqrt(MAX_PIXELS / ratio)
  const width = height * ratio

  // 取整到8的倍数（便于编码）
  const finalWidth = Math.floor(width / 8) * 8
  const finalHeight = Math.floor(height / 8) * 8

  return { width: finalWidth, height: finalHeight }
}

// 预计算所有比例的最大尺寸
export const presetSizes: Record<string, { width: number; height: number }> = {
  '21:9': calculateMaxSize(21, 9),
  '16:9': calculateMaxSize(16, 9),
  '3:2': calculateMaxSize(3, 2),
  '4:3': calculateMaxSize(4, 3),
  '1:1': { width: 1440, height: 1440 }, // 正方形直接使用 1440*1440
  '3:4': calculateMaxSize(3, 4),
  '2:3': calculateMaxSize(2, 3),
  '9:16': calculateMaxSize(9, 16),
  '9:21': calculateMaxSize(9, 21)
}

export const falAiZImageTurboParams: ParamDef[] = [
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
        // 处理比例格式 (如 "4:3", "16:9")
        if (value.includes(':')) {
          const [w, h] = value.split(':').map(Number)
          return w / h
        }

        // "自定义" 返回 null
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
    id: 'numInferenceSteps',
    type: 'number',
    label: '推理步数',
    min: 1,
    max: 30,
    step: 1,
    defaultValue: 8,
    widthClassName: 'w-24',
    tooltip: '推理步数越多，生成的图像越精细，但耗时也越长。建议值：8-15',
    tooltipDelay: 500
  },
  {
    id: 'numImages',
    type: 'number',
    label: '数量',
    min: 1,
    max: 4,
    step: 1,
    defaultValue: 1,
    widthClassName: 'w-20',
    tooltip: '生成图片的数量，最多支持4张。',
    tooltipDelay: 500
  },
  {
    id: 'enablePromptExpansion',
    type: 'toggle',
    label: '增强提示词',
    defaultValue: false,
    tooltip: '启用后会自动扩展和优化提示词，提高生成质量，但会增加成本。',
    tooltipDelay: 500
  },
  {
    id: 'acceleration',
    type: 'dropdown',
    label: '加速级别',
    defaultValue: 'none',
    options: [
      { value: 'none', label: '无加速' },
      { value: 'regular', label: '常规加速' },
      { value: 'high', label: '高级加速' }
    ]
  }
]