/** 魔搭（modelscope）模型的展示补丁：i18n 文案、联动、面板布局。按模型 id 关联运行时定义。 */

import { sharedFieldText, sharedOptionText } from '@/core/i18n/modelText'
import type { ModelPresentation } from '@/core/types/ModelPresentation'

const ratioLabel = (ratio: string) => ({ label: ratio })

const ASPECT_RATIO_OPTION_LABELS = Object.fromEntries(
  ['21:9', '16:9', '3:2', '4:3', '1:1', '3:4', '2:3', '9:16', '9:21'].map((ratio) => [ratio, ratioLabel(ratio)])
)

const negativePromptEntry = {
  name: sharedFieldText('negativePrompt'),
  multiline: true,
  editor: { kind: 'prompt' as const, preset: 'plain' as const },
}

export const modelscopePresentation: Record<string, ModelPresentation> = {
  'black-forest-labs/FLUX.1-Krea-dev': {
    meta: {
      name: { key: 'meta.name', fallback: 'FLUX.1-Krea-dev' },
      i18nScope: 'models.defs.black-forest-labs/FLUX.1-Krea-dev',
    },
    params: {
      modelscopeImageSize: { name: sharedFieldText('aspectRatio'), optionLabels: ASPECT_RATIO_OPTION_LABELS },
      resolutionBaseSize: { name: sharedFieldText('baseSize') },
      modelscopeSteps: { name: sharedFieldText('steps') },
      modelscopeGuidance: { name: sharedFieldText('guidance') },
      modelscopeNegativePrompt: negativePromptEntry,
    },
    linkages: [],
  },

  'MusePublic/majicMIX_realistic': {
    meta: {
      name: { key: 'meta.name', fallback: 'majicMIX Realistic' },
      i18nScope: 'models.defs.MusePublic/majicMIX_realistic',
    },
    params: {
      modelscopeImageSize: { name: sharedFieldText('aspectRatio'), optionLabels: ASPECT_RATIO_OPTION_LABELS },
      resolutionBaseSize: { name: sharedFieldText('baseSize') },
      modelscopeSteps: { name: sharedFieldText('steps') },
      modelscopeGuidance: { name: sharedFieldText('guidance') },
      modelscopeNegativePrompt: negativePromptEntry,
    },
    linkages: [],
  },

  'MusePublic/14_ckpt_SD_XL': {
    meta: {
      name: { key: 'meta.name', fallback: 'SD XL 1.4' },
      i18nScope: 'models.defs.MusePublic/14_ckpt_SD_XL',
    },
    params: {
      modelscopeImageSize: { name: sharedFieldText('aspectRatio'), optionLabels: ASPECT_RATIO_OPTION_LABELS },
      resolutionBaseSize: { name: sharedFieldText('baseSize') },
      modelscopeSteps: { name: sharedFieldText('steps') },
      modelscopeGuidance: { name: sharedFieldText('guidance') },
      modelscopeNegativePrompt: negativePromptEntry,
    },
    linkages: [],
  },

  'Qwen/Qwen-Image': {
    meta: {
      name: { key: 'meta.name', fallback: 'Qwen-Image' },
      i18nScope: 'models.defs.Qwen/Qwen-Image',
    },
    params: {
      modelscopeImageSize: { name: sharedFieldText('aspectRatio'), optionLabels: ASPECT_RATIO_OPTION_LABELS },
      resolutionBaseSize: { name: sharedFieldText('baseSize') },
      modelscopeSteps: { name: sharedFieldText('steps') },
      modelscopeGuidance: { name: sharedFieldText('guidance') },
      modelscopeNegativePrompt: negativePromptEntry,
    },
    linkages: [],
  },

  'Tongyi-MAI/Z-Image-Turbo': {
    meta: {
      name: { key: 'meta.name', fallback: 'Z-Image-Turbo' },
      i18nScope: 'models.defs.Tongyi-MAI/Z-Image-Turbo',
    },
    params: {
      modelscopeImageSize: { name: sharedFieldText('aspectRatio'), optionLabels: ASPECT_RATIO_OPTION_LABELS },
      resolutionBaseSize: { name: sharedFieldText('baseSize') },
      modelscopeSteps: { name: sharedFieldText('steps') },
      modelscopeNegativePrompt: negativePromptEntry,
    },
    linkages: [],
  },

  'Qwen/Qwen-Image-Edit-2509': {
    meta: {
      name: { key: 'meta.name', fallback: 'Qwen-Image-Edit-2509' },
      i18nScope: 'models.defs.Qwen/Qwen-Image-Edit-2509',
    },
    params: {
      modelscopeImageSize: {
        name: sharedFieldText('aspectRatio'),
        optionLabels: { smart: { label: sharedOptionText('smart') }, ...ASPECT_RATIO_OPTION_LABELS },
      },
      modelscopeSteps: { name: sharedFieldText('steps') },
    },
    linkages: [],
  },

  'modelscope-custom': {
    meta: {
      name: { key: 'meta.name', fallback: 'ModelScope Custom' },
      i18nScope: 'models.defs.modelscope-custom',
    },
    params: {
      modelscopeCustomModel: {
        name: sharedFieldText('model'),
        panel: 'modelscope-custom-model',
      },
      modelscopeImageSize: {
        name: sharedFieldText('aspectRatio'),
        optionLabels: { smart: { label: sharedOptionText('smart') }, ...ASPECT_RATIO_OPTION_LABELS },
      },
      resolutionBaseSize: { name: sharedFieldText('baseSize') },
      modelscopeSteps: { name: sharedFieldText('steps') },
      modelscopeGuidance: { name: sharedFieldText('guidance') },
    },
    linkages: [],
  },
}
