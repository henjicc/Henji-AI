import { ParamDef } from '../types/schema'

/**
 * Kling Video v2.6 Pro 参数定义
 * 支持文生视频和图生视频两种模式
 * 特性：原生音频生成、CFG Scale 调节
 */
export const falAiKlingVideoV26ProParams: ParamDef[] = [
  // 模式选择
  {
    id: 'falKlingV26ProMode',
    type: 'dropdown',
    label: '模式',
    defaultValue: 'text-image-to-video',
    options: [
      { value: 'text-image-to-video', label: '文/图生视频' },
      { value: 'motion-control', label: '动作控制' }
    ],
    className: 'min-w-[120px]'
  },

  // 分辨率（仅动作控制模式显示）
  {
    id: 'falKlingV26ProResolution',
    type: 'dropdown',
    label: '分辨率',
    defaultValue: '720p',
    resolutionConfig: {
      type: 'resolution',
      smartMatch: false,
      visualize: false
    },
    options: [
      { value: '720p', label: '720p' },
      { value: '1080p', label: '1080p' }
    ],
    hidden: (values) => values.falKlingV26ProMode !== 'motion-control'
  },

  // 角色方向（仅动作控制模式显示）
  {
    id: 'falKlingV26ProCharacterOrientation',
    type: 'dropdown',
    label: '人物朝向',
    defaultValue: 'video',
    tooltip: '默认为人物朝向与视频一致，此时角色动作/表情/运镜/朝向都会按照动作视频生成。可以通过提示词控制其他信息。最长支持30s生成时长。\n\n选择人物朝向与图片一致，此时角色动作/表情都会按照动作视频生成，朝向与图片中人物朝向一致，运镜及其他信息可以通过提示词自定义。最长支持10s生成时长。',
    options: [
      { value: 'video', label: '与视频一致' },
      { value: 'image', label: '与图片一致' }
    ],
    hidden: (values) => values.falKlingV26ProMode !== 'motion-control',
    description: 'video: 适合复杂动作 (max 30s); image: 适合跟随镜头 (max 10s)'
  },

  // 保留原声（仅动作控制模式显示）
  {
    id: 'falKlingV26ProKeepOriginalSound',
    type: 'toggle',
    label: '保留原声',
    defaultValue: true,
    hidden: (values) => values.falKlingV26ProMode !== 'motion-control'
  },

  // 时长
  {
    id: 'falKlingV26ProVideoDuration',
    type: 'dropdown',
    label: '时长',
    defaultValue: 5,
    options: [
      { value: 5, label: '5s' },
      { value: 10, label: '10s' }
    ],
    hidden: (values) => values.falKlingV26ProMode === 'motion-control'
  },

  // 宽高比（仅文生视频显示）
  {
    id: 'falKlingV26ProAspectRatio',
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
      // 动作控制模式不支持
      if (values.falKlingV26ProMode === 'motion-control') return true
      // 图生视频模式不支持宽高比参数（由输入图片决定）
      return values.uploadedImages && values.uploadedImages.length > 0
    }
  },

  // CFG Scale（仅文生视频显示）
  {
    id: 'falKlingV26ProCfgScale',
    type: 'number',
    label: 'CFG Scale',
    defaultValue: 0.5,
    min: 0,
    max: 1,
    step: 0.1,
    precision: 1,
    description: '控制模型对提示词的遵循程度',
    hidden: (values) => {
      // 动作控制模式不支持
      if (values.falKlingV26ProMode === 'motion-control') return true
      // 图生视频模式不支持 CFG Scale
      return values.uploadedImages && values.uploadedImages.length > 0
    }
  },

  // 音频生成
  {
    id: 'falKlingV26ProGenerateAudio',
    type: 'toggle',
    label: '生成音频',
    defaultValue: false,
    description: '支持中英文语音输出，其他语言自动翻译为英文',
    hidden: (values) => values.falKlingV26ProMode === 'motion-control'
  }
]
