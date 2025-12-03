import { ParamDef } from '../types/schema'

/**
 * ByteDance Seedream v4/v4.5 模型参数定义
 *
 * 分辨率约束（fal.ai 即梦模型）：
 * - 宽高比范围：[1/3, 3]
 * - 最大总像素：6000×6000 = 36,000,000 像素
 * - 2K模式：目标像素 2048×2048 = 4,194,304，宽高相乘尽可能接近且不小于此值
 * - 4K模式：目标像素 4096×4096 = 16,777,216，宽高相乘尽可能接近且不小于此值
 *
 * 重要：此模型不使用基数系统（baseSize），而是使用质量模式（2K/4K）直接计算分辨率
 */
export const falAiBytedanceSeedreamV4Params: ParamDef[] = [
  {
    id: 'selectedResolution',
    type: 'dropdown',
    label: '分辨率',
    defaultValue: 'smart',
    // 分辨率配置：启用智能匹配、可视化、自定义输入和质量选项
    resolutionConfig: {
      type: 'aspect_ratio',
      smartMatch: true,
      visualize: true,
      customInput: true,
      // 即梦模型专用：不使用基数系统，禁用基数编辑
      useSeedreamCalculator: true,  // 标记使用即梦专用计算器
      seedreamProvider: 'fal',      // fal.ai 版本（宽高比 [1/3, 3]，最大 36,000,000 像素）
      baseSizeEditable: false,      // 禁用基数编辑
      extractRatio: (value) => {
        if (value === 'smart') return null
        const [w, h] = value.split(':').map(Number)
        return w / h
      },
      qualityOptions: [
          { value: '2K', label: '高清 2K' },
          { value: '4K', label: '超清 4K' }
      ]
    },
    options: (values) => {
        const baseOptions = [
            { value: '21:9', label: '21:9' },
            { value: '16:9', label: '16:9' },
            { value: '3:2', label: '3:2' },
            { value: '4:3', label: '4:3' },
            { value: '1:1', label: '1:1' },
            { value: '3:4', label: '3:4' },
            { value: '2:3', label: '2:3' },
            { value: '9:16', label: '9:16' }
        ]

        // 图生图时添加智能选项在最前面
        if (values.uploadedImages && values.uploadedImages.length > 0) {
            return [{ value: 'smart', label: '智能' }, ...baseOptions]
        }

        return [{ value: 'smart', label: '智能' }, ...baseOptions]
    },
    className: 'min-w-[100px]'
  },
  {
    id: 'numImages',
    type: 'number',
    label: '数量',
    min: 1,
    max: 6,
    step: 1,
    widthClassName: 'w-20',
    tooltip: '设置为1时仅生成单张图片；大于1时，会根据该数值生成多张图片。',
    tooltipDelay: 500
  }
]
