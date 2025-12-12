import { ParamDef } from '../types/schema'

export const kieGrokImagineParams: ParamDef[] = [
  // 宽高比参数（仅比例选择，无分辨率选项）
  {
    id: 'kieGrokImagineAspectRatio',
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
      { value: '2:3', label: '2:3' },
      { value: '3:2', label: '3:2' }
    ],
    className: 'min-w-[100px]'
  }
]
