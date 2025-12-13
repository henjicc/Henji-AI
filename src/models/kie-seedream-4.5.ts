import { ParamDef } from '../types/schema'

/**
 * KIE Seedream 4.5 模型参数定义
 *
 * 特点：
 * - 不传递具体分辨率数值，只传递宽高比和质量
 * - 质量选项：2K (basic) / 4K (high)
 * - 根据图片数量自动切换端点（文生图/图片编辑）
 * - 最多支持 14 张图片
 * - 隐藏参数：seed, negative_prompt
 */
export const kieSeedream45Params: ParamDef[] = [
  // 宽高比参数（带智能匹配和质量选择）
  {
    id: 'kieSeedreamAspectRatio',
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
        { value: '2K', label: '高清 2K' },
        { value: '4K', label: '超清 4K' }
      ],
      qualityKey: 'kieSeedreamQuality'
    },
    // 自动切换：上传图片时切换到智能，删除图片时恢复为 1:1
    autoSwitch: {
      condition: (values) => values.uploadedImages && values.uploadedImages.length > 0,
      value: 'smart',
      watchKeys: ['uploadedImages']  // 只监听图片数量变化，避免用户手动选择比例时被强制切换
    },
    options: [
      { value: 'smart', label: '智能' },
      { value: '1:1', label: '1:1' },
      { value: '4:3', label: '4:3' },
      { value: '3:4', label: '3:4' },
      { value: '16:9', label: '16:9' },
      { value: '9:16', label: '9:16' },
      { value: '2:3', label: '2:3' },
      { value: '3:2', label: '3:2' },
      { value: '21:9', label: '21:9' }
    ],
    className: 'min-w-[100px]'
  }
]
