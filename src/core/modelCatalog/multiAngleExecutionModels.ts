import { model as flux2MultipleAnglesModel } from '@henjicc/ai-sdk/tool-models/fal/flux-2-multiple-angles'
import { model as perspectiveChangeModel } from '@henjicc/ai-sdk/tool-models/fal/perspective-change'
import { model as qwenMultipleAnglesModel } from '@henjicc/ai-sdk/tool-models/fal/qwen-image-edit-2511-multiple-angles'

import { composeModelDefinition } from '@/core/composeModelDefinition'
import type { ModelDefinition } from '@/core/types'
import type { ModelPresentation } from '@/core/types/ModelPresentation'

const continuousPresentation: ModelPresentation = {
  meta: { name: { zh: 'Qwen 2511 多角度', en: 'Qwen 2511 Multiple Angles' } },
  params: {
    image: { name: { zh: '源图', en: 'Source image' } },
    horizontalAngle: { name: { zh: '水平角度', en: 'Horizontal angle' } },
    verticalAngle: { name: { zh: '垂直角度', en: 'Vertical angle' } },
    zoom: { name: { zh: '景别缩放', en: 'Zoom' } },
  },
}

const perspectivePresentation: ModelPresentation = {
  meta: { name: { zh: '完整方位多角度', en: 'Discrete Perspective Change' } },
  params: {
    image: { name: { zh: '源图', en: 'Source image' } },
    targetPerspective: {
      name: { zh: '目标方位', en: 'Target perspective' },
      optionLabels: {
        front: { label: { zh: '正面', en: 'Front' } },
        left_side: { label: { zh: '左侧面', en: 'Left side' } },
        right_side: { label: { zh: '右侧面', en: 'Right side' } },
        back: { label: { zh: '背面', en: 'Back' } },
        top_down: { label: { zh: '顶视', en: 'Top-down' } },
        bottom_up: { label: { zh: '仰视', en: 'Bottom-up' } },
        birds_eye: { label: { zh: '鸟瞰', en: "Bird's-eye" } },
        three_quarter_left: { label: { zh: '左三分之四', en: 'Three-quarter left' } },
        three_quarter_right: { label: { zh: '右三分之四', en: 'Three-quarter right' } },
      },
    },
  },
}

const fluxPresentation: ModelPresentation = {
  meta: { name: { zh: 'FLUX 2 多角度', en: 'FLUX 2 Multiple Angles' } },
  params: {
    image: { name: { zh: '源图', en: 'Source image' } },
    horizontalAngle: { name: { zh: '水平角度', en: 'Horizontal angle' } },
    verticalAngle: { name: { zh: '垂直角度', en: 'Vertical angle' } },
    zoom: { name: { zh: '缩放', en: 'Zoom' } },
  },
}

export const MULTI_ANGLE_EXECUTION_MODELS: readonly ModelDefinition[] = [
  composeModelDefinition(qwenMultipleAnglesModel, continuousPresentation),
  composeModelDefinition(perspectiveChangeModel, perspectivePresentation),
  composeModelDefinition(flux2MultipleAnglesModel, fluxPresentation),
]

const modelById = new Map(MULTI_ANGLE_EXECUTION_MODELS.map((model) => [model.meta.id, model]))

/** 仅供多角度能力执行；这些模型不注册进普通模型选择器。 */
export function getMultiAngleExecutionModel(modelId: string): ModelDefinition | undefined {
  return modelById.get(modelId)
}
