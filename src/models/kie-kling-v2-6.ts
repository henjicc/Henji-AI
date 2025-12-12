import { ParamDef } from '../types/schema'

/**
 * KIE Kling V2.6 视频模型参数定义
 */
export const kieKlingV26Params: ParamDef[] = [
  // 宽高比参数（仅文生视频支持，图生视频时隐藏）
  {
    id: 'kieKlingV26AspectRatio',
    type: 'dropdown',
    defaultValue: '16:9',
    resolutionConfig: {
      type: 'aspect_ratio',
      smartMatch: false,  // Kling V2.6 不支持智能匹配
      visualize: true,
      extractRatio: (value) => {
        const [w, h] = value.split(':').map(Number)
        return w / h
      }
      // 注意：没有 qualityOptions，因为 Kling V2.6 不支持分辨率选择
    },
    options: [
      { value: '16:9', label: '16:9' },
      { value: '9:16', label: '9:16' },
      { value: '1:1', label: '1:1' }
    ],
    // 图生视频时隐藏比例参数（API 不支持）
    hidden: (values) => values.uploadedImages && values.uploadedImages.length > 0,
    className: 'min-w-[100px]'
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
    className: 'min-w-[100px]'
  },
  // 音频生成开关
  {
    id: 'kieKlingV26EnableAudio',
    type: 'toggle',
    label: '生成音频',
    defaultValue: false
  },
  // 以下参数不显示在UI中，但需要定义以防止意外显示
  {
    id: 'kieKlingV26Seed',
    type: 'number',
    label: '随机种子',
    hidden: () => true  // 始终隐藏
  },
  {
    id: 'kieKlingV26NegativePrompt',
    type: 'text',
    label: '负面提示词',
    hidden: () => true  // 始终隐藏
  },
  {
    id: 'kieKlingV26CfgScale',
    type: 'number',
    label: 'CFG Scale',
    hidden: () => true  // 始终隐藏
  }
]
