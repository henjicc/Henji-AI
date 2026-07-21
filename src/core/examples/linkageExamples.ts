import { createLogger } from '@/core/logging'

const logger = createLogger('core.examples.linkageExamples')
/**
 * 示例：联动定义示例
 *
 * 用于验证 Linkage 接口的完整性和可用性
 */

import { Linkage } from '../types/Linkage'

/**
 * 示例1：Kling 2.6 Pro 视频模型联动
 */
export const kling26ProLinkages: Linkage[] = [
  // 1. 切换模式时重置上传的文件
  {
    trigger: 'mode',
    effect: 'reset',
    targets: ['images', 'referenceVideo'],
    description: '切换模式时清空上传的文件'
  },

  // 2. 隐藏图片上传（文生视频模式）
  {
    trigger: 'mode',
    effect: 'hide',
    targets: ['images'],
    condition: (mode: string) => mode === 'text-to-video',
    description: '文生视频模式下隐藏图片上传'
  },

  // 3. 隐藏视频上传（仅动作控制模式显示）
  {
    trigger: 'mode',
    effect: 'hide',
    targets: ['referenceVideo'],
    condition: (mode: string) => mode !== 'motion-control',
    description: '仅在动作控制模式下显示视频上传'
  },

  // 4. 快速模式下禁用 CFG 系数
  {
    trigger: 'fastMode',
    effect: 'disable',
    targets: ['cfgScale'],
    condition: (fastMode: boolean) => fastMode === true,
    reason: '快速模式下不可调整 CFG 系数'
  },

  // 5. 快速模式下自动降低 CFG 系数
  {
    trigger: 'fastMode',
    effect: 'setValue',
    target: 'cfgScale',
    value: (fastMode: boolean) => (fastMode ? 0.5 : 1.0),
    description: '快速模式下自动设置 CFG 系数为 0.5'
  },

  // 6. 动作控制模式下限制视频时长
  {
    trigger: 'mode',
    effect: 'filterRange',
    target: 'duration',
    filter: (mode: string) => {
      if (mode === 'motion-control') {
        return { min: 3, max: 30, step: 1 }
      }
      return { min: 5, max: 15, step: 5 }
    },
    description: '动作控制模式支持 3-30 秒，其他模式 5-15 秒'
  }
]

/**
 * 示例2：Seedream 4.0 图片模型联动
 */
export const seedream40Linkages: Linkage[] = [
  // 1. 根据分辨率过滤生成数量
  {
    trigger: 'resolution',
    effect: 'filterRange',
    target: 'maxImages',
    filter: (resolution: string) => {
      const [width, height] = resolution.split('x').map(Number)
      const is4K = width >= 3840 || height >= 3840

      if (is4K) {
        // 4K 分辨率最多生成 2 张
        return { min: 1, max: 2, step: 1 }
      }
      // 其他分辨率最多生成 6 张
      return { min: 1, max: 6, step: 1 }
    },
    description: '4K 分辨率限制生成数量'
  },

  // 2. 上传图片后自动切换为图生图模式
  {
    trigger: 'images',
    effect: 'autoSwitch',
    target: 'mode',
    condition: (images: DynamicValue[]) => images && images.length > 0,
    value: 'image-to-image',
    noRestore: false,
    description: '上传图片后自动切换为图生图模式'
  }
]

/**
 * 示例3：Vidu Q1 视频模型联动（复杂场景）
 */
