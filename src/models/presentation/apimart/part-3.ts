/** apimart 模型展示补丁（第 3/5 组）。 */

import { sharedFieldText, sharedModeText, sharedOptionText } from '@/core/i18n/modelText'
import type { I18nText } from '@/core/types/I18nText'
import type { ModelPresentation } from '@/core/types/ModelPresentation'

function hasUploadedImagePresentation(params: Record<string, unknown>): boolean {
  return [params.uploadedFilePaths, params.images, params.uploadedImages]
    .some((value) => Array.isArray(value) && value.length > 0)
}

export const apimartPresentationPart3: Record<string, ModelPresentation> = {
  "apimart-midjourney": {
    meta: {
      name: { key: 'meta.name', fallback: 'Midjourney' },
      i18nScope: 'models.defs.apimart-midjourney',
    },
    params: {
      "apimartMidjourneyMode": {
        name: sharedFieldText('mode'),
        optionLabels: Object.fromEntries((
          [
        { value: 'imagine', label: { zh: '生成', en: 'Generate' } },
        { value: 'edit', label: { zh: '编辑', en: 'Edit' } },
        { value: 'blend', label: { zh: '混图', en: 'Blend' } },
      ]
        ).map((rawOption) => {
          const option = rawOption as { value: string | number; label?: I18nText; description?: I18nText }
          return [String(option.value), {
            label: option.label ?? String(option.value),
            ...(option.description === undefined ? {} : { description: option.description }),
          }]
        })),
      },
      "apimartMidjourneyAspectRatio": {
        name: sharedFieldText('aspectRatio'),
        optionLabels: Object.fromEntries((
          [
        { value: 'smart', label: sharedOptionText('smart') },
        ...['1:1', '3:2', '2:3', '4:3', '3:4', '16:9', '9:16', '21:9'].map((value) => ({ value, label: value })),
      ]
        ).map((rawOption) => {
          const option = rawOption as { value: string | number; label?: I18nText; description?: I18nText }
          return [String(option.value), {
            label: option.label ?? String(option.value),
            ...(option.description === undefined ? {} : { description: option.description }),
          }]
        })),
      },
      "apimartMidjourneySpeed": {
        name: { zh: '生成速度', en: 'Generation Speed' },
        optionLabels: Object.fromEntries((
          [
        { value: 'relax', label: { zh: '休闲', en: 'Relax' } },
        { value: 'fast', label: { zh: '快速', en: 'Fast' } },
        { value: 'turbo', label: { zh: '极速', en: 'Turbo' } },
      ]
        ).map((rawOption) => {
          const option = rawOption as { value: string | number; label?: I18nText; description?: I18nText }
          return [String(option.value), {
            label: option.label ?? String(option.value),
            ...(option.description === undefined ? {} : { description: option.description }),
          }]
        })),
      },
      "apimartMidjourneyQuality": {
        name: { zh: '生成质量', en: 'Quality' },
        optionLabels: Object.fromEntries((
          ['0.25', '0.5', '1', '2'].map((value) => ({ value, label: value }))
        ).map((rawOption) => {
          const option = rawOption as { value: string | number; label?: I18nText; description?: I18nText }
          return [String(option.value), {
            label: option.label ?? String(option.value),
            ...(option.description === undefined ? {} : { description: option.description }),
          }]
        })),
      },
      "apimartMidjourneyRepeat": {
        name: { zh: '生成数量', en: 'Generation Count' },
      },
      "apimartMidjourneyVersion": {
        name: { zh: '模型版本', en: 'Model Version' },
        optionLabels: Object.fromEntries((
          [
        { value: 'auto', label: sharedOptionText('auto') },
        ...['8.2', '8.1', '7', '6.1', '6', '5.2', '5.1'].map((value) => ({ value, label: value })),
      ]
        ).map((rawOption) => {
          const option = rawOption as { value: string | number; label?: I18nText; description?: I18nText }
          return [String(option.value), {
            label: option.label ?? String(option.value),
            ...(option.description === undefined ? {} : { description: option.description }),
          }]
        })),
      },
      "apimartMidjourneyNiji": {
        name: { zh: 'Niji 动漫模型', en: 'Niji Anime Model' },
      },
      "apimartMidjourneyStylize": {
        name: { zh: '风格化强度', en: 'Stylize' },
      },
      "apimartMidjourneyChaos": {
        name: { zh: '混沌度', en: 'Chaos' },
      },
      "apimartMidjourneyWeird": {
        name: { zh: '怪异度', en: 'Weird' },
      },
      "apimartMidjourneyImageWeight": {
        name: { zh: '垫图权重', en: 'Image Weight' },
      },
      "apimartMidjourneyTile": {
        name: { zh: '无缝平铺', en: 'Seamless Tile' },
      },
      "apimartMidjourneyRaw": {
        name: { zh: '原始风格', en: 'Raw Style' },
      },
      "apimartMidjourneyDraft": {
        name: { zh: '草图模式', en: 'Draft Mode' },
      },
      "apimartMidjourneyHd": {
        name: { zh: 'HD 高清', en: 'HD' },
      },
      "apimartMidjourneyCharacterReference": {
        name: { zh: '角色参考图', en: 'Character Reference' },
      },
      "apimartMidjourneyStyleReference": {
        name: { zh: '风格参考图', en: 'Style Reference' },
      },
      "apimartMidjourneyDepthReference": {
        name: { zh: '深度参考图', en: 'Depth Reference' },
      },
      "apimartMidjourneyCharacterWeight": {
        name: { zh: '角色权重', en: 'Character Weight' },
      },
      "apimartMidjourneyStyleWeight": {
        name: { zh: '风格权重', en: 'Style Weight' },
      },
      "apimartMidjourneyDepthWeight": {
        name: { zh: '深度权重', en: 'Depth Weight' },
      },
      "apimartMidjourneyStop": {
        name: { zh: '提前停止', en: 'Stop' },
      },
      "apimartMidjourneyExtra": {
        name: { zh: '额外 Midjourney 参数', en: 'Extra Midjourney Parameters' },
        description: { zh: '原样追加到提示词末尾', en: 'Appended to the prompt unchanged' },
        rows: 2,
      },
    },
    paramPresentation: {
    groups: [{
      id: 'midjourney-settings',
      name: { zh: 'MJ 设置', en: 'MJ Settings' },
      order: 6,
      panelWidth: 480,
      sections: [
        {
          id: 'model', name: { zh: '模型', en: 'Model' },
          paramIds: ['apimartMidjourneyVersion', 'apimartMidjourneyNiji'],
        },
        {
          id: 'style', name: { zh: '风格', en: 'Style' },
          paramIds: [
            'apimartMidjourneyStylize', 'apimartMidjourneyChaos', 'apimartMidjourneyWeird',
            'apimartMidjourneyRaw', 'apimartMidjourneyTile', 'apimartMidjourneyDraft', 'apimartMidjourneyHd',
          ],
        },
        {
          id: 'references', name: { zh: '参考控制', en: 'References' },
          paramIds: [
            'apimartMidjourneyImageWeight',
            'apimartMidjourneyCharacterReference', 'apimartMidjourneyCharacterWeight',
            'apimartMidjourneyStyleReference', 'apimartMidjourneyStyleWeight',
            'apimartMidjourneyDepthReference', 'apimartMidjourneyDepthWeight',
          ],
        },
        {
          id: 'advanced', name: { zh: '高级', en: 'Advanced' },
          paramIds: ['apimartMidjourneyStop', 'apimartMidjourneyExtra'],
        },
      ],
    }],
  },
    linkages: [
    {
      trigger: 'apimartMidjourneyMode', effect: 'hide',
      targets: ['apimartMidjourneyQuality', 'apimartMidjourneyRepeat', ...([
  'apimartMidjourneyVersion',
  'apimartMidjourneyNiji',
  'apimartMidjourneyStylize',
  'apimartMidjourneyChaos',
  'apimartMidjourneyWeird',
  'apimartMidjourneyImageWeight',
  'apimartMidjourneyTile',
  'apimartMidjourneyRaw',
  'apimartMidjourneyDraft',
  'apimartMidjourneyHd',
  'apimartMidjourneyCharacterReference',
  'apimartMidjourneyStyleReference',
  'apimartMidjourneyDepthReference',
  'apimartMidjourneyDepthWeight',
  'apimartMidjourneyCharacterWeight',
  'apimartMidjourneyStyleWeight',
  'apimartMidjourneyStop',
  'apimartMidjourneyExtra',
])],
      condition: (mode) => mode === 'blend',
    },
    {
      trigger: 'apimartMidjourneyMode', effect: 'autoSwitch', target: 'apimartMidjourneyAspectRatio',
      condition: (mode, allParams) => mode === 'blend' && allParams.apimartMidjourneyAspectRatio === 'smart',
      value: '1:1',
    },
    {
      trigger: 'apimartMidjourneyNiji', effect: 'filterOptions', target: 'apimartMidjourneyVersion',
      filter: (_niji, options, allParams) => allParams.apimartMidjourneyNiji === true
        ? options.filter((option) => ['auto', '6', '7'].includes(String(option.value)))
        : options,
    },
    {
      trigger: 'apimartMidjourneyNiji', effect: 'autoSwitch', target: 'apimartMidjourneyVersion',
      condition: (niji, allParams) => niji === true && !['auto', '6', '7'].includes(String(allParams.apimartMidjourneyVersion)),
      value: '7',
    },
    {
      trigger: ['apimartMidjourneyVersion', 'apimartMidjourneyNiji'], effect: 'hide',
      targets: ['apimartMidjourneyDraft'],
      condition: (_value, allParams) => allParams.apimartMidjourneyNiji === true
        || !['auto', '7', '8.1', '8.2'].includes(String(allParams.apimartMidjourneyVersion)),
    },
    {
      trigger: ['apimartMidjourneyVersion', 'apimartMidjourneyNiji'], effect: 'hide',
      targets: ['apimartMidjourneyHd'],
      condition: (_value, allParams) => allParams.apimartMidjourneyNiji === true
        || !['auto', '8.1', '8.2'].includes(String(allParams.apimartMidjourneyVersion)),
    },
    {
      trigger: ['apimartMidjourneyVersion', 'apimartMidjourneyNiji'], effect: 'hide',
      targets: ['apimartMidjourneyStop'],
      condition: (_value, allParams) => {
        const version = String(allParams.apimartMidjourneyVersion)
        return allParams.apimartMidjourneyNiji === true
          ? version !== '6'
          : !['5.1', '5.2', '6', '6.1'].includes(version)
      },
    },
    {
      trigger: ['uploadedImages', 'images', 'apimartMidjourneyMode'], effect: 'hide',
      targets: ['apimartMidjourneyImageWeight'],
      condition: (_value, allParams) => allParams.apimartMidjourneyMode === 'blend' || !hasUploadedImagePresentation(allParams),
    },
    ...[
      ['apimartMidjourneyCharacterReference', 'apimartMidjourneyCharacterWeight'],
      ['apimartMidjourneyStyleReference', 'apimartMidjourneyStyleWeight'],
      ['apimartMidjourneyDepthReference', 'apimartMidjourneyDepthWeight'],
    ].map(([trigger, target]) => ({
      trigger,
      effect: 'hide' as const,
      targets: [target],
      condition: (_value: unknown, allParams: Record<string, unknown>) => {
        const reference = allParams[trigger]
        return Array.isArray(reference)
          ? !reference.some((item) => typeof item === 'string' && item.trim().length > 0)
          : !(typeof reference === 'string' && reference.trim().length > 0)
      },
    })),
  ],
  },
  "apimart-minimax-h3": {
    meta: {
      name: { key: 'meta.name', fallback: 'MiniMax H3' },
      i18nScope: 'models.defs.apimart-minimax-h3',
    },
    params: {
      "apimartMiniMaxH3Mode": {
        name: sharedFieldText('mode'),
        optionLabels: Object.fromEntries((
          [
        { value: 'text-image-to-video', label: sharedModeText('textImageToVideo') },
        { value: 'reference-to-video', label: sharedModeText('referenceToVideo') }
      ]
        ).map((rawOption) => {
          const option = rawOption as { value: string | number; label?: I18nText; description?: I18nText }
          return [String(option.value), {
            label: option.label ?? String(option.value),
            ...(option.description === undefined ? {} : { description: option.description }),
          }]
        })),
      },
      "apimartMiniMaxH3AspectRatio": {
        name: sharedFieldText('aspectRatio'),
        optionLabels: Object.fromEntries((
          [
        { value: 'smart', label: sharedOptionText('smart') },
        ...['21:9', '16:9', '4:3', '1:1', '3:4', '9:16'].map((ratio) => ({ value: ratio, label: ratio }))
      ]
        ).map((rawOption) => {
          const option = rawOption as { value: string | number; label?: I18nText; description?: I18nText }
          return [String(option.value), {
            label: option.label ?? String(option.value),
            ...(option.description === undefined ? {} : { description: option.description }),
          }]
        })),
      },
      "apimartMiniMaxH3Resolution": {
        name: sharedFieldText('resolution'),
        optionLabels: Object.fromEntries((
          ['768P', '2K'].map((value) => ({ value, label: value }))
        ).map((rawOption) => {
          const option = rawOption as { value: string | number; label?: I18nText; description?: I18nText }
          return [String(option.value), {
            label: option.label ?? String(option.value),
            ...(option.description === undefined ? {} : { description: option.description }),
          }]
        })),
      },
      "apimartMiniMaxH3Duration": {
        name: sharedFieldText('duration'),
      },
    },
    linkages: [],
  },
}
