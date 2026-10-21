import type { CodeMatrix, CodeSourceSpan } from './contract'
import type { AuthorElementObservation } from '../codeAuthorProgram'

export type CodePoint = [number, number]
/** Selection metadata for one observed author layer; never a reconstruction of the author's drawing. */
export interface CodeElementBounds { elementId: string; sourceSpan?: CodeSourceSpan; elementPath: string[]; x: number; y: number; width: number; height: number; matrix: CodeMatrix; opacity: number; author: AuthorElementObservation }
export const CODE_IDENTITY: CodeMatrix = [1, 0, 0, 1, 0, 0]
export function codeMultiply(a: CodeMatrix, b: CodeMatrix): CodeMatrix {
  return [a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1], a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3], a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5]]
}
export const codePoint = (matrix: CodeMatrix, x: number, y: number): CodePoint => [matrix[0] * x + matrix[2] * y + matrix[4], matrix[1] * x + matrix[3] * y + matrix[5]]
