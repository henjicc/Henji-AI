import { authorResolvedEffectSchema } from './authorEffectObservation'
import { videoEditClipToFrame, videoEditFrameToClip, type VideoEditClipPlacement, type VideoEditSize } from './clipGeometry'
import { codePoint, type CodeElementBounds } from './codeMaterial/geometry'
import { z } from 'zod'
import type { AuthorElementObservation } from './codeAuthorProgram'
import { textRectCorners } from './textDrawObservation'

/** These rectangles are selection metadata only, never a reconstruction of draw(). */
export function prepareAuthorElementIndex(observations: readonly AuthorElementObservation[]): CodeElementIndex {
  const bounds = observations.map((author): CodeElementBounds => {
    const x = author.corners.length ? Math.min(...author.corners.map(point => point[0])) : 0, y = author.corners.length ? Math.min(...author.corners.map(point => point[1])) : 0
    const width = author.corners.length ? Math.max(...author.corners.map(point => point[0])) - x : 0, height = author.corners.length ? Math.max(...author.corners.map(point => point[1])) - y : 0
    return { elementId: author.id, elementPath: [author.id], sourceSpan: author.sourceSpan, x, y, width, height, matrix: author.matrix, opacity: author.opacity ?? 1, author }
  })
  return { bounds, byId: new Map(bounds.map(bound => [bound.elementId, bound])), ancestors: new Map(), parameters: new Map(observations.map(author => [author.id, author.parameterKeys])) }
}

/** 点在图层坐标里的位置；矩阵退化时返回 undefined。 */
function authorLocal(author: AuthorElementObservation, x: number, y: number): [number, number] | undefined {
  const [a, b, c, d, tx, ty] = author.matrix, determinant = a * d - b * c
  if (Math.abs(determinant) < 1e-12) return undefined
  return [(d * (x - tx) - c * (y - ty)) / determinant, (a * (y - ty) - b * (x - tx)) / determinant]
}
const inside = (box: readonly number[], x: number, y: number, slack = 0): boolean => x >= box[0] - slack && x <= box[2] + slack && y >= box[1] - slack && y <= box[3] + slack
/** 点到凸四边形（含容差）：文字绘制按自己的矩阵摆放，框可能旋转。 */
function insideQuad(quad: ReadonlyArray<[number, number]>, x: number, y: number, slack: number): boolean {
  let sign = 0
  for (let i = 0; i < quad.length; i++) {
    const [ax, ay] = quad[i], [bx, by] = quad[(i + 1) % quad.length], length = Math.hypot(bx - ax, by - ay) || 1
    const side = ((bx - ax) * (y - ay) - (by - ay) * (x - ax)) / length
    if (Math.abs(side) <= slack) continue
    if (sign && Math.sign(side) !== sign) return false
    sign ||= Math.sign(side)
  }
  return true
}
/** 点选容差（作者画布像素）：细线和小字也能点中。 */
const HIT_SLACK = 6
/**
 * 命中分两档：点在画出来的文字上为 'text'，只在实际画到的范围里为 'paint'。作者常把图层范围声明成整屏，
 * 只按声明范围会让排在上面的整屏图层挡住所有点击；有绘制观察时以画到的地方为准，没有时才退回声明范围。
 */
function hitAuthor(author: AuthorElementObservation, x: number, y: number): 'text' | 'paint' | undefined {
  if (!author.bounds || author.kind === 'adjust' || author.drawnBounds === null) return undefined
  const local = authorLocal(author, x, y)
  if (!local || !inside(author.bounds, local[0], local[1])) return undefined
  for (const draw of author.textDraws ?? []) {
    const rect = draw.appearanceBounds ?? draw.inkBounds
    if (rect && insideQuad(textRectCorners(rect).map(([px, py]) => codePoint(draw.matrix, px, py)), local[0], local[1], HIT_SLACK)) return 'text'
  }
  return !author.drawnBounds || inside(author.drawnBounds, local[0], local[1], HIT_SLACK) ? 'paint' : undefined
}

export const videoEditSelectedCodeElementContextSchema = z.object({
  clipRef: z.string().min(1), elementRef: z.object({ kind: z.literal('video_edit.code_element'), id: z.string().min(1) }).strict(), elementId: z.string().min(1),
  sourceSpan: z.object({ file: z.string().min(1), start: z.number().int().nonnegative(), end: z.number().int().positive(), startLine: z.number().int().positive(), startColumn: z.number().int().positive(), endLine: z.number().int().positive(), endColumn: z.number().int().positive() }).strict().optional(),
  parameterKeys: z.array(z.string().min(1)),
  effects: z.array(authorResolvedEffectSchema).optional(),
}).strict().nullable()

export interface VideoEditCodeElementSelection { sequenceId: string; clipId: string; versionId: string; elementId: string }
export interface CodeElementIndex { bounds: CodeElementBounds[]; byId: Map<string, CodeElementBounds>; ancestors: Map<CodeElementBounds, CodeElementBounds[]>; parameters: Map<string, string[]> }

/** 点中的元素，文字命中排在前面，同档按从上到下。 */
export function hitCodeElementIndex(index: CodeElementIndex, x: number, y: number): CodeElementBounds[] {
  const text: CodeElementBounds[] = [], paint: CodeElementBounds[] = []; const added = new Set<string>()
  for (let i = index.bounds.length - 1; i >= 0; i--) {
    const bound = index.bounds[i]
    if (bound.opacity < .01 || added.has(bound.elementId)) continue
    const hit = hitAuthor(bound.author, x, y)
    if (!hit) continue
    added.add(bound.elementId); (hit === 'text' ? text : paint).push(bound)
  }
  return [...text, ...paint]
}
export function codeElementAtSource(index: CodeElementIndex, offset: number, file = 'main.ts'): CodeElementBounds | undefined {
  return index.bounds.filter(bound => bound.sourceSpan && bound.sourceSpan.file === file && bound.sourceSpan.start <= offset && offset < bound.sourceSpan.end && bound.opacity >= .01 && (bound.author.kind === 'adjust' || bound.width > 0 && bound.height > 0)).sort((a, b) => (a.sourceSpan!.end - a.sourceSpan!.start) - (b.sourceSpan!.end - b.sourceSpan!.start))[0]
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
