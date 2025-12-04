import { ParamDef } from '../types/schema'

/**
 * Kling Video O1 参数定义
 * 支持 4 种模式：图生视频、参考生视频、视频编辑、视频参考
 */
export const klingVideoO1Params: ParamDef[] = [
  // 模式选择
  {
    id: 'klingMode',
    type: 'dropdown',
    label: '模式',
    defaultValue: 'image-to-video',
    options: [
      { value: 'image-to-video', label: '图生视频' },
      { value: 'reference-to-video', label: '参考生视频' },
      { value: 'video-to-video-edit', label: '视频编辑' },
      { value: 'video-to-video-reference', label: '视频参考' }
    ],
    className: 'min-w-[120px]'
  },

  // 时长
  {
    id: 'videoDuration',
    type: 'dropdown',
    label: '时长',
    defaultValue: 5,
    options: [
      { value: 5, label: '5s' },
      { value: 10, label: '10s' }
    ]
  },

  // 宽高比（仅部分模式显示）
  {
    id: 'klingAspectRatio',
    type: 'dropdown',
    label: '比例',
    defaultValue: '16:9',
    options: (values) => {
      const mode = values.klingMode
      // reference-to-video 和 video-to-video-reference 模式支持宽高比
      if (mode === 'video-to-video-reference' || mode === 'reference-to-video') {
        return [
          { value: 'auto', label: '自动' },
          { value: '16:9', label: '16:9' },
          { value: '9:16', label: '9:16' },
          { value: '1:1', label: '1:1' }
        ]
      }
      return []
    },
    hidden: (values) => {
      const mode = values.klingMode
      // image-to-video 和 video-to-video-edit 模式不支持宽高比参数
      return mode === 'image-to-video' || mode === 'video-to-video-edit'
    }
  },

  // 保留音频（仅视频模式显示）
  {
    id: 'klingKeepAudio',
    type: 'toggle',
    label: '保留音频',
    defaultValue: false,
    hidden: (values) => {
      const mode = values.klingMode
      // 只有视频编辑和视频参考模式支持保留音频
      return mode === 'image-to-video' || mode === 'reference-to-video'
    }
  }
]
