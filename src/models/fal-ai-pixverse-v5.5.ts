import { ParamDef } from '../types/schema'

/**
 * Fal.ai Pixverse V5.5 模型参数定义
 */
export const falAiPixverseV55Params: ParamDef[] = [
  // 第一个参数：分辨率特殊面板（参考 Veo 3.1）
  {
    id: 'falPixverse55AspectRatio',
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
        { value: '360p', label: '360P' },
        { value: '540p', label: '540P' },
        { value: '720p', label: '720P' },
        { value: '1080p', label: '1080P' }
      ],
      qualityKey: 'pixverseResolution'
    },
    // 当上传图片时自动切换到智能选项
    autoSwitch: {
      condition: (values) => values.uploadedImages && values.uploadedImages.length > 0,
      value: 'smart',
      watchKeys: ['uploadedImages']  // 只监听图片数量变化，避免用户手动选择比例时被强制切换
    },
    // 根据上传图片动态生成选项
    options: (values) => {
      const hasImages = values.uploadedImages && values.uploadedImages.length > 0

      // 基础比例选项
      const baseOptions = [
        { value: '16:9', label: '16:9' },
        { value: '4:3', label: '4:3' },
        { value: '1:1', label: '1:1' },
        { value: '3:4', label: '3:4' },
        { value: '9:16', label: '9:16' }
      ]

      // 图生视频或首尾帧时添加智能选项
      if (hasImages) {
        return [{ value: 'smart', label: '智能' }, ...baseOptions]
      }

      return baseOptions
    },
    className: 'min-w-[100px]'
  },

  // 第二个参数：时长下拉框
  {
    id: 'falPixverse55VideoDuration',
    type: 'dropdown',
    label: '时长',
    defaultValue: 5,
    options: [
      { value: 5, label: '5s' },
      { value: 8, label: '8s' },
      { value: 10, label: '10s' }
    ]
  },

  // 第三个参数：风格下拉框
  {
    id: 'falPixverse55Style',
    type: 'dropdown',
    label: '风格',
    defaultValue: 'none',
    options: [
      { value: 'none', label: '无' },
      { value: 'anime', label: '动漫' },
      { value: '3d_animation', label: '3D动画' },
      { value: 'clay', label: '黏土' },
      { value: 'comic', label: '漫画' },
      { value: 'cyberpunk', label: '赛博朋克' }
    ]
  },

  // 第四个参数：思考模式下拉框
  {
    id: 'falPixverse55ThinkingType',
    type: 'dropdown',
    label: '思考模式',
    defaultValue: 'auto',
    options: [
      { value: 'auto', label: '自动' },
      { value: 'enabled', label: '启用' },
      { value: 'disabled', label: '禁用' }
    ],
    tooltip: '提示词优化模式：启用以优化提示词，禁用以关闭，自动让模型决定',
    tooltipDelay: 500
  },

  // 第五个参数：生成音频开关
  {
    id: 'falPixverse55GenerateAudio',
    type: 'toggle',
    label: '生成音频',
    tooltip: '启用音频生成（BGM、音效、对话）',
    tooltipDelay: 500
  },

  // 第六个参数：多镜头开关
  {
    id: 'falPixverse55MultiClip',
    type: 'toggle',
    label: '多镜头',
    tooltip: '启用多镜头生成，包含动态镜头变化',
    tooltipDelay: 500
  }
]
