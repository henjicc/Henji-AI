import { ParamDef } from '../types/schema'

/**
 * KIE Sora 2 模型参数定义
 *
 * 特点：
 * - 支持文生视频和图生视频（根据图片数量自动切换端点）
 * - 支持标准模式和专业模式（Pro）
 * - 标准模式：sora-2-text-to-video / sora-2-image-to-video
 * - 专业模式：sora-2-pro-text-to-video / sora-2-pro-image-to-video
 * - 最多支持 1 张图片
 * - 图生视频支持智能宽高比匹配
 * - 专业模式支持画质选择（标准/高）
 */
export const kieSora2Params: ParamDef[] = [
  {
    id: 'kieSora2Mode',
    type: 'dropdown',
    label: '模式',
    defaultValue: 'standard',
    options: [
      { value: 'standard', label: '标准' },
      { value: 'professional', label: '专业' }
    ],
    className: 'min-w-[80px]'
  },
  {
    id: 'kieSora2AspectRatio',
    type: 'dropdown',
    label: '比例',
    defaultValue: '16:9',
    resolutionConfig: {
      type: 'aspect_ratio',
      smartMatch: true,
      visualize: true,
      extractRatio: (value) => {
        if (value === 'smart') return null  // 智能匹配
        if (value === '16:9') return 16 / 9
        if (value === '9:16') return 9 / 16
        return 16 / 9  // 默认值
      }
    },
    // 动态选项：有图片时显示智能选项，无图片时隐藏
    options: (values) => {
      const hasImages = values.uploadedImages && values.uploadedImages.length > 0
      if (hasImages) {
        return [
          { value: 'smart', label: '智能' },
          { value: '16:9', label: '16:9' },
          { value: '9:16', label: '9:16' }
        ]
      }
      return [
        { value: '16:9', label: '16:9' },
        { value: '9:16', label: '9:16' }
      ]
    },
    // 自动切换：上传图片时自动切换到智能选项，删除图片时切换回16:9
    // 使用 watchKeys 只监听图片数量变化，避免用户手动选择比例时被强制切换
    autoSwitch: {
      condition: (values) => {
        const hasImages = values.uploadedImages && values.uploadedImages.length > 0
        const currentRatio = values.kieSora2AspectRatio

        // 情况1：有图片 + 当前是默认值（16:9）→ 切换到智能
        if (hasImages && currentRatio === '16:9') {
          return true
        }

        // 情况2：没有图片 + 当前是智能 → 切换回16:9
        if (!hasImages && currentRatio === 'smart') {
          return true
        }

        return false
      },
      value: (values: any) => {
        const hasImages = values.uploadedImages && values.uploadedImages.length > 0
        return hasImages ? 'smart' : '16:9'
      },
      watchKeys: ['uploadedImages']  // 只监听图片数量变化，不监听比例参数变化
    },
    className: 'min-w-[100px]'
  },
  {
    id: 'kieSora2Duration',
    type: 'dropdown',
    label: '时长',
    defaultValue: '10',
    options: [
      { value: '10', label: '10s' },
      { value: '15', label: '15s' }
    ],
    className: 'min-w-[80px]'
  },
  {
    id: 'kieSora2Quality',
    type: 'dropdown',
    label: '画质',
    defaultValue: 'standard',
    options: [
      { value: 'standard', label: '标准' },
      { value: 'high', label: '高' }
    ],
    // 只在专业模式下显示
    hidden: (values) => values.kieSora2Mode !== 'professional',
    className: 'min-w-[80px]'
  }
]