export const viduQ1Linkages: Linkage[] = [
  // 1. 模式切换时重置文件
  {
    trigger: 'mode',
    effect: 'reset',
    targets: ['images', 'videos'],
    description: '切换模式时清空上传的文件'
  },

  // 2. 根据模式过滤图片上传数量
  {
    trigger: 'mode',
    effect: 'filterRange',
    target: 'images.maxCount',
    filter: (mode: string) => {
      if (mode === 'start-end-frame') {
        // 首尾帧模式需要 2 张图片
        return { min: 2, max: 2 }
      } else if (mode === 'reference-to-video') {
        // 参考模式支持多图
        return { min: 1, max: 6 }
      } else {
        // 图生视频模式只支持 1 张
        return { min: 1, max: 1 }
      }
    },
    description: '根据模式调整图片上传数量限制'
  },

  // 3. 根据模式过滤时长选项
  {
    trigger: 'mode',
    effect: 'filterOptions',
    target: 'duration',
    filter: (mode: string, options: DynamicValue[]) => {
      if (mode === 'reference-to-video') {
        // 参考模式只支持 4 秒和 8 秒
        return options.filter((o) => o.value === 4 || o.value === 8)
      }
      return options
    },
    description: '参考模式限制时长选项'
  },

  // 4. 自定义联动：根据模式同时调整多个参数
  {
    trigger: 'mode',
    effect: 'custom',
    handler: (_mode: string, _allParams: DynamicValue, _updateParam: DynamicValue) => {
      if (mode === 'reference-to-video') {
        // 参考模式下自动调整多个参数
        updateParam('duration', 4)
        updateParam('resolution', '720p')
        updateParam('fastMode', false)
      }
    },
    description: '参考模式下自动优化参数配置'
  }
]

/**
 * 示例4：Nano Banana 图片模型联动（智能匹配）
 */
export const nanoBananaLinkages: Linkage[] = [
  // 1. 上传图片后自动切换宽高比（与 smartMatch 配合）
  {
    trigger: 'images',
    effect: 'autoSwitch',
    target: 'aspectRatio',
    condition: (images: DynamicValue[]) => images && images.length > 0,
    value: (images: DynamicValue[], allParams: DynamicValue) => {
      // 获取第一张图片的宽高比
      const firstImage = images[0]
      if (firstImage && firstImage.dimensions) {
        const ratio = firstImage.dimensions.width / firstImage.dimensions.height
        if (ratio > 1.5) return '16:9'
        if (ratio < 0.7) return '9:16'
        return '1:1'
      }
      return allParams.aspectRatio // 保持当前值
    },
    noRestore: true,
    description: '根据上传图片自动调整宽高比'
  },

  // 2. 图片数量影响生成数量
  {
    trigger: 'images',
    effect: 'setValue',
    target: 'numImages',
    value: (images: DynamicValue[]) => {
      if (images && images.length > 0) {
        // 有参考图片时，默认生成 1 张
        return 1
      }
      return 4 // 无参考图片时，默认生成 4 张
    },
    description: '根据是否有参考图片调整生成数量'
  }
]

/**
 * 示例5：优先级覆盖示例
 */
export const priorityExampleLinkages: Linkage[] = [
  // 1. 重置联动（默认优先级 1）
  {
    trigger: 'mode',
    effect: 'reset',
    targets: ['images']
  },

  // 2. 自定义联动，指定高优先级（优先级 0，比 reset 更早执行）
  {
    trigger: 'mode',
    effect: 'custom',
    priority: 0, // 覆盖默认优先级（custom 默认为 8）
    handler: (_mode: string, _allParams: DynamicValue, _updateParam: DynamicValue) => {
      logger.info('模式切换前的准备工作')
    },
    description: '在重置之前执行的自定义逻辑'
  },

  // 3. 设置值联动（默认优先级 2）
  {
    trigger: 'mode',
    effect: 'setValue',
    target: 'duration',
    value: 5
  }
]

/**
 * 示例6：防抖示例
 */
export const debounceExampleLinkages: Linkage[] = [
  // 滑块参数变化时的联动，使用防抖避免频繁触发
  {
    trigger: 'cfgScale',
    effect: 'custom',
    debounce: 300, // 300ms 防抖
    handler: (cfgScale: number, _allParams: DynamicValue, _updateParam: DynamicValue) => {
      // 复杂的参数计算...
      logger.info('CFG Scale 调整为:', cfgScale)
    },
    description: 'CFG 系数变化时的联动（防抖 300ms）'
  }
]

