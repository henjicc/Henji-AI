import { ParamDef } from '../types/schema'

/**
 * Fal.ai MiniMax Hailuo 2.3 模型参数定义
 * UI 显示分辨率（768P/1080P），实际映射到 standard/pro
 */
export const falAiMinimaxHailuo23Params: ParamDef[] = [
  {
    id: 'falHailuo23Duration',
    type: 'dropdown',
    label: '时长',
    defaultValue: '6',
    options: [
      { value: '6', label: '6s' },
      { value: '10', label: '10s' }
    ]
  },
  {
    id: 'falHailuo23Resolution',
    type: 'dropdown',
    label: '分辨率',
    defaultValue: '768P',
    // 分辨率配置：使用面板显示
    resolutionConfig: {
      type: 'resolution',
      smartMatch: false,
      visualize: false
    },
    // 自动切换规则：当时长为10秒且分辨率为1080P时，自动切换到768P
    autoSwitch: {
      condition: (values) => {
        return values.falHailuo23Duration === '10' && values.falHailuo23Resolution === '1080P'
      },
      value: () => '768P'
    },
    options: (values) => [
      { value: '768P', label: '768P' },
      { value: '1080P', label: '1080P', disabled: values.falHailuo23Duration !== '6' }
    ]
  },
  {
    id: 'falHailuo23FastMode',
    type: 'toggle',
    label: '快速模式',
    defaultValue: true,
    // 仅在上传图片时显示（图生视频才支持快速模式）
    hidden: (values) => !values.uploadedImages || values.uploadedImages.length === 0
  },
  {
    id: 'falHailuo23PromptOptimizer',
    type: 'toggle',
    label: '提示词优化',
    defaultValue: true
  }
]
