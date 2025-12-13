import { ParamDef } from '../types/schema'

/**
 * Fal.ai Bytedance Seedance v1 模型参数定义
 * 支持 Lite 和 Pro 版本，支持文生视频、图生视频、参考生视频三种模式
 */
export const falAiBytedanceSeedanceV1Params: ParamDef[] = [
  {
    id: 'falSeedanceV1Mode',
    type: 'dropdown',
    label: '模式',
    defaultValue: 'text-to-video',
    options: [
      { value: 'text-to-video', label: '文生视频' },
      { value: 'image-to-video', label: '图生视频' },
      { value: 'reference-to-video', label: '参考生视频' }
    ],
    // 根据图片数量自动切换模式
    autoSwitch: {
      condition: (values) => {
        const imageCount = values.uploadedImages?.length || 0
        const currentMode = values.falSeedanceV1Mode || 'text-to-video'

        // 只有当前是文生视频模式，且上传了图片时，才切换到图生视频
        // 一旦切换到图生视频，就保持不变（不会自动恢复）
        return currentMode === 'text-to-video' && imageCount >= 1
      },
      value: 'image-to-video',
      noRestore: true  // 不自动恢复默认值
    },
    className: 'min-w-[120px]'
  },
  {
    id: 'falSeedanceV1Version',
    type: 'dropdown',
    label: '版本',
    defaultValue: 'lite',
    options: [
      { value: 'lite', label: 'Lite' },
      { value: 'pro', label: 'Pro' }
    ],
    className: 'min-w-[100px]'
  },
  {
    id: 'ppioSeedanceV1AspectRatio',
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
      qualityOptions: [
        { value: '480p', label: '480P' },
        { value: '720p', label: '720P' },
        { value: '1080p', label: '1080P' }
      ],
      qualityKey: 'seedanceResolution'
    },
    // 在图生视频和参考生视频模式下自动切换到智能选项
    autoSwitch: {
      condition: (values) => {
        const mode = values.falSeedanceV1Mode || 'text-to-video'
        // 图生视频或参考生视频模式下，自动切换到智能
        return mode === 'image-to-video' || mode === 'reference-to-video'
      },
      value: 'smart',
      watchKeys: ['falSeedanceV1Mode']  // 只监听模式变化，避免用户手动选择比例时被强制切换
    },
    // 根据模式和版本动态生成选项
    options: (values) => {
      const mode = values.falSeedanceV1Mode || 'text-to-video'
      const version = values.falSeedanceV1Version || 'lite'

      // 文生视频模式
      if (mode === 'text-to-video') {
        if (version === 'lite') {
          return [
            { value: '21:9', label: '21:9' },
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
      }

      // 图生视频模式：包含智能选项
      if (mode === 'image-to-video') {
        return [
          { value: 'smart', label: '智能' },
          { value: '21:9', label: '21:9' },
          { value: '16:9', label: '16:9' },
          { value: '4:3', label: '4:3' },
          { value: '1:1', label: '1:1' },
          { value: '3:4', label: '3:4' },
          { value: '9:16', label: '9:16' }
        ]
      }

      // 参考生视频模式：包含智能选项
      if (mode === 'reference-to-video') {
        return [
          { value: 'smart', label: '智能' },
          { value: '21:9', label: '21:9' },
          { value: '16:9', label: '16:9' },
          { value: '4:3', label: '4:3' },
          { value: '1:1', label: '1:1' },
          { value: '3:4', label: '3:4' },
          { value: '9:16', label: '9:16' }
        ]
      }

      return [
        { value: '16:9', label: '16:9' },
        { value: '9:16', label: '9:16' },
        { value: '1:1', label: '1:1' }
      ]
    },
    className: 'min-w-[100px]'
  },
  {
    id: 'falSeedanceV1VideoDuration',
    type: 'dropdown',
    label: '时长',
    defaultValue: 5,
    options: [
      { value: 2, label: '2s' },
      { value: 3, label: '3s' },
      { value: 4, label: '4s' },
      { value: 5, label: '5s' },
      { value: 6, label: '6s' },
      { value: 7, label: '7s' },
      { value: 8, label: '8s' },
      { value: 9, label: '9s' },
      { value: 10, label: '10s' },
      { value: 11, label: '11s' },
      { value: 12, label: '12s' }
    ]
  },
  {
    id: 'ppioSeedanceV1CameraFixed',
    type: 'toggle',
    label: '固定相机'
  },
  {
    id: 'falSeedanceV1FastMode',
    type: 'toggle',
    label: '快速模式',
    defaultValue: true,
    // 仅在 Pro 版本的文生视频和图生视频模式下显示
    hidden: (values) => {
      const version = values.falSeedanceV1Version || 'lite'
      const mode = values.falSeedanceV1Mode || 'text-to-video'
      return version !== 'pro' || mode === 'reference-to-video'
    }
  }
]
