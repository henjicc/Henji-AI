import { ParamDef } from '../types/schema'

/**
 * KIE Hailuo 2.3 模型参数定义
 *
 * 特点：
 * - 图生视频模型（必须上传图片）
 * - 支持标准和专业两种模式
 * - 1080P 分辨率不支持 10 秒时长
 */
export const kieHailuo23Params: ParamDef[] = [
  {
    id: 'kieHailuo23Mode',
    type: 'dropdown',
    label: '模式',
    defaultValue: 'standard',
    options: [
      { value: 'standard', label: '标准' },
      { value: 'pro', label: '专业' }
    ],
    className: 'min-w-[50px]'
  },
  {
    id: 'kieHailuo23Duration',
    type: 'dropdown',
    label: '时长',
    defaultValue: 6,
    options: [
      { value: 6, label: '6s' },
      { value: 10, label: '10s' }
    ],
    className: 'min-w-[50px]'
  },
  {
    id: 'kieHailuo23Resolution',
    type: 'dropdown',
    label: '分辨率',
    defaultValue: '768P',
    // 分辨率配置：使用面板显示
    resolutionConfig: {
      type: 'resolution',
      smartMatch: false,
      visualize: false
    },
    // 自动切换规则：当时长为10秒且分辨率为1080P时，自动切换到768P
    autoSwitch: {
      condition: (values) => {
        return values.kieHailuo23Duration === 10 && values.kieHailuo23Resolution === '1080P'
      },
      value: () => '768P'
    },
    // 动态选项：当时长为10秒时，禁用1080P选项
    options: (values) => [
      { value: '768P', label: '768P' },
      { value: '1080P', label: '1080P', disabled: values.kieHailuo23Duration === 10 }
    ],
    className: 'min-w-[100px]'
  }
]
