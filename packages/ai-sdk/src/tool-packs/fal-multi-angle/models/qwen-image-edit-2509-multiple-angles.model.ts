import { defineModel } from '../../../catalog/defineModel'
import { falOneMegapixelSize } from '../../../catalog/fal/imageSizing'
import type { JsonObject, JsonValue } from '../../../types/runtime'

const CONTINUOUS_IMAGE_RATIOS = ['1:1', '4:3', '3:4', '16:9', '9:16'] as const

function cleanMedia(value: JsonValue): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : []
}

function clampNumber(value: JsonValue, min: number, max: number, fallback = 0): number {
  const numeric = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(numeric) ? Math.min(max, Math.max(min, numeric)) : fallback
}

function nearestImageRatio(ratio: number): (typeof CONTINUOUS_IMAGE_RATIOS)[number] {
  return CONTINUOUS_IMAGE_RATIOS.reduce((best, candidate) => {
    const [width, height] = candidate.split(':').map(Number)
    const [bestWidth, bestHeight] = best.split(':').map(Number)
    return Math.abs(width / height - ratio) < Math.abs(bestWidth / bestHeight - ratio)
      ? candidate
      : best
  }, '1:1')
}

export const falQwenImageEdit2509MultipleAnglesModel = defineModel({
  meta: {
    id: 'fal-qwen-image-edit-2509-multiple-angles',
    canonicalModelId: 'qwen-image-edit-2509-multiple-angles',
    provider: 'fal',
    type: 'image',
    tags: ['image-edit', 'multi-angle', 'camera-control', 'provider-fal'],
    polling: { interval: 2_000, maxAttempts: 180, expectedAttempts: 30 },
  },
  inputLimits: { images: { exact: 1 }, videos: { max: 0 } },
  requirements: [{
    id: 'fal-qwen-image-edit-2509-multiple-angles-source',
    require: { images: { exact: 1 } },
    message: { title: '需要单张源图', message: '多角度生成必须且只能提供 1 张源图。', type: 'error' },
  }],
  params: [
    { id: 'image', type: 'image-upload', order: 1, required: true, valueType: 'array', default: [], maxCount: 1 },
    { id: 'rotateRightLeft', type: 'number', order: 2, default: 0, min: -90, max: 90, step: 1 },
    { id: 'verticalAngle', type: 'number', order: 3, default: 0, min: -1, max: 1, step: 0.1 },
    { id: 'moveForward', type: 'number', order: 4, default: 0, min: 0, max: 10, step: 0.5 },
    { id: 'wideAngleLens', type: 'switch', order: 5, default: false },
  ],
  runtimeConstraints: {
    mediaFields: [{ field: 'image_urls', kind: 'image' }],
  },
  endpoints: 'fal-ai/qwen-image-edit-2509-lora-gallery/multiple-angles',
  request: {
    builder: (params) => {
      const images = cleanMedia(params.image)
      const ratio = typeof params.__firstImageRatio === 'number'
        && Number.isFinite(params.__firstImageRatio)
        && params.__firstImageRatio > 0
        ? params.__firstImageRatio
        : 1

      return {
        image_urls: images.slice(0, 1),
        image_size: falOneMegapixelSize(nearestImageRatio(ratio)),
        rotate_right_left: clampNumber(params.rotateRightLeft, -90, 90),
        vertical_angle: clampNumber(params.verticalAngle, -1, 1),
        move_forward: clampNumber(params.moveForward, 0, 10),
        wide_angle_lens: params.wideAngleLens === true,
        num_images: 1,
        guidance_scale: 1,
        num_inference_steps: 6,
        acceleration: 'regular',
        enable_safety_checker: true,
        lora_scale: 1.25,
      } satisfies JsonObject
    },
  },
  pricing: {
    currency: '$',
    calculator: () => 0.035,
    description: '$0.035/百万像素；首版每视角固定约 1MP、1 张输出，估算 $0.035/视角',
  },
})

export default falQwenImageEdit2509MultipleAnglesModel
