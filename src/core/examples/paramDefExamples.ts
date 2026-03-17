/**
 * 示例：参数定义示例
 *
 * 用于验证 ParamDef 接口的完整性和可用性
 */

import { ParamDef } from '../types/ParamDef'

/**
 * 示例1：Nano Banana 图片模型参数
 */
export const nanoBananaParams: ParamDef[] = [
  // 提示词
  {
    id: 'prompt',
    component: 'text',
    order: 1,
    name: { zh: '提示词', en: 'Prompt' },
    tooltip: { zh: '描述想要生成的内容', en: 'Describe what you want to generate' },
    valueType: 'string',
    default: '',
    placeholder: { zh: '描述想要生成的内容', en: 'Describe what you want to generate' },
    multiline: true,
    maxLength: 1000,
    required: true,
    api: 'prompt'
  },

  // 图片上传
  {
    id: 'images',
    component: 'image-upload',
    order: 2,
    name: { zh: '参考图片', en: 'Reference Images' },
    tooltip: { zh: '上传参考图片进行图片编辑', en: 'Upload reference images for image editing' },
    valueType: 'array',
    default: [],
    maxCount: 4,
    accept: ['image/png', 'image/jpeg', 'image/webp'],
    maxSize: 10 * 1024 * 1024,
    smartMatch: {
      targetParam: 'aspectRatio',
      matcher: (file) => {
        if (!file.dimensions) return '1:1'
        const ratio = file.dimensions.width / file.dimensions.height
        if (ratio > 1.5) return '16:9'
        if (ratio < 0.7) return '9:16'
        return '1:1'
      },
      autoApply: true
    },
    api: 'image_urls'
  },

  // 宽高比
  {
    id: 'aspectRatio',
    component: 'aspect-ratio',
    order: 3,
    name: { zh: '宽高比', en: 'Aspect Ratio' },
    valueType: 'string',
    default: '1:1',
    options: [
      { value: '1:1', label: '1:1', icon: '■' },
      { value: '16:9', label: '16:9', icon: '▭' },
      { value: '9:16', label: '9:16', icon: '▯' },
      { value: '4:3', label: '4:3' },
      { value: '3:4', label: '3:4' }
    ],
    api: 'aspect_ratio'
  },

  // 图片数量
  {
    id: 'numImages',
    component: 'number',
    order: 4,
    name: { zh: '图片数量', en: 'Number of Images' },
    valueType: 'number',
    default: 1,
    min: 1,
    max: 4,
    step: 1,
    unit: '张',
    showInput: true,
    api: 'num_images'
  },

  // 高级设置面板
  {
    id: 'advanced',
    component: 'panel',
    order: 100,
    name: { zh: '高级设置', en: 'Advanced Settings' },
    valueType: 'object',
    default: {},
    collapsible: true,
    defaultCollapsed: true,
    children: [
      // 随机种子
      {
        id: 'seed',
        component: 'number',
        order: 1,
        name: { zh: '随机种子', en: 'Seed' },
        tooltip: { zh: '-1 表示随机生成', en: '-1 for random generation' },
        valueType: 'number',
        default: -1,
        min: -1,
        max: 999999999,
        placeholder: { zh: '-1 表示随机', en: '-1 for random' },
        api: 'seed'
      },

      // 引导系数
      {
        id: 'guidanceScale',
        component: 'number',
        order: 2,
        name: { zh: '引导系数', en: 'Guidance Scale' },
        tooltip: { zh: '数值越大，生成结果越贴近提示词', en: 'Higher values make the result closer to the prompt' },
        valueType: 'number',
        default: 7.5,
        min: 1,
        max: 20,
        step: 0.5,
        showInput: true,
        api: 'guidance_scale'
      }
    ]
  }
]

/**
 * 示例2：Kling 2.6 Pro 视频模型参数
 */
