/** 火山方舟（volcengine）模型的展示补丁：i18n 文案、联动、面板布局。按模型 id 关联运行时定义。 */

import { sharedFieldText, sharedOptionText } from '@/core/i18n/modelText'
import type { ModelPresentation } from '@/core/types/ModelPresentation'

export const volcenginePresentation: Record<string, ModelPresentation> = {
  'volcengine-seedream-5.0-lite': {
    meta: {
      name: { key: 'meta.name', fallback: 'Seedream 5.0 Lite' },
      i18nScope: 'models.defs.volcengine-seedream-5.0-lite',
    },
    params: {
      volcengineSeedream50LiteAspectRatio: {
        name: sharedFieldText('aspectRatio'),
        optionLabels: {
          smart: { label: sharedOptionText('smart') },
          '1:1': { label: '1:1' },
          '4:3': { label: '4:3' },
          '3:4': { label: '3:4' },
          '16:9': { label: '16:9' },
          '9:16': { label: '9:16' },
          '3:2': { label: '3:2' },
          '2:3': { label: '2:3' },
          '21:9': { label: '21:9' },
        },
      },
      volcengineSeedream50LiteResolution: {
        name: sharedFieldText('resolution'),
        optionLabels: {
          '2K': { label: '2K' },
          '3K': { label: '3K' },
          '4K': { label: '4K' },
        },
      },
      volcengineSeedream50LiteCount: {
        name: { zh: '最大生成数量', en: 'Maximum Outputs' },
      },
    },
    linkages: [],
  },

  'volcengine-seedream-5.0-pro': {
    meta: {
      name: { key: 'meta.name', fallback: 'Seedream 5.0 Pro' },
      i18nScope: 'models.defs.volcengine-seedream-5.0-pro',
    },
    params: {
      volcengineSeedream50ProMode: {
        name: { zh: '模式', en: 'Mode' },
        role: 'mode',
        optionLabels: {
          generate: { label: { zh: '生成 / 编辑', en: 'Generate / Edit' } },
          'layer-decomposition': { label: { zh: '图层拆分', en: 'Layer Decomposition' } },
        },
      },
      volcengineSeedream50ProAspectRatio: {
        name: sharedFieldText('aspectRatio'),
        optionLabels: {
          smart: { label: sharedOptionText('smart') },
          '1:1': { label: '1:1' },
          '4:3': { label: '4:3' },
          '3:4': { label: '3:4' },
          '16:9': { label: '16:9' },
          '9:16': { label: '9:16' },
          '3:2': { label: '3:2' },
          '2:3': { label: '2:3' },
          '21:9': { label: '21:9' },
        },
      },
      volcengineSeedream50ProResolution: {
        name: sharedFieldText('resolution'),
        optionLabels: {
          '1K': { label: '1K' },
          '1.5K': { label: '1.5K' },
          '2K': { label: '2K' },
        },
      },
      volcengineSeedream50ProLayerSize: {
        name: sharedFieldText('resolution'),
        optionLabels: {
          auto: { label: sharedOptionText('auto') },
          '1K': { label: '1K' },
          '1.5K': { label: '1.5K' },
          '2K': { label: '2K' },
        },
      },
      volcengineSeedream50ProBackground: {
        name: { zh: '背景', en: 'Background' },
        optionLabels: {
          opaque: { label: { zh: '不透明', en: 'Opaque' } },
          transparent: { label: { zh: '透明', en: 'Transparent' } },
        },
      },
    },
    linkages: [],
  },
}
