import {
  evaluateRuntimeCondition,
  flattenRuntimeParams,
  getRuntimeMediaInputContract,
} from '@henjicc/ai-sdk/catalog'
import type { GenerationClient } from '@henjicc/ai-sdk/generation'

type JsonValue = null | boolean | number | string | JsonValue[] | JsonObject
type JsonObject = { [key: string]: JsonValue }
type RuntimeParamDef = ReturnType<GenerationClient['catalog']['getParams']>[number]

export type MinimalControlKind =
  | 'text'
  | 'textarea'
  | 'number'
  | 'select'
  | 'switch'
  | 'upload'
  | 'custom'

export interface MinimalRenderedControl {
  id: string
  kind: MinimalControlKind
  value: JsonValue | undefined
  disabled: boolean
  source: 'param' | 'input-limits'
  mediaKind?: 'image' | 'video' | 'audio' | 'file'
}

export interface MinimalRenderedForm {
  modelId: string
  controls: MinimalRenderedControl[]
  customControlIds: string[]
  html: string
}

/**
 * 无框架、无 DOM 依赖的最小 renderer，只用于证明 SDK 参数契约足以驱动消费方表单。
 * composite 只输出 data-control="custom" 钩子；痕迹AI 专属 panel/config 属于 presentation，
 * 宿主必须按 param id 注入自定义组件。
 */
export function renderMinimalModelForm(
  client: GenerationClient,
  modelId: string,
  values: JsonObject = {}
): MinimalRenderedForm {
  const model = client.catalog.get(modelId)
  if (!model) throw new Error(`Unknown model: ${modelId}`)
  const runtimeValues: JsonObject = {
    ...client.catalog.getDefaultValues(modelId),
    uploadedFilePaths: [],
    uploadedVideoFilePaths: [],
    uploadedAudioFilePaths: [],
    images: [],
    videos: [],
    audios: [],
    uploadedImages: [],
    uploadedVideos: [],
    uploadedAudios: [],
    ...values,
  }
  const controls: MinimalRenderedControl[] = []

  for (const param of flattenRuntimeParams(client.catalog.getParams(modelId))) {
    if (!evaluateRuntimeCondition(param.visible?.condition, runtimeValues)) continue
    controls.push({
      id: param.id,
      kind: controlKindForParam(param),
      value: runtimeValues[param.id],
      disabled: param.disabled !== undefined &&
        evaluateRuntimeCondition(param.disabled.condition, runtimeValues),
      source: 'param',
      ...mediaKindForParam(param),
    })
  }

  const media = getRuntimeMediaInputContract(model, runtimeValues)
  for (const input of media.genericInputs) {
    controls.push({
      id: input.id,
      kind: 'upload',
      value: runtimeValues[input.id],
      disabled: false,
      source: 'input-limits',
      mediaKind: input.kind,
    })
  }

  controls.sort((left, right) => {
    const leftParam = model.params.find((param) => param.id === left.id)
    const rightParam = model.params.find((param) => param.id === right.id)
    return (leftParam?.order ?? Number.MAX_SAFE_INTEGER) -
      (rightParam?.order ?? Number.MAX_SAFE_INTEGER)
  })

  return {
    modelId: model.meta.id,
    controls,
    customControlIds: controls.filter((control) => control.kind === 'custom').map((control) => control.id),
    html: `<form data-model-id="${escapeHtml(model.meta.id)}">${controls.map(renderControlHtml).join('')}</form>`,
  }
}

function controlKindForParam(param: RuntimeParamDef): MinimalControlKind {
  switch (param.type) {
    case 'text': return 'text'
    case 'textarea': return 'textarea'
    case 'number': return 'number'
    case 'dropdown':
    case 'radio':
    case 'resolution':
    case 'aspect-ratio': return 'select'
    case 'switch': return 'switch'
    case 'image-upload':
    case 'video-upload':
    case 'file-upload': return 'upload'
    case 'composite': return 'custom'
    case 'panel': return 'custom'
  }
}

function mediaKindForParam(
  param: RuntimeParamDef
): Pick<MinimalRenderedControl, 'mediaKind'> | Record<string, never> {
  if (param.type === 'image-upload') return { mediaKind: 'image' }
  if (param.type === 'video-upload') return { mediaKind: 'video' }
  if (param.type === 'file-upload') return { mediaKind: 'file' }
  return {}
}

function renderControlHtml(control: MinimalRenderedControl): string {
  const id = escapeHtml(control.id)
  const media = control.mediaKind ? ` data-media-kind="${control.mediaKind}"` : ''
  const disabled = control.disabled ? ' aria-disabled="true"' : ''
  return `<div data-param-id="${id}" data-control="${control.kind}" data-source="${control.source}"${media}${disabled}></div>`
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}
