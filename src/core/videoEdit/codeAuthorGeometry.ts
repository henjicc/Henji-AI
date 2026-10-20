import type { CodeMatrix } from './codeMaterial/contract'
import { codeMultiply } from './codeMaterial/geometry'
import type { CodeElementOverrideValues } from './codeElementOverrides'
type AuthorElementOverride = Pick<CodeElementOverrideValues, 'dx' | 'dy' | 'scale' | 'scaleX' | 'scaleY' | 'rotation' | 'opacity' | 'hidden'>

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

