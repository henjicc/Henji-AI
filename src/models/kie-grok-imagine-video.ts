import { ParamDef } from '../types/schema'

/**
 * KIE Grok Imagine 视频模型参数定义
 */
export const kieGrokImagineVideoParams: ParamDef[] = [
  // 宽高比参数（仅文生视频支持）
  {
    id: 'kieGrokImagineVideoAspectRatio',
    type: 'dropdown',
    defaultValue: '2:3',
    resolutionConfig: {
      type: 'aspect_ratio',
      smartMatch: false,  // Grok Imagine 视频不支持智能匹配
      visualize: true,
      extractRatio: (value) => {
        const [w, h] = value.split(':').map(Number)
        return w / h
      }
      // 注意：没有 qualityOptions，因为 Grok Imagine 视频不支持分辨率选择
    },
    options: [
      { value: '2:3', label: '2:3' },
      { value: '3:2', label: '3:2' },
      { value: '1:1', label: '1:1' }
    ],
    // 图生视频时隐藏比例参数（API 不支持）
    hidden: (values) => values.uploadedImages && values.uploadedImages.length > 0,
    className: 'min-w-[100px]'
  },
  // 模式参数
  {
    id: 'kieGrokImagineVideoMode',
    type: 'dropdown',
    label: '模式',
    defaultValue: 'normal',
    // 动态选项：图生视频时不显示 spicy（外部图像不支持）
    options: (values) => {
      const hasImages = values.uploadedImages && values.uploadedImages.length > 0

      if (hasImages) {
        // 图生视频：不支持 spicy
        return [
          { value: 'fun', label: 'Fun' },
          { value: 'normal', label: 'Normal' }
        ]
      }

      // 文生视频：支持所有模式
      return [
        { value: 'fun', label: 'Fun' },
        { value: 'normal', label: 'Normal' },
        { value: 'spicy', label: 'Spicy' }
      ]
    },
    className: 'min-w-[100px]'
  }
]
