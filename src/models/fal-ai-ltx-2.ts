import { ParamDef } from '../types/schema'

/**
 * LTX-2 模型参数定义
 * 支持文生视频、图生视频、视频编辑三种模式
 */
export const falAiLtx2Params: ParamDef[] = [
  // 第一个参数：模式选择
  {
    id: 'falLtx2Mode',
    type: 'dropdown',
    label: '模式',
    defaultValue: 'text-to-video',
    // 根据上传的媒体自动切换模式
    autoSwitch: {
      condition: (values) => {
        if (values.uploadedVideos && values.uploadedVideos.length > 0) {
          return true
        }
        if (values.uploadedImages && values.uploadedImages.length > 0) {
          return true
        }
        return false
      },
      value: (values: any) => {
        if (values.uploadedVideos && values.uploadedVideos.length > 0) {
          return 'retake-video'
        }
        if (values.uploadedImages && values.uploadedImages.length > 0) {
          return 'image-to-video'
        }
        return 'text-to-video'
      }
    },
    options: [
      { value: 'text-to-video', label: '文生视频' },
      { value: 'image-to-video', label: '图生视频' },
      { value: 'retake-video', label: '视频编辑' }
    ],
    className: 'min-w-[120px]'
  },

  // 第二个参数：分辨率（只显示分辨率选择，不显示比例）
  {
    id: 'falLtx2Resolution',
    type: 'dropdown',
    label: '分辨率',
    defaultValue: '1080p',
    options: [
      { value: '1080p', label: '1080P' },
      { value: '1440p', label: '1440P' },
      { value: '2160p', label: '2160P' }
    ],
    // 视频编辑模式隐藏分辨率选项
    hidden: (values) => values.falLtx2Mode === 'retake-video',
    className: 'min-w-[100px]'
  },

  // 第三个参数：时长（视频编辑模式使用手动输入，其他模式使用下拉框）
  {
    id: 'falLtx2VideoDuration',
    type: 'dropdown',
    label: '时长',
    defaultValue: 6,
    // 根据模式动态生成选项
    options: (values) => {
      const mode = values.falLtx2Mode || 'text-to-video'

      // 视频编辑模式：不显示（使用单独的手动输入框）
      if (mode === 'retake-video') {
        return []
      }

      // 文生视频和图生视频：只有 6/8/10 秒（Fast 和 Pro 模式都一样）
      return [
        { value: 6, label: '6s' },
        { value: 8, label: '8s' },
        { value: 10, label: '10s' }
      ]
    },
    // 视频编辑模式隐藏下拉框
    hidden: (values) => values.falLtx2Mode === 'retake-video'
  },

  // 视频编辑模式的时长输入框（手动输入，整数步进）
  {
    id: 'falLtx2RetakeDuration',
    type: 'number',
    label: '时长',
    defaultValue: 5,
    min: 2,
    max: 20,
    step: 1,
    widthClassName: 'w-24',
    // 只在视频编辑模式下显示
    hidden: (values) => values.falLtx2Mode !== 'retake-video'
  },

  // 第四个参数：帧率
  {
    id: 'falLtx2Fps',
    type: 'dropdown',
    label: '帧率',
    defaultValue: 25,
    options: [
      { value: 25, label: '25 FPS' },
      { value: 50, label: '50 FPS' }
    ],
    // 视频编辑模式隐藏帧率选项
    hidden: (values) => values.falLtx2Mode === 'retake-video'
  },

  // 第五个参数：生成音频
  {
    id: 'falLtx2GenerateAudio',
    type: 'toggle',
    label: '生成音频',
    defaultValue: true,
    // 视频编辑模式隐藏音频选项
    hidden: (values) => values.falLtx2Mode === 'retake-video'
  },

  // 第六个参数：快速模式（仅在文生视频和图生视频模式下显示）
  {
    id: 'falLtx2FastMode',
    type: 'toggle',
    label: '快速模式',
    defaultValue: true,
    tooltip: '使用 Fast 端点，支持更长的时长（最长 20 秒）',
    tooltipDelay: 500,
    // 视频编辑模式隐藏快速模式选项
    hidden: (values) => values.falLtx2Mode === 'retake-video'
  },

  // 视频编辑模式的特殊参数：开始时间（整数步进）
  {
    id: 'falLtx2RetakeStartTime',
    type: 'number',
    label: '开始时间',
    defaultValue: 0,
    min: 0,
    max: 20,
    step: 1,
    widthClassName: 'w-24',
    // 只在视频编辑模式下显示
    hidden: (values) => values.falLtx2Mode !== 'retake-video'
  },

  // 视频编辑模式的特殊参数：编辑模式
  {
    id: 'falLtx2RetakeMode',
    type: 'dropdown',
    label: '编辑模式',
    defaultValue: 'replace_audio_and_video',
    options: [
      { value: 'replace_audio', label: '替换音频' },
      { value: 'replace_video', label: '替换视频' },
      { value: 'replace_audio_and_video', label: '替换音频和视频' }
    ],
    className: 'min-w-[140px]',
    // 只在视频编辑模式下显示
    hidden: (values) => values.falLtx2Mode !== 'retake-video'
  }
]
