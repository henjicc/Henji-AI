import { videoEditClipToFrame, videoEditFrameToClip, type VideoEditClipPlacement, type VideoEditSize } from './clipGeometry'
import type { CodeElementBounds } from './codeMaterial/geometry'
import { z } from 'zod'
import type { AuthorElementObservation } from './codeAuthorProgram'

/** These rectangles are selection metadata only, never a reconstruction of draw(). */
export function prepareAuthorElementIndex(observations: readonly AuthorElementObservation[]): CodeElementIndex {
  const bounds = observations.map((author): CodeElementBounds => {
    const x = Math.min(...author.corners.map(point => point[0])), y = Math.min(...author.corners.map(point => point[1]))
    const width = Math.max(...author.corners.map(point => point[0])) - x, height = Math.max(...author.corners.map(point => point[1])) - y
    return { elementId: author.id, elementPath: [author.id], sourceSpan: author.sourceSpan, x, y, width, height, matrix: author.matrix, opacity: author.opacity ?? 1, author,
      command: { kind: 'rect', x, y, width, height, fill: [0, 0, 0, 0], radius: 0 } }
  })
  return { bounds, byId: new Map(bounds.map(bound => [bound.elementId, bound])), ancestors: new Map(), parameters: new Map(observations.map(author => [author.id, author.parameterKeys])) }
}

function hitAuthorBounds(author: AuthorElementObservation, x: number, y: number): boolean {
  const [a, b, c, d, tx, ty] = author.matrix, determinant = a * d - b * c
  if (Math.abs(determinant) < 1e-12) return false
  const localX = (d * (x - tx) - c * (y - ty)) / determinant
  const localY = (a * (y - ty) - b * (x - tx)) / determinant
  return localX >= author.bounds[0] && localX <= author.bounds[2] && localY >= author.bounds[1] && localY <= author.bounds[3]
}

export const videoEditSelectedCodeElementContextSchema = z.object({
  clipRef: z.string().min(1), elementId: z.string().min(1),
  sourceSpan: z.object({ file: z.string().min(1), start: z.number().int().nonnegative(), end: z.number().int().positive(), startLine: z.number().int().positive(), startColumn: z.number().int().positive(), endLine: z.number().int().positive(), endColumn: z.number().int().positive() }).strict().optional(),
  parameterKeys: z.array(z.string().min(1)),
}).strict().nullable()

export interface VideoEditCodeElementSelection { sequenceId: string; clipId: string; versionId: string; elementId: string }
export interface CodeElementIndex { bounds: CodeElementBounds[]; byId: Map<string, CodeElementBounds>; ancestors: Map<CodeElementBounds, CodeElementBounds[]>; parameters: Map<string, string[]> }

export function hitCodeElementIndex(index: CodeElementIndex, x: number, y: number): CodeElementBounds[] {
  const result: CodeElementBounds[] = []; const added = new Set<string>()
  for (let i = index.bounds.length - 1; i >= 0; i--) {
    const bound = index.bounds[i]
    if (bound.author) {
      if (bound.opacity >= .01 && hitAuthorBounds(bound.author, x, y) && !added.has(bound.elementId)) { added.add(bound.elementId); result.push(bound) }
      continue
    }

  }
  return result
}
export function cycleCodeElement(hits: readonly CodeElementBounds[], current?: string, cycle = false): CodeElementBounds | undefined {
  return hits.length ? hits[cycle ? (hits.findIndex(hit => hit.elementId === current) + 1) % hits.length : 0] : undefined
}
export function codeElementAtSource(index: CodeElementIndex, offset: number, file = 'main.ts'): CodeElementBounds | undefined {
  return index.bounds.filter(bound => bound.sourceSpan && bound.sourceSpan.file === file && bound.sourceSpan.start <= offset && offset < bound.sourceSpan.end && bound.opacity >= .01 && bound.width > 0 && bound.height > 0).sort((a, b) => (a.sourceSpan!.end - a.sourceSpan!.start) - (b.sourceSpan!.end - b.sourceSpan!.start))[0]
}
export function codeElementLabel(bound: CodeElementBounds): string {
  if (bound.author) return bound.author.name
  return bound.elementId
}
export function codeElementAuthorPoint(placement: VideoEditClipPlacement, picture: VideoEditSize, frame: VideoEditSize, point: { x: number; y: number }): { x: number; y: number } {
  const local = videoEditFrameToClip(placement, picture, frame, point.x, point.y)
  return { x: local.u * picture.width, y: local.v * picture.height }
}
export function codeElementFramePolygon(bound: Pick<CodeElementBounds, 'x' | 'y' | 'width' | 'height'>, placement: VideoEditClipPlacement, picture: VideoEditSize, frame: VideoEditSize): Array<{ x: number; y: number }> {
  return [[bound.x, bound.y], [bound.x + bound.width, bound.y], [bound.x + bound.width, bound.y + bound.height], [bound.x, bound.y + bound.height]].map(([x, y]) => videoEditClipToFrame(placement, picture, frame, x / picture.width, y / picture.height))
}
