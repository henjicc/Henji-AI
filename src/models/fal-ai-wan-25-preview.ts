import { ParamDef } from '../types/schema'

/**
 * Fal.ai Wan 2.5 Preview 模型参数定义
 *
 * 特点：
 * - 根据上传图片数量自动切换端点（0张→文生视频，1张→图生视频）
 * - 图生视频时只显示分辨率，文生视频时显示比例+分辨率
 * - 支持提示词扩展开关
 */
export const falAiWan25PreviewParams: ParamDef[] = [
  {
    id: 'falWan25VideoDuration',
    type: 'dropdown',
    label: '时长',
    defaultValue: 5,  // Wan 2.5 默认 5 秒
    options: [
      { value: 5, label: '5s' },
      { value: 10, label: '10s' }
    ]
  },
  {
    id: 'falWan25AspectRatio',
    type: 'dropdown',
    defaultValue: '16:9',
    // 分辨率配置：整合比例和分辨率到统一面板
    resolutionConfig: {
      type: 'aspect_ratio',
      smartMatch: false,  // Wan 2.5 不支持智能匹配
      visualize: true,
      extractRatio: (value) => {
        const [w, h] = value.split(':').map(Number)
        return w / h
      },
      qualityOptions: [
        { value: '480p', label: '480P' },
        { value: '720p', label: '720P' },
        { value: '1080p', label: '1080P' }
      ],
      qualityKey: 'wanResolution'
    },
    options: [
      { value: '16:9', label: '16:9' },
      { value: '9:16', label: '9:16' },
      { value: '1:1', label: '1:1' }
    ],
    // 图生视频时隐藏比例选项（只显示分辨率）
    hidden: (values) => values.uploadedImages && values.uploadedImages.length > 0,
    className: 'min-w-[100px]'
  },
  {
    id: 'falWan25Resolution',
    type: 'dropdown',
    defaultValue: '1080p',
    // 图生视频时单独显示分辨率
    resolutionConfig: {
      type: 'resolution',
      smartMatch: false,
      visualize: false
    },
    options: [
      { value: '480p', label: '480P' },
      { value: '720p', label: '720P' },
      { value: '1080p', label: '1080P' }
    ],
    // 只在图生视频时显示（文生视频时由 wanAspectRatio 的面板显示）
    hidden: (values) => !values.uploadedImages || values.uploadedImages.length === 0
  },
  {
    id: 'falWan25PromptExpansion',
    type: 'toggle',
    label: '提示词扩展',
    defaultValue: true
  }
]
