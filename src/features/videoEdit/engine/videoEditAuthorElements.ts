import type { CodeMatrix } from '@/core/videoEdit/codeMaterial/contract'
import type { AuthorElementObservation } from '@/core/videoEdit/codeAuthorProgram'
export type { AuthorElementObservation } from '@/core/videoEdit/codeAuthorProgram'
import { codePoint } from '@/core/videoEdit/codeMaterial/geometry'
import type { CodeElementOverrideValues } from '@/core/videoEdit/codeElementOverrides'
import type { AuthorLayer, AuthorModule, AuthorParameters } from './videoEditAuthorModule'

/** The host edits placement only. Text and paint belong to declared parameters. */
export type AuthorElementOverride = Pick<CodeElementOverrideValues, 'dx' | 'dy' | 'scale' | 'scaleX' | 'scaleY' | 'rotation' | 'opacity' | 'hidden'>
export type AuthorElementOverrides = Readonly<Record<string, AuthorElementOverride>>
export const AUTHOR_WHOLE_EFFECT_ID = 'effect'

export function authorLayerId(layer: AuthorLayer, index: number): string { return layer.id ?? `layer:${index}` }

export { authorOverrideMatrix } from '@/core/videoEdit/codeAuthorGeometry'

/** Resolve only when observed, against the parameters of the rendered frame. */
export function authorLayerData(layer: AuthorLayer, values: AuthorParameters): AuthorElementObservation['data'] {
  const binding = layer.data
  if (!binding) return undefined
  const rows = values[binding.parameter]
  if (!Array.isArray(rows)) throw new Error(`图层 ${layer.id ?? layer.name ?? ''} 的数据参数 ${binding.parameter} 不是数据表。`)
  const matches = 'key' in binding ? rows.flatMap((row: unknown, index: number) => row && typeof row === 'object' && Object.hasOwn(row, binding.keyField) && (row as Record<string, unknown>)[binding.keyField] === binding.key ? [index] : []) : [binding.index]
  if (matches.length !== 1 || !Number.isSafeInteger(matches[0]) || matches[0] < 0 || matches[0] >= rows.length) throw new Error(`图层 ${layer.id ?? layer.name ?? ''} 的数据项不存在或不唯一，请更新数据绑定。`)
  return { ...binding, index: matches[0], value: structuredClone(rows[matches[0]]) }
}

/** Observation is requested by selection/assistant, never by each Canvas call. */
export function observeAuthorElement(effect: AuthorModule, layer: AuthorLayer, index: number, bounds: [number, number, number, number], matrix: CodeMatrix, values?: AuthorParameters): AuthorElementObservation {
  const id = authorLayerId(layer, index)
  const parameters = (effect.params ?? []).filter(parameter => parameter.layer === id || parameter.key === layer.data?.parameter || id === AUTHOR_WHOLE_EFFECT_ID)
  const data = values ? authorLayerData(layer, values) : undefined
  return {
    id, name: layer.name ?? id, bounds: [...bounds], matrix: [...matrix],
    corners: [[bounds[0], bounds[1]], [bounds[2], bounds[1]], [bounds[2], bounds[3]], [bounds[0], bounds[3]]].map(([x, y]) => codePoint(matrix, x, y)),
    ...(layer.sourceSpan ? { sourceSpan: layer.sourceSpan } : {}),
    ...(layer.factory ? { factory: { ...layer.factory } } : {}),
    parameterKeys: parameters.map(parameter => parameter.key),
    textParameterKeys: parameters.filter(parameter => parameter.type === 'text').map(parameter => parameter.key),
    ...(data ? { data } : {}),
  }
}
