import { describe, expect, it } from 'vitest'

import { catalog } from '../src/catalog'
import { pack as falErasePack } from '../src/packs/tool-packs/fal-image-edit-tools'
import { pack as falImageUtilityPack } from '../src/packs/tool-packs/fal-image-utility-tools'
import { pack as falMultiAnglePack } from '../src/packs/tool-packs/fal-multi-angle-tools'
import type { ModelRuntimeDefinition, RuntimeInputCountLimit, RuntimeInputLimitsConfig, RuntimeParamDef } from '../src/types/model'
import { getModelTagDefinition, isModelTag } from '../src/types/modelTags'

const models: readonly ModelRuntimeDefinition[] = [
  ...catalog,
  ...[falErasePack, falImageUtilityPack, falMultiAnglePack].flatMap((pack) => pack.models),
]

type MediaKind = 'images' | 'videos'

/** 基础限制与每条规则覆盖后的各种情形；没写限制（按宿主默认上传）或函数形式（要看参数取值）返回 null，表示静态判断不了。 */
function limitScenarios(model: ModelRuntimeDefinition): RuntimeInputLimitsConfig[] | null {
  const limits = model.inputLimits
  if (!limits || typeof limits === 'function') return null
  const { rules = [], ...base } = limits
  return [base, ...rules.map((rule) => ({ images: rule.images ?? base.images, videos: rule.videos ?? base.videos, audios: rule.audios ?? base.audios }))]
}

function flatParams(params: readonly RuntimeParamDef[]): RuntimeParamDef[] {
  return params.flatMap((param) => param.type === 'panel' ? flatParams(param.children ?? []) : [param])
}

// 写了这类素材却不给上限表示不限张数
const upper = (limit: RuntimeInputCountLimit | undefined): number => limit ? limit.exact ?? limit.max ?? Infinity : 0
const lower = (limit: RuntimeInputCountLimit | undefined): number => limit?.exact ?? limit?.min ?? 0

function canAccept(model: ModelRuntimeDefinition, kind: MediaKind, count: number): boolean {
  const scenarios = limitScenarios(model)
  if (!scenarios) return true
  return scenarios.some((scenario) => upper(scenario[kind]) >= count)
}

function canRunWithout(model: ModelRuntimeDefinition, kind: MediaKind): boolean {
  const scenarios = limitScenarios(model)
  return !scenarios || scenarios.some((scenario) => lower(scenario[kind]) === 0)
}

function hasMaskInput(model: ModelRuntimeDefinition): boolean {
  return (model.runtimeConstraints?.mediaFields ?? []).some((field) => /mask/i.test(field.field))
    || flatParams(model.params).some((param) => /mask/i.test(param.id))
}

// 模式、任务类型、背景这类选项的取值直接说明了能力；按模型类型对应到标签，选项里有就必须打上
const OPTION_TAGS: Record<'image' | 'video', Record<string, string>> = {
  image: { 'image-to-image': 'image-to-image', 'layer-decomposition': 'layer-decomposition', transparent: 'transparent-background', gif: 'animated-image', svg: 'vector-image' },
  video: {
    'image-to-video': 'image-to-video', 'start-end-frame': 'start-end-frame', 'reference-to-video': 'reference-mode', reference: 'reference-mode',
    'video-extension': 'video-extension', extend: 'video-extension', 'motion-control': 'motion-control', 'retake-video': 'video-to-video', edit: 'video-to-video',
  },
}

function optionValues(model: ModelRuntimeDefinition): Set<string> {
  return new Set(flatParams(model.params).flatMap((param) => (param.options ?? []).map((option) => String(option.value))))
}

describe('模型能力标签', () => {
  it.each(models.map((model) => [model.meta.id, model] as const))('%s 的标签取自词表且与模型配置一致', (_, model) => {
    const tags = model.meta.tags ?? []
    const problems: string[] = []
    if (!tags.length) problems.push('没有任何能力标签')
    if (new Set(tags).size !== tags.length) problems.push('标签重复')
    for (const tag of tags) {
      if (!isModelTag(tag)) { problems.push(`${tag} 不在词表里`); continue }
      if (getModelTagDefinition(tag).mediaType !== model.meta.type) problems.push(`${tag} 不属于 ${model.meta.type} 类型`)
    }
    const has = (tag: string): boolean => (tags as readonly string[]).includes(tag)
    if (has('start-end-frame') && !has('image-to-video')) problems.push('首尾帧必须同时有图生视频')
    if (has('start-end-frame') && !canAccept(model, 'images', 2)) problems.push('首尾帧但输入限制传不了 2 张图')
    if ((has('image-to-video') || has('image-to-image')) && !canAccept(model, 'images', 1)) problems.push('需要传图但输入限制不收图')
    if ((has('video-to-video') || has('video-extension') || has('motion-control')) && !canAccept(model, 'videos', 1)) problems.push('需要传视频但输入限制不收视频')
    if ((has('text-to-image') || has('text-to-video')) && !canRunWithout(model, 'images')) problems.push('文生但每种情形都必须传图')
    if ((has('inpainting') || has('erase')) && !hasMaskInput(model)) problems.push('局部重绘或擦除但没有遮罩输入')
    // 反向：收某种素材，就必须有说明它怎么用这份素材的标签，否则就是漏打
    const anyOf = (...candidates: string[]): boolean => candidates.some(has)
    const accepts = (kind: MediaKind): boolean => limitScenarios(model)?.some((scenario) => upper(scenario[kind]) > 0) === true
    if (model.meta.type === 'video' && accepts('images') && !anyOf('image-to-video', 'reference-mode', 'motion-control')) problems.push('收图却没有用图的视频形态')
    if (model.meta.type === 'video' && accepts('videos') && !anyOf('video-to-video', 'video-extension', 'reference-mode', 'motion-control')) problems.push('收视频却没有用视频的形态')
    if (model.meta.type === 'image' && accepts('images') && !tags.some((tag) => tag === 'image-to-image' || getModelTagDefinition(tag).layer === 'specialty')) problems.push('收图却没有图片编辑或专项')
    if (model.meta.type === 'image' || model.meta.type === 'video') {
      const values = optionValues(model)
      for (const [value, tag] of Object.entries(OPTION_TAGS[model.meta.type])) {
        if (values.has(value) && !has(tag)) problems.push(`有 ${value} 选项却没打 ${tag}`)
      }
    }
    expect(problems).toEqual([])
  })
})
