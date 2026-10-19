import type { CodeMatrix, CodeSourceSpan } from '@/core/videoEdit/codeMaterial/contract'
import { codeMultiply, codePoint } from '@/core/videoEdit/codeMaterial/geometry'
import type { CodeElementOverrideValues } from '@/core/videoEdit/codeElementOverrides'
import type { AuthorLayer, AuthorModule, AuthorParameters } from './videoEditAuthorModule'

/** The host edits placement only. Text and paint belong to declared parameters. */
export type AuthorElementOverride = Pick<CodeElementOverrideValues, 'dx' | 'dy' | 'scale' | 'scaleX' | 'scaleY' | 'rotation' | 'opacity' | 'hidden'>
export type AuthorElementOverrides = Readonly<Record<string, AuthorElementOverride>>
export const AUTHOR_WHOLE_EFFECT_ID = 'effect'

export function authorLayerId(layer: AuthorLayer, index: number): string { return layer.id ?? `layer:${index}` }

/** Same local-axis/center convention as existing direct manipulation; translation
 * stays in composition coordinates. Called only when an override exists. */
export function authorOverrideMatrix(matrix: CodeMatrix, bounds: readonly number[], value: AuthorElementOverride): CodeMatrix {
  const x = (bounds[0] + bounds[2]) / 2, y = (bounds[1] + bounds[3]) / 2
  const angle = (value.rotation ?? 0) * Math.PI / 180, c = Math.cos(angle), s = Math.sin(angle)
  const sx = (value.scale ?? 1) * (value.scaleX ?? 1), sy = (value.scale ?? 1) * (value.scaleY ?? 1)
  const local: CodeMatrix = [c * sx, s * sx, -s * sy, c * sy, x - c * sx * x + s * sy * y, y - s * sx * x - c * sy * y]
  const result = codeMultiply(matrix, local)
  result[4] += value.dx ?? 0; result[5] += value.dy ?? 0
  return result
}

export interface AuthorElementObservation {
  id: string
  name: string
  bounds: [number, number, number, number]
  matrix: CodeMatrix
  corners: [number, number][]
  sourceSpan?: CodeSourceSpan
  factory?: { file: string; name: string }
  parameterKeys: string[]
  textParameterKeys: string[]
  data?: { parameter: string; index: number; key?: string | number; keyField?: string; value: unknown }
}

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
