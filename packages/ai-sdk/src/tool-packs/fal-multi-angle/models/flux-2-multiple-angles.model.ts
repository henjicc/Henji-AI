import { defineModel } from '../../../catalog/defineModel'
import {
  FAL_COMMON_IMAGE_RATIOS,
  falOneMegapixelSize,
} from '../../../catalog/fal/imageSizing'
import type { JsonObject, JsonValue } from '../../../types/runtime'

function cleanMedia(value: JsonValue): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : []
}

function clampNumber(value: JsonValue, min: number, max: number, fallback: number): number {
  const numeric = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(numeric) ? Math.min(max, Math.max(min, numeric)) : fallback
}

function nearestImageRatio(ratio: number): (typeof FAL_COMMON_IMAGE_RATIOS)[number] {
  return FAL_COMMON_IMAGE_RATIOS.reduce((best, candidate) => {
    const [width, height] = candidate.split(':').map(Number)
    const [bestWidth, bestHeight] = best.split(':').map(Number)
    return Math.abs(width / height - ratio) < Math.abs(bestWidth / bestHeight - ratio)
      ? candidate
      : best
  }, '1:1')
}

export const falFlux2MultipleAnglesModel = defineModel({
  meta: {
    id: 'fal-flux-2-multiple-angles',
    canonicalModelId: 'flux-2-multiple-angles',
    provider: 'fal',
    type: 'image',
    tags: ['image-edit', 'multi-angle', 'camera-control', 'provider-fal'],
    polling: { interval: 2_000, maxAttempts: 180, expectedAttempts: 30 },
  },
  inputLimits: { images: { exact: 1 }, videos: { max: 0 } },
  requirements: [{
    id: 'fal-flux-2-multiple-angles-source',
    require: { images: { exact: 1 } },
    message: {
      title: '需要单张源图',
      message: 'FLUX 2 多角度首版必须且只能提供 1 张源图。',
      type: 'error',
    },
  }],
  params: [
    { id: 'image', type: 'image-upload', order: 1, required: true, valueType: 'array', default: [], maxCount: 1 },
    { id: 'horizontalAngle', type: 'number', order: 2, default: 0, min: 0, max: 360, step: 1 },
    { id: 'verticalAngle', type: 'number', order: 3, default: 0, min: 0, max: 60, step: 1 },
    { id: 'zoom', type: 'number', order: 4, default: 5, min: 0, max: 10, step: 0.5 },
  ],
  runtimeConstraints: {
    mediaFields: [{ field: 'image_urls', kind: 'image' }],
    numberFields: [
      { field: 'horizontal_angle', min: 0, max: 360, fallback: 0 },
      { field: 'vertical_angle', min: 0, max: 60, fallback: 0 },
      { field: 'zoom', min: 0, max: 10, fallback: 5 },
    ],
  },
  endpoints: 'fal-ai/flux-2-lora-gallery/multiple-angles',
  request: {
    builder: (params) => {
      const images = cleanMedia(params.image)
      if (images.length !== 1) {
        throw new Error('FLUX 2 多角度首版必须且只能提供 1 张源图')
      }
      const ratio = typeof params.__firstImageRatio === 'number'
        && Number.isFinite(params.__firstImageRatio)
        && params.__firstImageRatio > 0
        ? params.__firstImageRatio
        : 1

      return {
        image_urls: images,
        horizontal_angle: clampNumber(params.horizontalAngle, 0, 360, 0),
        vertical_angle: clampNumber(params.verticalAngle, 0, 60, 0),
        zoom: clampNumber(params.zoom, 0, 10, 5),
        image_size: falOneMegapixelSize(nearestImageRatio(ratio)),
      } satisfies JsonObject
    },
  },
  pricing: {
    currency: '$',
    calculator: () => 0.021,
    description: '$0.021/处理后百万像素；首版固定约 1MP、1 张输出，估算 $0.021/视角',
  },
})

export default falFlux2MultipleAnglesModel
