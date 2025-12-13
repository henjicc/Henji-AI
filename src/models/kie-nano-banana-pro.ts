import { ParamDef } from '../types/schema'

export const kieNanoBananaProParams: ParamDef[] = [
  // 宽高比参数（带智能匹配和分辨率选择）
  {
    id: 'kieNanoBananaAspectRatio',
    type: 'dropdown',
    defaultValue: '1:1',
    resolutionConfig: {
      type: 'aspect_ratio',
      smartMatch: true,
      visualize: true,
      extractRatio: (value) => {
        if (value === 'smart') return null
        const [w, h] = value.split(':').map(Number)
        return w / h
      },
      qualityOptions: [
        { value: '1K', label: '1K' },
        { value: '2K', label: '2K' },
        { value: '4K', label: '4K' }
      ],
      qualityKey: 'kieNanoBananaResolution'
    },
    // 当上传图片时自动切换到智能选项
    autoSwitch: {
      condition: (values) => values.uploadedImages && values.uploadedImages.length > 0,
      value: 'smart',
      watchKeys: ['uploadedImages']  // 只监听图片数量变化，避免用户手动选择比例时被强制切换
    },
    options: [
      { value: 'smart', label: '智能' },
      { value: '1:1', label: '1:1' },
      { value: '2:3', label: '2:3' },
      { value: '3:2', label: '3:2' },
      { value: '3:4', label: '3:4' },
      { value: '4:3', label: '4:3' },
      { value: '4:5', label: '4:5' },
      { value: '5:4', label: '5:4' },
      { value: '9:16', label: '9:16' },
      { value: '16:9', label: '16:9' },
      { value: '21:9', label: '21:9' }
    ],
    className: 'min-w-[100px]'
  }
]
