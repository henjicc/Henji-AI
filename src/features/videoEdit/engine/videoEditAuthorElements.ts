import type { CodeMatrix, CodeSourceSpan } from '@/core/videoEdit/codeMaterial/contract'
import { codeMultiply, codePoint } from '@/core/videoEdit/codeMaterial/geometry'
import type { CodeElementOverrideValues } from '@/core/videoEdit/codeElementOverrides'
import type { AuthorLayer, AuthorModule } from './videoEditAuthorModule'

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
  parameterKeys: string[]
  textParameterKeys: string[]
}

/** Observation is requested by selection/assistant, never by each Canvas call. */
export function observeAuthorElement(effect: AuthorModule, layer: AuthorLayer, index: number, bounds: [number, number, number, number], matrix: CodeMatrix): AuthorElementObservation {
  const id = authorLayerId(layer, index)
  const parameters = (effect.params ?? []).filter(parameter => parameter.layer === id || id === AUTHOR_WHOLE_EFFECT_ID)
  return {
    id, name: layer.name ?? id, bounds: [...bounds], matrix: [...matrix],
    corners: [[bounds[0], bounds[1]], [bounds[2], bounds[1]], [bounds[2], bounds[3]], [bounds[0], bounds[3]]].map(([x, y]) => codePoint(matrix, x, y)),
    ...(layer.sourceSpan ? { sourceSpan: layer.sourceSpan } : {}),
    parameterKeys: parameters.map(parameter => parameter.key),
    textParameterKeys: parameters.filter(parameter => parameter.type === 'text').map(parameter => parameter.key),
  }
}
