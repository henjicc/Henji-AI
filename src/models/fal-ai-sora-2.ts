import { ParamDef } from '../types/schema'

/**
 * Fal.ai Sora 2 模型参数定义
 */
export const falAiSora2Params: ParamDef[] = [
  {
    id: 'soraMode',
    type: 'dropdown',
    label: '模式',
    defaultValue: 'standard',
    options: [
      { value: 'standard', label: '标准' },
      { value: 'pro', label: '专业' }
    ],
    className: 'min-w-[100px]'
  },
  {
    id: 'soraAspectRatio',
    type: 'dropdown',
    defaultValue: '16:9',
    // 分辨率配置：整合比例和分辨率到统一面板
    resolutionConfig: {
      type: 'aspect_ratio',
      smartMatch: true,
      visualize: true,
      extractRatio: (value) => {
        if (value === 'smart' || value === 'auto') return null
        const [w, h] = value.split(':').map(Number)
        return w / h
      },
      // 动态质量选项：根据模式显示不同的分辨率选项
      qualityOptions: (values) => {
        const mode = values.soraMode || 'standard'
        if (mode === 'standard') {
          // 标准模式：只有 720p
          return [{ value: '720p', label: '720P' }]
        } else {
          // 专业模式：720p 和 1080p
          return [
            { value: '720p', label: '720P' },
            { value: '1080p', label: '1080P' }
          ]
        }
      },
      qualityKey: 'soraResolution'
    },
    // 当上传图片时自动切换到智能选项
    autoSwitch: {
      condition: (values) => values.uploadedImages && values.uploadedImages.length > 0,
      value: 'smart'
    },
    // 比例选项（图生视频时包含智能选项）
    options: (values) => {
      const hasImages = values.uploadedImages && values.uploadedImages.length > 0

      const baseOptions = [
        { value: '16:9', label: '16:9' },
        { value: '9:16', label: '9:16' }
      ]

      // 图生视频时添加智能选项
      if (hasImages) {
        return [{ value: 'smart', label: '智能' }, ...baseOptions]
      }

      return baseOptions
    },
    className: 'min-w-[100px]'
  },
  {
    id: 'videoDuration',
    type: 'dropdown',
    label: '时长',
    defaultValue: 4,
    options: [
      { value: 4, label: '4s' },
      { value: 8, label: '8s' },
      { value: 12, label: '12s' }
    ]
  }
]