export const kling26ProParams: ParamDef[] = [
  // 模式选择
  {
    id: 'mode',
    component: 'radio',
    order: 1,
    name: { zh: '模式', en: 'Mode' },
    valueType: 'string',
    default: 'text-to-video',
    options: [
      {
        value: 'text-to-video',
        label: { zh: '文生视频', en: 'Text to Video' },
        description: { zh: '根据文本描述生成视频', en: 'Generate video from text description' }
      },
      {
        value: 'image-to-video',
        label: { zh: '图生视频', en: 'Image to Video' },
        description: { zh: '根据图片生成视频', en: 'Generate video from image' }
      },
      {
        value: 'motion-control',
        label: { zh: '动作控制', en: 'Motion Control' },
        description: { zh: '使用参考视频控制动作', en: 'Control motion with reference video' }
      }
    ],
    direction: 'horizontal',
    api: 'mode'
  },

  // 提示词
  {
    id: 'prompt',
    component: 'text',
    order: 2,
    name: { zh: '提示词', en: 'Prompt' },
    valueType: 'string',
    default: '',
    placeholder: { zh: '描述想要生成的视频内容', en: 'Describe the video you want to generate' },
    multiline: true,
    maxLength: 2000,
    required: true,
    api: 'prompt'
  },

  // 图片上传（仅在图生视频和动作控制模式下显示）
  {
    id: 'images',
    component: 'image-upload',
    order: 3,
    name: { zh: '参考图片', en: 'Reference Images' },
    valueType: 'array',
    default: [],
    maxCount: 1,
    visible: {
      condition: 'mode === "image-to-video" || mode === "motion-control"',
      reason: '仅在图生视频和动作控制模式下需要图片'
    },
    api: 'image_urls'
  },

  // 视频上传（仅在动作控制模式下显示）
  {
    id: 'referenceVideo',
    component: 'video-upload',
    order: 4,
    name: { zh: '参考视频', en: 'Reference Video' },
    tooltip: { zh: '上传参考视频以控制动作', en: 'Upload reference video to control motion' },
    valueType: 'array',
    default: [],
    maxCount: 1,
    maxDuration: 30,
    minDuration: 3,
    accept: ['video/mp4', 'video/webm'],
    visible: {
      condition: 'mode === "motion-control"',
      reason: '仅在动作控制模式下需要参考视频'
    },
    api: 'reference_video_url'
  },

  // 视频时长
  {
    id: 'duration',
    component: 'number',
    order: 5,
    name: { zh: '时长', en: 'Duration' },
    valueType: 'number',
    default: 5,
    min: 5,
    max: 15,
    step: 5,
    unit: '秒',
    marks: [
      { value: 5, label: '5s' },
      { value: 10, label: '10s' },
      { value: 15, label: '15s' }
    ],
    api: 'duration'
  },

  // 宽高比
  {
    id: 'aspectRatio',
    component: 'dropdown',
    order: 6,
    name: { zh: '宽高比', en: 'Aspect Ratio' },
    valueType: 'string',
    default: '16:9',
    options: [
      { value: '16:9', label: { zh: '16:9 (横屏)', en: '16:9 (Landscape)' } },
      { value: '9:16', label: { zh: '9:16 (竖屏)', en: '9:16 (Portrait)' } },
      { value: '1:1', label: { zh: '1:1 (方形)', en: '1:1 (Square)' } }
    ],
    api: 'aspect_ratio'
  },

  // 生成音频开关
  {
    id: 'generateAudio',
    component: 'switch',
    order: 7,
    name: { zh: '生成音频', en: 'Generate Audio' },
    tooltip: { zh: '为视频生成背景音乐', en: 'Generate background music for the video' },
    valueType: 'boolean',
    default: false,
    onLabel: { zh: '开启', en: 'On' },
    offLabel: { zh: '关闭', en: 'Off' },
    api: 'audio'
  },

  // 快速模式（禁用某些参数）
  {
    id: 'fastMode',
    component: 'switch',
    order: 8,
    name: { zh: '快速模式', en: 'Fast Mode' },
    tooltip: { zh: '快速生成，但质量稍低', en: 'Faster generation with slightly lower quality' },
    valueType: 'boolean',
    default: false,
    api: 'fast_mode'
  },

  // CFG Scale（快速模式下禁用）
  {
    id: 'cfgScale',
    component: 'number',
    order: 9,
    name: { zh: 'CFG 系数', en: 'CFG Scale' },
    valueType: 'number',
    default: 0.5,
    min: 0,
    max: 1,
    step: 0.1,
    disabled: {
      condition: 'fastMode === true',
      reason: '快速模式下不可调整 CFG 系数'
    },
    api: 'cfg_scale'
  }
]

/**
 * 示例3：Seedream 4.0 图片模型参数
 */
export const seedream40Params: ParamDef[] = [
  // 提示词
  {
    id: 'prompt',
    component: 'text',
    order: 1,
    name: { zh: '提示词', en: 'Prompt' },
    valueType: 'string',
    default: '',
    multiline: true,
    required: true,
    api: 'prompt'
  },

  // 图片上传
  {
    id: 'images',
    component: 'image-upload',
    order: 2,
    name: { zh: '参考图片', en: 'Reference Images' },
    valueType: 'array',
    default: [],
    maxCount: 10,
    api: 'images'
  },

  // 分辨率选择器
  {
    id: 'resolution',
    component: 'resolution',
    order: 3,
    name: { zh: '分辨率', en: 'Resolution' },
    valueType: 'string',
    default: '1024x1024',
    presets: [
      { value: '1024x1024', label: { zh: '1K 方形', en: '1K Square' } },
      { value: '1920x1080', label: { zh: '1080p (16:9)', en: '1080p (16:9)' } },
      { value: '1080x1920', label: { zh: '1080p (9:16)', en: '1080p (9:16)' } },
      { value: '2048x2048', label: { zh: '2K 方形', en: '2K Square' } },
      { value: '4096x4096', label: { zh: '4K 方形', en: '4K Square' } }
    ],
    allowCustom: false,
    api: (value) => {
      const [width, height] = value.split('x').map(Number)
      return { width, height }
    }
  },

  // 生成数量（组图）
  {
    id: 'maxImages',
    component: 'number',
    order: 4,
    name: { zh: '生成数量', en: 'Number of Images' },
    tooltip: { zh: '一次生成多张图片', en: 'Generate multiple images at once' },
    valueType: 'number',
    default: 1,
    min: 1,
    max: 6,
    step: 1,
    unit: '张',
    api: 'max_images'
  }
]
