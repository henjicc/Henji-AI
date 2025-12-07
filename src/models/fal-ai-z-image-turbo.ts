import { ParamDef } from '../types/schema'

// 注意：不再需要预计算尺寸，改用基于基数的动态计算
// 分辨率将根据用户设置的基数实时计算

export const falAiZImageTurboParams: ParamDef[] = [
  {
    id: 'falZImageTurboImageSize',
    type: 'dropdown',
    label: '分辨率',
    defaultValue: '1:1',
    resolutionConfig: {
      type: 'aspect_ratio',
      smartMatch: false,
      visualize: true,
      customInput: true,
      // 基数配置
      baseSize: 1440,              // 默认基数 1440
      baseSizeEditable: true,      // 允许用户编辑
      baseSizeMin: 512,            // 最小 512
      baseSizeMax: 2048,           // 最大 2048
      baseSizeStep: 8,             // 步进 8
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
    id: 'falZImageTurboNumInferenceSteps',
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
    id: 'falZImageTurboNumImages',
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
    id: 'falZImageTurboEnablePromptExpansion',
    type: 'toggle',
    label: '增强提示词',
    defaultValue: false,
    tooltip: '启用后会自动扩展和优化提示词，提高生成质量，但会增加成本。',
    tooltipDelay: 500
  },
  {
    id: 'falZImageTurboAcceleration',
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