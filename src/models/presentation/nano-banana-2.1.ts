import { sharedFieldText, sharedOptionText } from '@/core/i18n/modelText'
import type { ModelPresentation, ParamPresentationEntry } from '@/core/types/ModelPresentation'

const ratios = ['1:1', '2:3', '3:2', '1:4', '4:1', '3:4', '4:3', '4:5', '5:4', '1:8', '8:1', '9:16', '16:9', '21:9']
const aspectRatio: ParamPresentationEntry = {
  name: sharedFieldText('aspectRatio'),
  optionLabels: { smart: { label: sharedOptionText('smart') }, ...Object.fromEntries(ratios.map(value => [value, { label: value }])) },
}
const resolution: ParamPresentationEntry = {
  name: sharedFieldText('resolution'), optionLabels: Object.fromEntries(['1K', '2K', '4K'].map(value => [value, { label: value }])),
}
const outputFormat: ParamPresentationEntry = {
  name: { zh: '输出格式', en: 'Output format' }, optionLabels: Object.fromEntries(['jpg', 'jpeg', 'png', 'webp'].map(value => [value, { label: value.toUpperCase() }])),
}

function presentation(id: string, prefix: string): ModelPresentation {
  return {
    meta: { name: { key: 'meta.name', fallback: 'Nano Banana 2.1' }, i18nScope: `models.defs.${id}` },
    params: { [`${prefix}AspectRatio`]: aspectRatio, [`${prefix}Resolution`]: resolution }, linkages: [],
  }
}
const apimart = presentation('apimart-nano-banana-2.1', 'apimartNanoBanana21')
apimart.params.apimartNanoBanana21Channel = {
  role: 'channel', name: sharedFieldText('apiChannel'),
  optionLabels: { official: { label: sharedOptionText('official'), description: { zh: '按实际 Token 结算；每次 1–4 张', en: 'Actual token billing; 1–4 images' } }, ext: { label: 'Ext', description: { zh: '按张计费；每次 1 张', en: 'Per-image billing; one image' } } },
}
apimart.params.apimartNanoBanana21NumImages = { name: sharedFieldText('numberOfImages') }
apimart.linkages = [
  { trigger: ['apimartNanoBanana21Channel', 'apimartNanoBanana21Resolution'], effect: 'filterOptions', target: 'apimartNanoBanana21AspectRatio',
    filter: (_value, options, params) => options.filter(o => params.apimartNanoBanana21Channel !== 'ext' || params.apimartNanoBanana21Resolution === '1K' || !['1:4', '4:1', '1:8', '8:1'].includes(String(o.value))) },
  { trigger: ['apimartNanoBanana21Channel', 'apimartNanoBanana21Resolution'], effect: 'autoSwitch', target: 'apimartNanoBanana21AspectRatio',
    condition: (_value, params) => params.apimartNanoBanana21Channel === 'ext' && params.apimartNanoBanana21Resolution !== '1K' && ['1:4', '4:1', '1:8', '8:1'].includes(String(params.apimartNanoBanana21AspectRatio)), value: 'smart' },
  { trigger: 'apimartNanoBanana21Channel', effect: 'autoSwitch', target: 'apimartNanoBanana21NumImages', condition: channel => channel === 'ext', value: 1 },
]
const kie = presentation('kie-nano-banana-2.1', 'kieNanoBanana21')
kie.params.kieNanoBanana21OutputFormat = outputFormat
const fal = presentation('fal-ai-nano-banana-2.1', 'falNanoBanana21')
Object.assign(fal.params, {
  falNanoBanana21NumImages: { name: sharedFieldText('numberOfImages') },
  falNanoBanana21WebSearch: { name: { zh: '联网搜索', en: 'Web search' } },
  falNanoBanana21Thinking: { name: { zh: '思考深度', en: 'Thinking depth' }, optionLabels: {
    minimal: { label: { zh: '轻量', en: 'Minimal' } }, medium: { label: { zh: '标准', en: 'Medium' } }, high: { label: { zh: '深入', en: 'High' } },
  } },
  falNanoBanana21Pdf: { name: { zh: 'PDF 上下文', en: 'PDF context' }, uploadButtonText: { zh: '上传 PDF', en: 'Upload PDF' } },
  falNanoBanana21SystemPrompt: { name: { zh: '风格指令', en: 'Style instruction' } },
  falNanoBanana21OutputFormat: outputFormat,
  falNanoBanana21LimitGenerations: { name: { zh: '按指定数量出图', en: 'Follow image count' }, tooltip: { zh: '开启后忽略提示词中的额外出图指令及中间图，可能影响生成质量。', en: 'Ignore extra image instructions and intermediate images; may affect quality.' } },
} satisfies Record<string, ParamPresentationEntry>)
export const nanoBanana21Presentation: Record<string, ModelPresentation> = {
  'apimart-nano-banana-2.1': apimart, 'kie-nano-banana-2.1': kie,
  'fal-ai-nano-banana-2.1': fal, 'grsai-nano-banana-2.1': presentation('grsai-nano-banana-2.1', 'grsaiNanoBanana21'),
}
