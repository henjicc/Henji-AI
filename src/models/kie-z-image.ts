import { ParamDef } from '../types/schema'

export const kieZImageParams: ParamDef[] = [
  // 宽高比参数（仅比例选择，无分辨率选项）
  {
    id: 'kieZImageAspectRatio',
    type: 'dropdown',
    defaultValue: '1:1',
    resolutionConfig: {
      type: 'aspect_ratio',
      smartMatch: false,  // 不支持智能匹配（无图片上传）
      visualize: true,    // 显示可视化预览
      extractRatio: (value) => {
        const [w, h] = value.split(':').map(Number)
        return w / h
      }
      // 注意：无 qualityOptions 和 qualityKey（不支持分辨率选择）
    },
    options: [
      { value: '1:1', label: '1:1' },
      { value: '4:3', label: '4:3' },
      { value: '3:4', label: '3:4' },
      { value: '16:9', label: '16:9' },
      { value: '9:16', label: '9:16' }
    ],
    className: 'min-w-[100px]'
  }
]
