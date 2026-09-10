import type { ModelPresentation, ParamPresentationEntry } from '@/core/types/ModelPresentation'
import { sharedFieldText, sharedOptionText } from '@/core/i18n/modelText'
import { falPresentation } from './fal'

const ratios = ['1:1', '3:2', '2:3', '4:3', '3:4', '5:4', '4:5', '16:9', '9:16', '2:1', '1:2', '21:9', '9:21', '3:1', '1:3', '27:16', '16:27', '9:8', '8:9']
const extRatios = ['smart', '1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '5:4', '4:5', '21:9']
const oneKOnly = ['27:16', '16:27', '9:8', '8:9']
const common: Record<string, ParamPresentationEntry> = {
  gpt25Variant: {
    role: 'mode', name: { zh: '版本', en: 'Version' },
    optionLabels: {
      standard: { label: { zh: '标准 · 1K', en: 'Standard · 1K' } },
      flare: { label: 'Flare' }, sunburst: { label: 'Sunburst' },
    },
    tooltip: { zh: 'Flare 适合快速迭代，Sunburst 侧重精细编辑；具体参数和价格以当前供应商为准。', en: 'Flare favors fast iteration; Sunburst prioritizes precise editing. Parameters and prices depend on the provider.' },
  },
  gpt25AspectRatio: {
    name: sharedFieldText('aspectRatio'),
    optionLabels: { smart: { label: sharedOptionText('smart') }, ...Object.fromEntries(ratios.map(r => [r, { label: r }])) },
  },
  gpt25Resolution: { name: sharedFieldText('resolution'), optionLabels: Object.fromEntries(['1K', '2K', '4K'].map(r => [r, { label: r }])) },
  gpt25Quality: {
    name: sharedFieldText('quality'),
    optionLabels: {
      auto: { label: sharedOptionText('auto') }, low: { label: { zh: '低', en: 'Low' } },
      medium: { label: { zh: '标准', en: 'Medium' } }, high: { label: { zh: '高', en: 'High' } },
      xhigh: { label: { zh: '超高', en: 'Extra high' } }, max: { label: { zh: '最高', en: 'Maximum' } },
    },
    tooltip: { zh: '更高质量通常增加耗时和费用；自动档的实际费用由模型选择的质量决定。', en: 'Higher quality usually increases latency and cost. Auto pricing depends on the quality selected by the model.' },
  },
  gpt25Count: { name: sharedFieldText('numberOfImages') },
  gpt25Background: {
    name: { zh: '背景', en: 'Background' },
    optionLabels: { auto: { label: sharedOptionText('auto') }, opaque: { label: { zh: '不透明', en: 'Opaque' } }, transparent: { label: { zh: '透明', en: 'Transparent' } } },
  },
}

function presentation(id: string, fields: string[]): ModelPresentation {
  return {
    meta: { name: { key: 'meta.name', fallback: 'GPT Image 2.5' }, i18nScope: `models.defs.${id}` },
    params: Object.fromEntries(fields.map(field => [field, common[field]])), linkages: [],
  }
}

const kie = presentation('kie-gpt-image-2.5', ['gpt25Variant', 'gpt25AspectRatio', 'gpt25Resolution', 'gpt25Background'])
kie.linkages = [{
  trigger: 'gpt25Resolution', effect: 'filterOptions', target: 'gpt25AspectRatio',
  filter: (resolution, options) => options.filter(o => resolution === '1K' || !oneKOnly.includes(String(o.value))),
}]
kie.params.gpt25AspectRatio = { ...common.gpt25AspectRatio, tooltip: { zh: '27:16、16:27、9:8、8:9 仅支持 1K，2K/4K 会隐藏这些比例。', en: '27:16, 16:27, 9:8 and 8:9 are available only at 1K.' } }

const apimart = presentation('apimart-gpt-image-2.5', ['gpt25Variant', 'gpt25AspectRatio', 'gpt25Resolution', 'gpt25Quality', 'gpt25Count', 'gpt25Background'])
apimart.params.gpt25Channel = {
  role: 'channel', name: sharedFieldText('apiChannel'),
  optionLabels: { ext: { label: 'Ext' }, official: { label: sharedOptionText('official') } },
}
apimart.linkages = [{
  trigger: 'gpt25Channel', effect: 'filterOptions', target: 'gpt25AspectRatio',
  filter: (channel, options) => options.filter(o => channel === 'official' || extRatios.includes(String(o.value))),
}]

const fal = presentation('fal-ai-gpt-image-2.5', ['gpt25Variant', 'gpt25AspectRatio', 'gpt25Resolution', 'gpt25Quality', 'gpt25Count', 'gpt25Background'])
// 复用已登记的遮罩创作契约，让生成面板与画布共同使用同一个编辑器。
fal.params.gpt25Mask = falPresentation['fal-ai-gpt-image-2'].params.falGptImage2MaskUrl

const grsai = presentation('grsai-gpt-image-2.5', ['gpt25Variant', 'gpt25AspectRatio', 'gpt25Resolution', 'gpt25Quality'])
grsai.params.gpt25Transparent = { name: { zh: '透明背景', en: 'Transparent background' } }
grsai.linkages = [
  {
    trigger: 'gpt25Variant', effect: 'filterOptions', target: 'gpt25Quality',
    filter: (variant, options) => options.filter(o => variant === 'sunburst' || !['xhigh', 'max'].includes(String(o.value))),
  },
  {
    trigger: ['gpt25Variant', 'gpt25Resolution'], effect: 'filterOptions', target: 'gpt25AspectRatio',
    filter: (_value, options, params) => options.filter(o => (params.gpt25Variant !== 'standard' && params.gpt25Resolution !== '2K') || !['1:3', '3:1'].includes(String(o.value))),
  },
]

export const gptImage25Presentation: Record<string, ModelPresentation> = {
  'kie-gpt-image-2.5': kie, 'apimart-gpt-image-2.5': apimart,
  'fal-ai-gpt-image-2.5': fal, 'grsai-gpt-image-2.5': grsai,
}

// filterOptions 只裁剪菜单，不修改已选值；切换渠道/分辨率后同步恢复默认值。
for (const model of Object.values(gptImage25Presentation)) {
  const resets = (model.linkages ?? []).flatMap(linkage => linkage.effect === 'filterOptions' ? [{
    trigger: linkage.trigger, effect: 'reset' as const, targets: [linkage.target],
    condition: (_value: DynamicValue, params: DynamicValueMap) => {
      const current = params[linkage.target]
      if (current === undefined) return false
      const trigger = Array.isArray(linkage.trigger) ? linkage.trigger[0] : linkage.trigger
      return linkage.filter(params[trigger], [{ value: String(current), label: String(current) }], params).length === 0
    },
  }] : [])
  model.linkages = [...(model.linkages ?? []), ...resets]
}
