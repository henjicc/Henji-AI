import { ParamDef } from '../types/schema'

/**
 * Fal.ai MiniMax Hailuo 2.3 模型参数定义
 * 支持 Standard/Pro 版本，文生视频/图生视频，快速模式
 */
export const falAiMinimaxHailuo23Params: ParamDef[] = [
  {
    id: 'falHailuo23Version',
    type: 'dropdown',
    label: '版本',
    defaultValue: 'standard',
    options: [
      { value: 'standard', label: '标准 (768p)' },
      { value: 'pro', label: '专业 (1080p)' }
    ],
    className: 'min-w-[140px]'
  },
  {
    id: 'falHailuo23Duration',
    type: 'dropdown',
    label: '时长',
    defaultValue: '6',
    // 根据版本动态生成选项
    options: (values) => {
      const version = values.falHailuo23Version || 'standard'

      // Pro 版本：固定 6 秒（API 不支持 duration 参数）
      if (version === 'pro') {
        return [
          { value: '6', label: '6s' }
        ]
      }

      // Standard 版本：支持 6s 和 10s
      return [
        { value: '6', label: '6s' },
        { value: '10', label: '10s' }
      ]
    },
    className: 'min-w-[100px]'
  },
  {
    id: 'falHailuo23FastMode',
    type: 'toggle',
    label: '快速模式',
    defaultValue: true,
    // 仅在上传图片时显示（图生视频才支持快速模式）
    hidden: (values) => !values.uploadedImages || values.uploadedImages.length === 0,
    tooltip: '快速模式可以更快生成视频，但质量可能略有下降',
    tooltipDelay: 500
  },
  {
    id: 'falHailuo23PromptOptimizer',
    type: 'toggle',
    label: '提示词优化',
    defaultValue: true,
    tooltip: '使用模型的提示词优化器自动改进提示词',
    tooltipDelay: 500
  }
]
