import { defineModel } from '../../../catalog/defineModel'
import { requireSingleMultiAngleImage } from '../shared'

export const FAL_PERSPECTIVE_PRESETS = [
  'front',
  'left_side',
  'right_side',
  'back',
  'top_down',
  'bottom_up',
  'birds_eye',
  'three_quarter_left',
  'three_quarter_right',
] as const

export const falPerspectiveChangeModel = defineModel({
  meta: {
    id: 'fal-perspective-change',
    canonicalModelId: 'perspective-change',
    provider: 'fal',
    type: 'image',
    tags: ['image-edit', 'multi-angle', 'perspective-preset', 'provider-fal'],
    polling: { interval: 2_000, maxAttempts: 180, expectedAttempts: 30 },
  },
  acceptsPrompt: false,
  inputLimits: { images: { exact: 1 }, videos: { max: 0 } },
  requirements: [{
    id: 'fal-perspective-change-source',
    require: { images: { exact: 1 } },
    message: { title: '需要单张源图', message: '透视变换必须且只能提供 1 张源图。', type: 'error' },
  }],
  params: [
    { id: 'image', type: 'image-upload', order: 1, required: true, valueType: 'array', default: [], maxCount: 1 },
    {
      id: 'targetPerspective',
      type: 'dropdown',
      order: 2,
      default: 'front',
      options: FAL_PERSPECTIVE_PRESETS.map((value) => ({ value })),
    },
  ],
  runtimeConstraints: {
    mediaFields: [{ field: 'image_url', kind: 'image' }],
    enumFields: [{ field: 'target_perspective', allowed: [...FAL_PERSPECTIVE_PRESETS], fallback: 'front' }],
  },
  endpoints: 'fal-ai/image-apps-v2/perspective',
  request: {
    builder: (params) => {
      const image = requireSingleMultiAngleImage(params, '透视变换')
      const requested = String(params.targetPerspective || 'front')
      const targetPerspective = FAL_PERSPECTIVE_PRESETS.includes(
        requested as (typeof FAL_PERSPECTIVE_PRESETS)[number]
      ) ? requested : 'front'
      return {
        image_url: image,
        target_perspective: targetPerspective,
      }
    },
  },
  pricing: { currency: '$', fixed: 0.04, description: '$0.04/张；首版每视角 1 张输出' },
})

export default falPerspectiveChangeModel
