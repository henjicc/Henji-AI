import { model as controlLightModel } from '@henjicc/ai-sdk/tool-models/fal/control-light'
import { model as outpaintModel } from '@henjicc/ai-sdk/tool-models/fal/outpaint'
import { model as photoRestorationModel } from '@henjicc/ai-sdk/tool-models/fal/photo-restoration'
import { model as pixelcutBackgroundRemovalModel } from '@henjicc/ai-sdk/tool-models/fal/pixelcut-background-removal'
import { model as productPhotographyModel } from '@henjicc/ai-sdk/tool-models/fal/product-photography'
import { model as relightingModel } from '@henjicc/ai-sdk/tool-models/fal/relighting'

import { composeModelDefinition } from '@/core/composeModelDefinition'
import type { ModelDefinition } from '@/core/types'
import type { ModelPresentation } from '@/core/types/ModelPresentation'

const aspectRatioDisplay = {
  // smart 由通用比例选择器按当前语言单独渲染；这里保留无中文泄漏的后备标签。
  smart: { label: 'Smart' },
  '1:1': { label: '1:1' },
  '16:9': { label: '16:9' },
  '9:16': { label: '9:16' },
  '4:3': { label: '4:3' },
  '3:4': { label: '3:4' },
} as const

const imageParam = {
  name: { zh: '源图', en: 'Source image' },
  uploadButtonText: { zh: '选择图片', en: 'Choose image' },
} as const

const relightingPresentation: ModelPresentation = {
  meta: { name: { zh: 'FAL 预设重打光', en: 'FAL Preset Relighting' } },
  params: {
    image: imageParam,
    lightingStyle: {
      name: { zh: '灯光风格', en: 'Lighting style' },
      optionLabels: {
        natural: { label: { zh: '自然光', en: 'Natural' } },
        studio: { label: { zh: '棚拍光', en: 'Studio' } },
        golden_hour: { label: { zh: '黄金时刻', en: 'Golden hour' } },
        blue_hour: { label: { zh: '蓝调时刻', en: 'Blue hour' } },
        dramatic: { label: { zh: '戏剧光', en: 'Dramatic' } },
        soft: { label: { zh: '柔光', en: 'Soft' } },
        hard: { label: { zh: '硬光', en: 'Hard' } },
        backlight: { label: { zh: '逆光', en: 'Backlight' } },
        side_light: { label: { zh: '侧光', en: 'Side light' } },
        front_light: { label: { zh: '正面光', en: 'Front light' } },
        rim_light: { label: { zh: '轮廓光', en: 'Rim light' } },
        sunset: { label: { zh: '日落光', en: 'Sunset' } },
        sunrise: { label: { zh: '日出光', en: 'Sunrise' } },
        neon: { label: { zh: '霓虹光', en: 'Neon' } },
        candlelight: { label: { zh: '烛光', en: 'Candlelight' } },
        moonlight: { label: { zh: '月光', en: 'Moonlight' } },
        spotlight: { label: { zh: '聚光灯', en: 'Spotlight' } },
        ambient: { label: { zh: '环境光', en: 'Ambient' } },
      },
    },
    aspectRatio: {
      name: { zh: '输出比例', en: 'Output ratio' },
      aspectRatioDisplay,
    },
  },
}

const controlLightPresentation: ModelPresentation = {
  meta: { name: { zh: 'FAL 暗光增强', en: 'FAL Low-light Enhancement' } },
  params: {
    image: imageParam,
    lightingLevel: {
      name: { zh: '提亮强度', en: 'Lighting level' },
      tooltip: { zh: '控制暗部提亮幅度，0 保持原光照，1 为最强。', en: 'Controls low-light enhancement from 0 to 1.' },
      showInput: true,
    },
  },
}

const outpaintPresentation: ModelPresentation = {
  meta: { name: { zh: 'FAL 智能扩图', en: 'FAL Outpaint' } },
  params: {
    image: imageParam,
    prompt: {
      name: { zh: '补画提示词', en: 'Outpaint prompt' },
      placeholder: {
        zh: '可选：描述希望补画区域出现的内容（最多 500 字符）',
        en: 'Optional: describe the content to fill outside the image (up to 500 characters)',
      },
    },
    expandLeft: { name: { zh: '向左扩展', en: 'Expand left' }, unit: 'px', showInput: true },
    expandRight: { name: { zh: '向右扩展', en: 'Expand right' }, unit: 'px', showInput: true },
    expandTop: { name: { zh: '向上扩展', en: 'Expand top' }, unit: 'px', showInput: true },
    expandBottom: { name: { zh: '向下扩展', en: 'Expand bottom' }, unit: 'px', showInput: true },
    zoomOutPercentage: {
      name: { zh: '整体缩小', en: 'Zoom out' },
      tooltip: { zh: '缩小原画面并自动补全四周内容。', en: 'Zooms out the source and fills the surrounding area.' },
      unit: '%',
      showInput: true,
    },
  },
}

const productPhotographyPresentation: ModelPresentation = {
  meta: { name: { zh: 'FAL 商品摄影', en: 'FAL Product Photography' } },
  params: {
    image: { ...imageParam, name: { zh: '商品图', en: 'Product image' } },
    aspectRatio: { name: { zh: '输出比例', en: 'Output ratio' }, aspectRatioDisplay },
  },
}

const photoRestorationPresentation: ModelPresentation = {
  meta: { name: { zh: 'FAL 照片修复', en: 'FAL Photo Restoration' } },
  params: {
    image: { ...imageParam, name: { zh: '旧照片', en: 'Old photo' } },
    enhanceResolution: { name: { zh: '增强清晰度', en: 'Enhance resolution' } },
    fixColors: { name: { zh: '修复颜色', en: 'Fix colors' } },
    removeScratches: { name: { zh: '去除划痕', en: 'Remove scratches' } },
    aspectRatio: { name: { zh: '输出比例', en: 'Output ratio' }, aspectRatioDisplay },
  },
}

const backgroundRemovalPresentation: ModelPresentation = {
  meta: { name: { zh: 'FAL 背景移除', en: 'FAL Background Removal' } },
  params: { image: imageParam },
}

export const FAL_IMAGE_UTILITY_EXECUTION_MODELS: readonly ModelDefinition[] = [
  composeModelDefinition(relightingModel, relightingPresentation),
  composeModelDefinition(controlLightModel, controlLightPresentation),
  composeModelDefinition(outpaintModel, outpaintPresentation),
  composeModelDefinition(productPhotographyModel, productPhotographyPresentation),
  composeModelDefinition(photoRestorationModel, photoRestorationPresentation),
  composeModelDefinition(pixelcutBackgroundRemovalModel, backgroundRemovalPresentation),
]

const utilityModelById = new Map(
  FAL_IMAGE_UTILITY_EXECUTION_MODELS.map((model) => [model.meta.id, model]),
)

/** 仅供受控图片工具入口使用；不会进入普通模型选择器或能力发现。 */
export function getFalImageUtilityExecutionModel(modelId: string): ModelDefinition | undefined {
  return utilityModelById.get(modelId)
}
