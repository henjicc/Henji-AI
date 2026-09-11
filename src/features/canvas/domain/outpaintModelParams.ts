import { getAspectChoiceParams, isSmartAspectValue, resolveLeastCropAspectValue } from '@/core/params/ratioResolution'
import type { ModelDefinition } from '@/core/types'
import { LinkageEngine } from '@/core/linkage'
import { OUTPAINT_FIELDS, resolveOutpaintMargins, type OutpaintImageSize } from './outpaintGeometry'

// 工作面约束与模型选择解耦，切换模型不会改变已有构图。
export const OUTPAINT_WORKSPACE_MAXIMUM = 700
export const OUTPAINT_REPAIR_PROMPT = '修复图片周围的模糊区域，补全为自然清晰的画面。保留中间清晰区域的主体、细节和位置，不要裁掉周围区域。'

export function isNativeOutpaintModel(model: ModelDefinition): boolean {
  return OUTPAINT_FIELDS.every(id => model.params.some(param => param.id === id && param.type === 'number'))
}

export function resolveOutpaintModelParams(model: ModelDefinition, params: DynamicValueMap, source: OutpaintImageSize, marginsInput: Record<string, unknown>) {
  const margins = resolveOutpaintMargins(marginsInput, source, OUTPAINT_WORKSPACE_MAXIMUM)
  const size = { width: source.width + margins.expandLeft + margins.expandRight,
    height: source.height + margins.expandTop + margins.expandBottom }
  const next = { ...params }
  if (isNativeOutpaintModel(model)) return { params: { ...next, ...margins, zoomOutPercentage: 0 }, size, margins }
  for (const key of [...OUTPAINT_FIELDS, 'zoomOutPercentage']) delete next[key]
  const linkage = new LinkageEngine(model.linkages ?? [])
  for (const param of getAspectChoiceParams(model.params)) {
    const definition = model.params.find(item => item.id === param.id)
    const filtered = definition?.type === 'dropdown' || definition?.type === 'radio'
      ? linkage.getFilteredOptions(param.id, next, model.params) : param.options
    const options = param.options.filter(option => !option.disabled && filtered.some(entry =>
      entry && typeof entry === 'object' && 'value' in entry && entry.value === option.value))
    const value = resolveLeastCropAspectValue({ ...param, options }, size.width / size.height)
      ?? options.find(option => isSmartAspectValue(option.value))?.value
    if (value !== undefined && value !== null) {
      next[param.id] = value
      if (param.apiField) next[param.apiField] = value
    }
  }
  next.__firstImageRatio = size.width / size.height
  return { params: next, size, margins }
}

export function readOutpaintComposition(data: object): Record<string, unknown> {
  const record = data as { outpaintMargins?: unknown; params?: DynamicValueMap }
  return record.outpaintMargins && typeof record.outpaintMargins === 'object' && !Array.isArray(record.outpaintMargins)
    ? record.outpaintMargins as Record<string, unknown> : record.params ?? {}
}
