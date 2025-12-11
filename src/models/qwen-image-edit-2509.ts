import { ParamDef } from '../types/schema'

// Qwen-Image-Edit-2509 参数
// 支持上传最多3张图片进行编辑
export const qwenImageEdit2509Params: ParamDef[] = [
  {
    id: 'modelscopeImageSize',
    type: 'dropdown',
    label: '分辨率',
    defaultValue: 'smart',  // 默认为智能模式
    resolutionConfig: {
      type: 'aspect_ratio',
      smartMatch: true,  // 启用智能匹配
      visualize: true,
      customInput: true,
      // ⚠️ 不使用基数系统，每个比例自动计算最佳值
      baseSizeEditable: false,  // 禁用基数编辑
      useQwenCalculator: true,  // 使用 Qwen 专用计算器
      extractRatio: (value) => {
        if (value === 'smart') return null
        if (value.includes(':')) {
          const [w, h] = value.split(':').map(Number)
          return w / h
        }
        return null
      }
    },
    options: (_values: any) => {
      const baseOptions = [
        { value: '21:9', label: '21:9' },
        { value: '16:9', label: '16:9' },
        { value: '3:2', label: '3:2' },
        { value: '4:3', label: '4:3' },
        { value: '1:1', label: '1:1' },
        { value: '3:4', label: '3:4' },
        { value: '2:3', label: '2:3' },
        { value: '9:16', label: '9:16' },
        { value: '9:21', label: '9:21' }
      ]

      // 智能选项始终显示
      return [{ value: 'smart', label: '智能' }, ...baseOptions]
    }
  },
  {
    id: 'steps',
    type: 'number',
    label: '采样步数',
    min: 1,
    max: 100,
    step: 1,
    defaultValue: 30,
    widthClassName: 'w-24',
    tooltip: '采样步数越多，生成的图像越精细，但耗时也越长。建议值：20-50',
    tooltipDelay: 500
  }
]
