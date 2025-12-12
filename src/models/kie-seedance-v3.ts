import { ParamDef } from '../types/schema'

/**
 * KIE Bytedance Seedance V3.0 参数定义
 *
 * 功能：
 * - 文生视频（0张图片）
 * - 图生视频（1张图片）
 * - 首尾帧（2张图片）
 *
 * 版本：
 * - Lite: bytedance/v1-lite-text-to-video, bytedance/v1-lite-image-to-video
 * - Pro: bytedance/v1-pro-text-to-video, bytedance/v1-pro-image-to-video
 * - Pro Fast: bytedance/v1-pro-fast-image-to-video (仅图生视频)
 */

export const kieSeedanceV3Params: ParamDef[] = [
  // 版本选择
  {
    id: 'kieSeedanceV3Version',
    type: 'dropdown',
    label: '版本',
    defaultValue: 'lite',
    options: [
      { value: 'lite', label: 'Lite' },
      { value: 'pro', label: 'Pro' }
    ],
    className: 'min-w-[100px]'
  },

  // 分辨率（宽高比 + 质量统一面板）
  {
    id: 'kieSeedanceV3AspectRatio',
    type: 'dropdown',
    label: '分辨率',
    defaultValue: '16:9',
    resolutionConfig: {
      type: 'aspect_ratio',
      smartMatch: false,
      visualize: true,
      extractRatio: (value) => {
        const [w, h] = value.split(':').map(Number)
        return w / h
      },
      // 动态质量选项：Pro 快速模式下禁用 480p
      qualityOptions: (values) => {
        const version = values?.kieSeedanceV3Version || 'lite'
        const fastMode = values?.kieSeedanceV3FastMode !== undefined ? values.kieSeedanceV3FastMode : true
        const hasImages = values?.uploadedImages && values.uploadedImages.length > 0

        // Pro 快速模式（图生视频）不支持 480p
        const disable480p = version === 'pro' && fastMode && hasImages

        return [
          { value: '480p', label: '480P', disabled: disable480p },
          { value: '720p', label: '720P' },
          { value: '1080p', label: '1080P' }
        ]
      },
      qualityKey: 'kieSeedanceV3Resolution',
      // 图生视频时隐藏宽高比选择器
      hideAspectRatio: (values) => {
        const hasImages = values?.uploadedImages && values.uploadedImages.length > 0
        return hasImages
      }
    },
    // 动态选项：根据版本显示不同的宽高比
    options: (values) => {
      const version = values?.kieSeedanceV3Version || 'lite'

      if (version === 'lite') {
        return [
          { value: '16:9', label: '16:9' },
          { value: '4:3', label: '4:3' },
          { value: '1:1', label: '1:1' },
          { value: '3:4', label: '3:4' },
          { value: '9:16', label: '9:16' },
          { value: '9:21', label: '9:21' }
        ]
      } else {
        // Pro 版本
        return [
          { value: '21:9', label: '21:9' },
          { value: '16:9', label: '16:9' },
          { value: '4:3', label: '4:3' },
          { value: '1:1', label: '1:1' },
          { value: '3:4', label: '3:4' },
          { value: '9:16', label: '9:16' }
        ]
      }
    },
    className: 'min-w-[100px]'
  },

  // 分辨率质量（隐藏参数，用于自动切换）
  {
    id: 'kieSeedanceV3Resolution',
    type: 'dropdown',
    label: '分辨率质量',
    defaultValue: '720p',
    options: [
      { value: '480p', label: '480P' },
      { value: '720p', label: '720P' },
      { value: '1080p', label: '1080P' }
    ],
    // 自动切换：Pro 快速模式下，如果选择了 480p，自动切换到 720p
    autoSwitch: {
      condition: (values) => {
        const version = values?.kieSeedanceV3Version || 'lite'
        const fastMode = values?.kieSeedanceV3FastMode !== undefined ? values.kieSeedanceV3FastMode : true
        const hasImages = values?.uploadedImages && values.uploadedImages.length > 0
        const currentResolution = values?.kieSeedanceV3Resolution || '720p'

        // Pro 快速模式（图生视频）且当前选择的是 480p
        return version === 'pro' && fastMode && hasImages && currentResolution === '480p'
      },
      value: '720p'
    },
    hidden: () => true,  // 始终隐藏，因为已经通过 resolutionConfig 显示
    className: 'min-w-[100px]'
  },

  // 时长
  {
    id: 'kieSeedanceV3Duration',
    type: 'dropdown',
    label: '时长',
    defaultValue: '5',
    options: [
      { value: '5', label: '5秒' },
      { value: '10', label: '10秒' }
    ],
    className: 'min-w-[100px]'
  },

  // 固定相机
  {
    id: 'kieSeedanceV3CameraFixed',
    type: 'toggle',
    label: '固定相机',
    defaultValue: false,
    className: 'w-auto'
  },

  // 快速模式（仅在 Pro 版本 + 图生视频时显示）
  {
    id: 'kieSeedanceV3FastMode',
    type: 'toggle',
    label: '快速模式',
    defaultValue: true,
    // 条件显示：仅在 Pro 版本且有上传图片时显示
    // hidden 返回 true 表示隐藏，false 表示显示
    hidden: (values) => {
      const version = values?.kieSeedanceV3Version || 'lite'
      const hasImages = values?.uploadedImages && values.uploadedImages.length > 0
      // 不是 Pro 或没有图片时隐藏
      return version !== 'pro' || !hasImages
    },
    className: 'w-auto'
  }
]
