import { videoEditClipToFrame, videoEditFrameToClip, type VideoEditClipPlacement, type VideoEditSize } from './clipGeometry'
import { evaluateCodeMaterialBounds } from './codeMaterial/evaluate'
import { hitCodeCommands, type CodeElementBounds } from './codeMaterial/geometry'
import type { CodeDrawCommand, CodeMaterialContext, CodeMaterialProgram, CodeTextMeasurer, CodeExpression } from './codeMaterial/contract'
import { z } from 'zod'
import type { CodeElementOverrides } from './codeElementOverrides'
import type { VideoEditSourceTime } from './time'

export const videoEditSelectedCodeElementContextSchema = z.object({
  clipRef: z.string().min(1), elementId: z.string().min(1),
  sourceSpan: z.object({ file: z.string().min(1), start: z.number().int().nonnegative(), end: z.number().int().positive(), startLine: z.number().int().positive(), startColumn: z.number().int().positive(), endLine: z.number().int().positive(), endColumn: z.number().int().positive() }).strict().optional(),
  parameterKeys: z.array(z.string().min(1)),
}).strict().nullable()

export interface VideoEditCodeElementSelection { sequenceId: string; clipId: string; versionId: string; elementId: string }
export interface CodeElementIndex { bounds: CodeElementBounds[]; byId: Map<string, CodeElementBounds>; ancestors: Map<CodeElementBounds, CodeElementBounds[]>; parameters: Map<string, string[]> }

/** The index belongs to one evaluated frame. Queries first reject AABBs, then use the shared exact geometry. */
export function prepareCodeElementIndex(program: CodeMaterialProgram, context: CodeMaterialContext, values: Readonly<Record<string, unknown>>, measureText: CodeTextMeasurer, options: { elementOverrides?: CodeElementOverrides; sourceTime?: VideoEditSourceTime } = {}): CodeElementIndex {
  const bounds = evaluateCodeMaterialBounds(program, context, values, { measureText, ...options })
  const byPath = new Map(bounds.map(bound => [bound.elementPath.join('|'), bound]))
  const ancestors = new Map(bounds.map(bound => [bound, bound.elementPath.slice(0, -1).flatMap((_part, i) => {
    const ancestor = byPath.get(bound.elementPath.slice(0, i + 1).join('|'))
    return ancestor ? [ancestor] : []
  })]))
  const dependencies = new Map<string, string[]>()
  const keys = (expression: CodeExpression, seen = new Set<number>()): Set<string> => {
    const result = new Set<string>()
    if (expression.kind === 'parameter') result.add(expression.key)
    if (expression.kind === 'binding' && !seen.has(expression.slot)) {
      const binding = program.bindings[expression.slot]; if (binding) for (const key of keys(binding.expression, new Set([...seen, expression.slot]))) result.add(key)
    }
    for (const value of Object.values(expression)) {
      const children = Array.isArray(value) ? value : value && typeof value === 'object' ? Object.values(value) : []
      if (value && typeof value === 'object' && 'kind' in value && 'type' in value) for (const key of keys(value as CodeExpression, seen)) result.add(key)
      else for (const child of children) if (child && typeof child === 'object' && 'kind' in child && 'type' in child) for (const key of keys(child as CodeExpression, seen)) result.add(key)
    }
    if ('sourceSpan' in expression && expression.sourceSpan) dependencies.set(JSON.stringify([expression.sourceSpan.file, expression.sourceSpan.start]), [...result])
    return result
  }
  keys(program.result); for (const binding of program.bindings) keys(binding.expression)
  return { bounds, byId: new Map(bounds.map(bound => [bound.elementId, bound])), ancestors, parameters: new Map(bounds.map(bound => [bound.elementId, dependencies.get(JSON.stringify([bound.sourceSpan?.file, bound.sourceSpan?.start])) ?? []])) }
}

export function hitCodeElementIndex(index: CodeElementIndex, x: number, y: number): CodeElementBounds[] {
  const result: CodeElementBounds[] = []; const added = new Set<string>()
  for (let i = index.bounds.length - 1; i >= 0; i--) {
    const bound = index.bounds[i]
    if (bound.command.kind === 'group' || bound.opacity < .01 || x < bound.x || y < bound.y || x > bound.x + bound.width || y > bound.y + bound.height) continue
    const parents = index.ancestors.get(bound) ?? []
    let command: CodeDrawCommand = bound.command
    for (let j = parents.length - 1; j >= 0; j--) command = { ...parents[j].command, kind: 'group', x: (parents[j].command as Extract<CodeDrawCommand, { kind: 'group' }>).x, y: (parents[j].command as Extract<CodeDrawCommand, { kind: 'group' }>).y, children: [command] }
    if (!hitCodeCommands([command], x, y)) continue
    // Repeated clicks walk containers before the next overlapping sibling.
    for (const element of [bound, ...parents.slice().reverse()]) if (!added.has(element.elementId)) { added.add(element.elementId); result.push(element) }
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
  const originalId = bound.command.authorElementId ?? bound.command.elementId ?? bound.elementId
  const id = originalId.replace(/:\d+(?:\.\d+)*$/, '')
  if (!/^(call:|draw:)/.test(originalId)) return id
  const command = bound.command
  return command.kind === 'text' ? `文字：${command.text.slice(0, 40)}` : ({ rect: '矩形', ellipse: '椭圆', line: '线条', image: '图片', group: '分组', path: '路径', shader: '画面效果' } as const)[command.kind]
}
export function codeElementAuthorPoint(placement: VideoEditClipPlacement, picture: VideoEditSize, frame: VideoEditSize, point: { x: number; y: number }): { x: number; y: number } {
  const local = videoEditFrameToClip(placement, picture, frame, point.x, point.y)
  return { x: local.u * picture.width, y: local.v * picture.height }
}
export function codeElementFramePolygon(bound: Pick<CodeElementBounds, 'x' | 'y' | 'width' | 'height'>, placement: VideoEditClipPlacement, picture: VideoEditSize, frame: VideoEditSize): Array<{ x: number; y: number }> {
  return [[bound.x, bound.y], [bound.x + bound.width, bound.y], [bound.x + bound.width, bound.y + bound.height], [bound.x, bound.y + bound.height]].map(([x, y]) => videoEditClipToFrame(placement, picture, frame, x / picture.width, y / picture.height))
}
