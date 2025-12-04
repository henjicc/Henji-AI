import { ParamDef } from '../types/schema'

/**
 * Kling Video v2.6 Pro 参数定义
 * 支持文生视频和图生视频两种模式
 * 特性：原生音频生成、CFG Scale 调节
 */
export const falAiKlingVideoV26ProParams: ParamDef[] = [
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

  // 宽高比（仅文生视频显示）
  {
    id: 'klingV26AspectRatio',
    type: 'dropdown',
    label: '比例',
    defaultValue: '16:9',
    resolutionConfig: {
      type: 'aspect_ratio',
      smartMatch: false, // 无需智能选型
      visualize: true,
      extractRatio: (value) => {
        const [w, h] = value.split(':').map(Number)
        return w / h
      }
    },
    options: [
      { value: '16:9', label: '16:9' },
      { value: '9:16', label: '9:16' },
      { value: '1:1', label: '1:1' }
    ],
    hidden: (values) => {
      // 图生视频模式不支持宽高比参数（由输入图片决定）
      return values.uploadedImages && values.uploadedImages.length > 0
    }
  },

  // CFG Scale（仅文生视频显示）
  {
    id: 'klingV26CfgScale',
    type: 'number',
    label: 'CFG Scale',
    defaultValue: 0.5,
    min: 0,
    max: 1,
    step: 0.1,
    precision: 1,
    description: '控制模型对提示词的遵循程度',
    hidden: (values) => {
      // 图生视频模式不支持 CFG Scale
      return values.uploadedImages && values.uploadedImages.length > 0
    }
  },

  // 音频生成
  {
    id: 'klingV26GenerateAudio',
    type: 'toggle',
    label: '生成音频',
    defaultValue: true,
    description: '支持中英文语音输出，其他语言自动翻译为英文'
  }
]
