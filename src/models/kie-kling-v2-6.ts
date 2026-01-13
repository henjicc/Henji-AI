import { ParamDef } from '../types/schema'

/**
 * KIE Kling V2.6 视频模型参数定义
 */
export const kieKlingV26Params: ParamDef[] = [
  // 模式选择
  {
    id: 'kieKlingV26Mode',
    type: 'dropdown',
    label: '模式',
    defaultValue: 'text-image-to-video',
    options: [
      { value: 'text-image-to-video', label: '文/图生视频' },
      { value: 'motion-control', label: '动作控制' }
    ],
    className: 'min-w-[120px]'
  },
  // 宽高比参数（仅文生视频支持，图生视频和动作控制模式时隐藏）
  {
    id: 'kieKlingV26AspectRatio',
    type: 'dropdown',
    defaultValue: '16:9',
    resolutionConfig: {
      type: 'aspect_ratio',
      smartMatch: false,
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
    // 隐藏条件：上传了图片 OR 是动作控制模式
    hidden: (values) => {
      const isMotionControl = values.kieKlingV26Mode === 'motion-control'
      const hasImages = values.uploadedImages && values.uploadedImages.length > 0
      return isMotionControl || hasImages
    },
    className: 'min-w-[100px]'
  },
  // 分辨率（仅动作控制模式显示）- 使用面板形式
  {
    id: 'kieKlingV26Resolution',
    type: 'dropdown',
    label: '分辨率',
    defaultValue: '720p',
    // 分辨率配置：使用面板显示
    resolutionConfig: {
      type: 'resolution',
      smartMatch: false,
      visualize: false
    },
    options: [
      { value: '720p', label: '720p' },
      { value: '1080p', label: '1080p' }
    ],
    hidden: (values) => values.kieKlingV26Mode !== 'motion-control'
  },
  // 角色方向（仅动作控制模式显示）
  {
    id: 'kieKlingV26CharacterOrientation',
    type: 'dropdown',
    label: '人物朝向',
    defaultValue: 'video',
    tooltip: '默认为人物朝向与视频一致，此时角色动作/表情/运镜/朝向都会按照动作视频生成。可以通过提示词控制其他信息。最长支持30s生成时长。\n\n选择人物朝向与图片一致，此时角色动作/表情都会按照动作视频生成，朝向与图片中人物朝向一致，运镜及其他信息可以通过提示词自定义。最长支持10s生成时长。',
    options: [
      { value: 'video', label: '与视频一致' },
      { value: 'image', label: '与图片一致' }
    ],
    hidden: (values) => values.kieKlingV26Mode !== 'motion-control'
  },
  // 时长参数
  {
    id: 'kieKlingV26Duration',
    type: 'dropdown',
    label: '时长',
    defaultValue: '5',
    options: [
      { value: '5', label: '5秒' },
      { value: '10', label: '10秒' }
    ],
    hidden: (values) => values.kieKlingV26Mode === 'motion-control',
    className: 'min-w-[50px]'
  },
  // 音频生成开关
  {
    id: 'kieKlingV26EnableAudio',
    type: 'toggle',
    label: '生成音频',
    defaultValue: false,
    hidden: (values) => values.kieKlingV26Mode === 'motion-control'
  },
  // 以下参数不显示在UI中，但需要定义以防止意外显示
  {
    id: 'kieKlingV26Seed',
    type: 'number',
    label: '随机种子',
    hidden: () => true
  },
  {
    id: 'kieKlingV26NegativePrompt',
    type: 'text',
    label: '负面提示词',
    hidden: () => true
  },
  {
    id: 'kieKlingV26CfgScale',
    type: 'number',
    label: 'CFG Scale',
    hidden: () => true
  }
]
