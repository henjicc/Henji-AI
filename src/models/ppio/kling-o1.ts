import { ParamDef } from '../../types/schema'

interface ParamValues {
  ppioKlingO1Mode?: string
  ppioKlingO1AspectRatio?: string
  uploadedImages?: string[]
  uploadedVideos?: string[]  // 新增：监听视频变化
}

/**
 * PPIO Kling O1 参数定义
 * 支持 4 种模式：文/图生视频、首尾帧、参考生视频、视频编辑
 */
export const ppioKlingO1Params: ParamDef[] = [
  // 模式选择
  {
    id: 'ppioKlingO1Mode',
    type: 'dropdown',
    label: '模式',
    defaultValue: 'text-image-to-video',
    // 根据上传的媒体自动切换模式
    autoSwitch: [
      {
        // 条件1：在文/图生视频模式下，上传2张图片时切换到首尾帧
        watchKeys: ['uploadedImages'],
        condition: (values: ParamValues) => {
          const { uploadedImages, ppioKlingO1Mode } = values
          const count = uploadedImages?.length || 0
          return ppioKlingO1Mode === 'text-image-to-video' && count === 2
        },
        value: 'start-end-frame'
      },
      {
        // 条件2：【关键修复】当有视频上传且在视频相关模式时，保持当前模式不变
        // 这防止了视频编辑/参考生视频模式被意外切换到其他模式
        watchKeys: ['uploadedVideos', 'uploadedImages'],
        condition: (values: ParamValues) => {
          const { uploadedVideos, ppioKlingO1Mode } = values
          const videoCount = uploadedVideos?.length || 0
          // 如果有视频且当前是视频相关模式，触发此规则保持模式不变
          return videoCount > 0 && (ppioKlingO1Mode === 'reference-to-video' || ppioKlingO1Mode === 'video-edit')
        },
        value: (values: ParamValues) => values.ppioKlingO1Mode  // 保持当前模式
      }
    ],
    options: [
      { value: 'text-image-to-video', label: '文/图生视频' },
      { value: 'start-end-frame', label: '首尾帧' },
      { value: 'reference-to-video', label: '参考生视频' },
      { value: 'video-edit', label: '视频编辑' }
    ],
    className: 'min-w-[120px]'
  },

  // 时长（根据模式显示不同选项）
  {
    id: 'ppioKlingO1VideoDuration',
    type: 'dropdown',
    label: '时长',
    defaultValue: 5,
    options: (values: ParamValues) => {
      const mode = values.ppioKlingO1Mode

      // 参考生视频支持 3-10 秒
      if (mode === 'reference-to-video') {
        return [
          { value: 3, label: '3s' },
          { value: 4, label: '4s' },
          { value: 5, label: '5s' },
          { value: 6, label: '6s' },
          { value: 7, label: '7s' },
          { value: 8, label: '8s' },
          { value: 9, label: '9s' },
          { value: 10, label: '10s' }
        ]
      }

      // 文/图生视频和首尾帧只支持 5 和 10 秒
      return [
        { value: 5, label: '5s' },
        { value: 10, label: '10s' }
      ]
    },
    hidden: (values: ParamValues) => {
      const mode = values.ppioKlingO1Mode
      // 视频编辑模式不支持 duration 参数，隐藏
      return mode === 'video-edit'
    }
  },

  // 宽高比（特殊面板，支持智能匹配）
  {
    id: 'ppioKlingO1AspectRatio',
    type: 'dropdown',
    defaultValue: '16:9',
    // 分辨率配置：启用智能匹配和可视化
    resolutionConfig: {
      type: 'aspect_ratio',
      smartMatch: true,
      visualize: true,
      extractRatio: (value: string) => {
        if (value === 'smart') return null
        const [w, h] = value.split(':').map(Number)
        return w / h
      }
    },
    // 自动切换逻辑：支持多个条件
    autoSwitch: [
      {
        // 条件1：在文/图生视频和首尾帧模式上传图片后自动切换到智能选项
        condition: (values: ParamValues) => {
          const mode = values.ppioKlingO1Mode || 'text-image-to-video'
          const imageCount = values.uploadedImages?.length || 0
          const currentRatio = values.ppioKlingO1AspectRatio
          // 文/图生视频或首尾帧模式下，有图片且当前不是智能时，切换到智能
          return (mode === 'text-image-to-video' || mode === 'start-end-frame') &&
            imageCount > 0 &&
            currentRatio !== 'smart'
        },
        value: 'smart',
        watchKeys: ['ppioKlingO1Mode', 'uploadedImages', 'uploadedVideos']
      },
      {
        // 条件2：切换到不支持智能选项的模式时，将智能重置为具体比例
        condition: (values: ParamValues) => {
          const mode = values.ppioKlingO1Mode || 'text-image-to-video'
          const currentRatio = values.ppioKlingO1AspectRatio
          // 当前是智能，但切换到了参考生视频或视频编辑模式（不支持智能）
          return currentRatio === 'smart' &&
            (mode === 'reference-to-video' || mode === 'video-edit')
        },
        value: '16:9',
        watchKeys: ['ppioKlingO1Mode', 'uploadedVideos']
      },
      {
        // 条件3：在文/图生视频或首尾帧模式下删除所有图片后，将智能重置为具体比例
        condition: (values: ParamValues) => {
          const mode = values.ppioKlingO1Mode || 'text-image-to-video'
          const imageCount = values.uploadedImages?.length || 0
          const currentRatio = values.ppioKlingO1AspectRatio
          // 文/图生视频或首尾帧模式下，当前是智能但没有图片时，重置为具体比例
          return (mode === 'text-image-to-video' || mode === 'start-end-frame') &&
            imageCount === 0 &&
            currentRatio === 'smart'
        },
        value: '16:9',
        watchKeys: ['uploadedImages', 'uploadedVideos']
      }
    ],
    // 根据模式和图片动态生成选项
    options: (values: ParamValues) => {
      const mode = values.ppioKlingO1Mode || 'text-image-to-video'
      const imageCount = values.uploadedImages?.length || 0

      // 文/图生视频模式
      if (mode === 'text-image-to-video') {
        // 有图片：显示智能选项
        if (imageCount > 0) {
          return [
            { value: 'smart', label: '智能' },
            { value: '16:9', label: '16:9' },
            { value: '9:16', label: '9:16' },
            { value: '1:1', label: '1:1' }
          ]
        }
        // 无图片：不显示智能选项
        return [
          { value: '16:9', label: '16:9' },
          { value: '9:16', label: '9:16' },
          { value: '1:1', label: '1:1' }
        ]
      }

      // 首尾帧模式：显示智能选项
      if (mode === 'start-end-frame') {
        return [
          { value: 'smart', label: '智能' },
          { value: '16:9', label: '16:9' },
          { value: '9:16', label: '9:16' },
          { value: '1:1', label: '1:1' }
        ]
      }

      // 参考生视频模式：不显示智能选项（因为有视频参考）
      if (mode === 'reference-to-video') {
        return [
          { value: '16:9', label: '16:9' },
          { value: '9:16', label: '9:16' },
          { value: '1:1', label: '1:1' }
        ]
      }

      // 默认选项
      return [
        { value: '16:9', label: '16:9' },
        { value: '9:16', label: '9:16' },
        { value: '1:1', label: '1:1' }
      ]
    },
    hidden: (values: ParamValues) => {
      const { ppioKlingO1Mode } = values
      // 视频编辑模式不支持宽高比参数，隐藏
      return ppioKlingO1Mode === 'video-edit'
    }
  },

  // 保留音频（仅视频模式）
  {
    id: 'ppioKlingO1KeepAudio',
    type: 'toggle',
    label: '保留音频',
    defaultValue: true,
    hidden: (values: ParamValues) => {
      const mode = values.ppioKlingO1Mode
      // 只有参考生视频和视频编辑支持
      return mode === 'text-image-to-video' || mode === 'start-end-frame'
    }
  },

  // 快速模式（仅视频编辑）
  {
    id: 'ppioKlingO1FastMode',
    type: 'toggle',
    label: '快速模式',
    defaultValue: false,
    hidden: (values: ParamValues) => {
      const mode = values.ppioKlingO1Mode
      // 只有视频编辑支持快速模式
      return mode !== 'video-edit'
    }
  }
]
