import { ParamDef } from '../types/schema'

/**
 * KIE Hailuo 02 模型参数定义
 *
 * 特点：
 * - 支持文生视频和图生视频（根据图片数量自动切换）
 * - 当选择 6s + 1080P 时，自动使用 Pro 端点（固定配置，不传递参数）
 * - 其他情况使用 Standard 端点（传递 duration 和 resolution 参数）
 * - 1080P 只支持 6 秒时长
 * - 最多支持 2 张图片（第二张作为 end_image_url）
 */
export const kieHailuo02Params: ParamDef[] = [
  {
    id: 'kieHailuo02Duration',
    type: 'dropdown',
    label: '时长',
    defaultValue: 6,
    // 动态选项：当分辨率为1080P时，只显示6s选项
    options: (values) => {
      if (values.kieHailuo02Resolution === '1080P') {
        return [{ value: 6, label: '6s' }]
      }
      return [
        { value: 6, label: '6s' },
        { value: 10, label: '10s' }
      ]
    },
    className: 'min-w-[50px]'
  },
  {
    id: 'kieHailuo02Resolution',
    type: 'dropdown',
    label: '分辨率',
    defaultValue: '768P',
    // 分辨率配置：使用面板显示
    resolutionConfig: {
      type: 'resolution',
      smartMatch: false,
      visualize: false
    },
    // 自动切换规则：当选择1080P时，自动将时长设置为6s
    autoSwitch: {
      condition: (values) => {
        return values.kieHailuo02Resolution === '1080P' && values.kieHailuo02Duration !== 6
      },
      value: () => 6,
      targetParam: 'kieHailuo02Duration'
    },
    // 动态选项：当时长为10秒时，禁用1080P选项
    options: (values) => [
      { value: '512P', label: '512P' },
      { value: '768P', label: '768P' },
      { value: '1080P', label: '1080P', disabled: values.kieHailuo02Duration === 10 }
    ],
    className: 'min-w-[100px]'
  },
  {
    id: 'kieHailuo02PromptOptimizer',
    type: 'toggle',
    label: '提示词优化',
    defaultValue: true,
    className: 'w-auto'
  }
]
