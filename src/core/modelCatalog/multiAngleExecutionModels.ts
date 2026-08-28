import { model as perspectiveChangeModel } from '@henjicc/ai-sdk/tool-models/fal/perspective-change'
import { model as qwenMultipleAnglesModel } from '@henjicc/ai-sdk/tool-models/fal/qwen-image-edit-2509-multiple-angles'

import { composeModelDefinition } from '@/core/composeModelDefinition'
import type { ModelDefinition } from '@/core/types'
import type { ModelPresentation } from '@/core/types/ModelPresentation'

const continuousPresentation: ModelPresentation = {
  meta: { name: { zh: '连续多角度', en: 'Continuous Multi-angle' } },
  params: {
    image: { name: { zh: '源图', en: 'Source image' } },
    rotateRightLeft: { name: { zh: '水平模型控制', en: 'Horizontal model control' } },
    verticalAngle: { name: { zh: '垂直模型控制', en: 'Vertical model control' } },
    moveForward: { name: { zh: '向前移动', en: 'Move forward' } },
    wideAngleLens: { name: { zh: '广角倾向', en: 'Wide-angle tendency' } },
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

export const MULTI_ANGLE_EXECUTION_MODELS: readonly ModelDefinition[] = [
  composeModelDefinition(qwenMultipleAnglesModel, continuousPresentation),
  composeModelDefinition(perspectiveChangeModel, perspectivePresentation),
]

const modelById = new Map(MULTI_ANGLE_EXECUTION_MODELS.map((model) => [model.meta.id, model]))

/** 仅供多角度能力执行；这些模型不注册进普通模型选择器。 */
export function getMultiAngleExecutionModel(modelId: string): ModelDefinition | undefined {
  return modelById.get(modelId)
}
