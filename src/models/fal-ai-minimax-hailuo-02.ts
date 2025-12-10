import { ParamDef } from '../types/schema'

/**
 * Fal.ai MiniMax Hailuo 02 模型参数定义
 * 支持 5 个端点：Standard/Pro Text-to-Video, Standard/Pro Image-to-Video, Fast Image-to-Video
 */
export const falAiMinimaxHailuo02Params: ParamDef[] = [
  // 1. 时长参数
  {
    id: 'falHailuo02Duration',
    type: 'dropdown',
    label: '时长',
    defaultValue: '6',
    options: (values) => {
      const resolution = values.falHailuo02Resolution
      return [
        { value: '6', label: '6s' },
        {
          value: '10',
          label: '10s',
          disabled: resolution === '1080P'  // Pro 不支持 10s
        }
      ]
    }
  },

  // 2. 分辨率参数
  {
    id: 'falHailuo02Resolution',
    type: 'dropdown',
    label: '分辨率',
    defaultValue: '768P',
    resolutionConfig: {
      type: 'resolution',
      smartMatch: false,
      visualize: false
    },
    // 自动切换规则
    autoSwitch: {
      condition: (values) => {
        // 快速模式开启时，自动切换到 512P
        if (values.falHailuo02FastMode) {
          return values.falHailuo02Resolution !== '512P'
        }
        // 时长为 10s 且分辨率为 1080P 时，自动切换到 768P
        if (values.falHailuo02Duration === '10' && values.falHailuo02Resolution === '1080P') {
          return true
        }
        return false
      },
      value: (values) => {
        if (values.falHailuo02FastMode) return '512P'
        if (values.falHailuo02Duration === '10') return '768P'
        return '768P'
      },
      noRestore: true  // 关闭快速模式时不自动恢复分辨率
    },
    options: (values) => {
      const fastMode = values.falHailuo02FastMode
      const duration = values.falHailuo02Duration

      return [
        {
          value: '512P',
          label: '512P'
        },
        {
          value: '768P',
          label: '768P',
          disabled: fastMode  // 快速模式只能 512P
        },
        {
          value: '1080P',
          label: '1080P',
          disabled: fastMode || duration === '10'  // 快速模式或 10s 不支持
        }
      ]
    }
  },

  // 3. 快速模式
  {
    id: 'falHailuo02FastMode',
    type: 'toggle',
    label: '快速模式',
    defaultValue: false,
    // 仅在上传 1 张图片时显示
    hidden: (values) => {
      const images = values.uploadedImages || []
      return images.length !== 1
    }
  },

  // 4. 提示词优化
  {
    id: 'falHailuo02PromptOptimizer',
    type: 'toggle',
    label: '提示词优化',
    defaultValue: true
  }
]
