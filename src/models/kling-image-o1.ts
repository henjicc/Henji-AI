import { ParamDef } from '../types/schema'

/**
 * Kling Image O1 模型参数定义
 * 特点：必须有图片输入，融合 aspect_ratio 和 resolution
 */
export const klingImageO1Params: ParamDef[] = [
  {
    id: 'num_images',
    type: 'number',
    label: '数量',
    min: 1,
    max: 9,
    step: 1,
    widthClassName: 'w-20'
  },
  {
    id: 'aspectRatio',
    type: 'dropdown',
    defaultValue: '1:1',  // 无图时默认 1:1
    // 分辨率配置：启用智能匹配、可视化和质量选项
    resolutionConfig: {
      type: 'aspect_ratio',
      smartMatch: true,
      visualize: true,
      extractRatio: (value) => {
        if (value === 'auto') return null
        const [w, h] = value.split(':').map(Number)
        return w / h
      },
      qualityOptions: [
        { value: '1K', label: '1K' },
        { value: '2K', label: '2K' }
      ],
      qualityKey: 'resolution',  // Kling O1 使用 'resolution' 作为质量参数
      defaultQuality: '2K'  // 默认 2K
    },
    // 当上传图片时自动切换到 auto
    autoSwitch: {
      condition: (values) => values.uploadedImages && values.uploadedImages.length > 0,
      value: 'auto'
    },
    options: [
      { value: 'auto', label: '智能' },
      { value: '1:1', label: '1:1' },
      { value: '16:9', label: '16:9' },
      { value: '9:16', label: '9:16' },
      { value: '4:3', label: '4:3' },
      { value: '3:4', label: '3:4' },
      { value: '3:2', label: '3:2' },
      { value: '2:3', label: '2:3' },
      { value: '21:9', label: '21:9' }
    ],
    className: 'min-w-[100px]'
  }
]
