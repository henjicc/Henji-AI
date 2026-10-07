import { CODE_V3_LIMITS, CodeMaterialError } from './contract'
import type { CodeDrawCommand, CodeMatrix, CodePaint, CodeSourceSpan } from './contract'

export type CodePoint = [number, number]
export interface CodeElementBounds { elementId: string; sourceSpan?: CodeSourceSpan; elementPath: string[]; x: number; y: number; width: number; height: number; command: CodeDrawCommand; matrix: CodeMatrix; opacity: number }
export const CODE_IDENTITY: CodeMatrix = [1, 0, 0, 1, 0, 0]
export function codeMultiply(a: CodeMatrix, b: CodeMatrix): CodeMatrix {
  return [a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1], a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3], a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5]]
}
export const codePoint = (matrix: CodeMatrix, x: number, y: number): CodePoint => [matrix[0] * x + matrix[2] * y + matrix[4], matrix[1] * x + matrix[3] * y + matrix[5]]
export function codeTransform(command: CodeDrawCommand): CodeMatrix {
  const angle = (command.rotation ?? 0) * Math.PI / 180; const c = Math.cos(angle); const s = Math.sin(angle)
  const sx = command.scaleX ?? 1; const sy = command.scaleY ?? 1
  const x = command.kind === 'group' ? command.x : 0; const y = command.kind === 'group' ? command.y : 0
  const ax = (command.anchorX ?? 0) + (command.kind !== 'group' && 'x' in command ? command.x : 0)
  const ay = (command.anchorY ?? 0) + (command.kind !== 'group' && 'y' in command ? command.y : 0)
  return [c * sx, s * sx, -s * sy, c * sy, x + ax - c * sx * ax + s * sy * ay, y + ay - s * sx * ax - c * sy * ay]
}
const paths = new Map<string, { value: CodePoint[][]; bytes: number }>(); let pathBytes = 0
/** A deliberately small SVG grammar. Absolute M/L/C/Q/Z only; curves flatten identically for paint and hit tests. */
export function parseCodePath(d: string): CodePoint[][] {
  const cached = paths.get(d)
  if (cached) { paths.delete(d); paths.set(d, cached); return cached.value.map(path => path.map(point => [...point])) }
  if (d.length > 4096) throw new CodeMaterialError('BUDGET', '路径字符串超过 4096 字符。')
  const tokens = d.match(/[MLCQZ]|[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:[eE][-+]?\d+)?/g) ?? []
  if (d.replace(/[MLCQZ]|[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:[eE][-+]?\d+)?|[\s,]/g, '')) throw new CodeMaterialError('SYNTAX', 'path.d 仅支持绝对 M L C Q Z。')
  const output: CodePoint[][] = []; let path: CodePoint[] = []; let at = 0; let op = ''; let current: CodePoint = [0, 0]; let count = 0
  const append = (point: CodePoint): void => {
    if (++count > CODE_V3_LIMITS.pathPoints || point.some(value => !Number.isFinite(value) || Math.abs(value) > 32768)) throw new CodeMaterialError('BUDGET', '路径点数超过 4096 或坐标超出技术范围。')
    path.push(point); current = point
  }
  const pair = (): CodePoint => {
    if (at + 1 >= tokens.length || /[MLCQZ]/.test(tokens[at]) || /[MLCQZ]/.test(tokens[at + 1])) throw new CodeMaterialError('SYNTAX', '路径坐标数量不完整。')
    return [Number(tokens[at++]), Number(tokens[at++])]
  }
  while (at < tokens.length) {
    if (/^[MLCQZ]$/.test(tokens[at])) op = tokens[at++]
    if (op === 'M') { path = []; output.push(path); append(pair()); op = 'L' }
    else if (!path.length) throw new CodeMaterialError('SYNTAX', '路径必须从 M 开始。')
    else if (op === 'Z') { append([...path[0]]); op = ''; if (at < tokens.length && !/^[MLCQZ]$/.test(tokens[at])) throw new CodeMaterialError('SYNTAX', 'Z 后须有路径命令。') }
    else if (op === 'L') append(pair())
    else if (op === 'C' || op === 'Q') {
      const start = current; const a = pair(); const b = pair(); const end = op === 'C' ? pair() : b
      for (let i = 1; i <= 32; i++) {
        const t = i / 32; const u = 1 - t
        append(op === 'C' ? [u ** 3 * start[0] + 3 * u * u * t * a[0] + 3 * u * t * t * b[0] + t ** 3 * end[0], u ** 3 * start[1] + 3 * u * u * t * a[1] + 3 * u * t * t * b[1] + t ** 3 * end[1]] : [u * u * start[0] + 2 * u * t * a[0] + t * t * end[0], u * u * start[1] + 2 * u * t * a[1] + t * t * end[1]])
      }
    } else throw new CodeMaterialError('SYNTAX', '未知路径命令。')
  }
  const bytes = count * 16 + d.length * 2
  while (paths.size && (paths.size >= 128 || pathBytes + bytes > 2 * 1024 ** 2)) { const key = paths.keys().next().value!; pathBytes -= paths.get(key)!.bytes; paths.delete(key) }
  paths.set(d, { value: output, bytes }); pathBytes += bytes
  return output.map(path => path.map(point => [...point]))
}
export function trimCodePath(points: CodePoint[][], start = 0, end = 1): CodePoint[][] {
  const total = points.reduce((sum, path) => sum + path.slice(1).reduce((length, point, i) => length + Math.hypot(point[0] - path[i][0], point[1] - path[i][1]), 0), 0)
  let distance = 0; const output: CodePoint[][] = []
  for (const path of points) {
    const next: CodePoint[] = []
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1]; const b = path[i]; const length = Math.hypot(b[0] - a[0], b[1] - a[1])
      if (length && distance + length > start * total && distance < end * total) {
        const lo = Math.max(0, (start * total - distance) / length); const hi = Math.min(1, (end * total - distance) / length)
        if (hi > lo) { if (!next.length) next.push([a[0] + (b[0] - a[0]) * lo, a[1] + (b[1] - a[1]) * lo]); next.push([a[0] + (b[0] - a[0]) * hi, a[1] + (b[1] - a[1]) * hi]) }
      }
      distance += length
    }
    if (next.length) output.push(next)
  }
  return output
}
export function codeLocalBounds(command: CodeDrawCommand): { x: number; y: number; width: number; height: number } {
  if (command.kind === 'group') {
    const bounds = codeElementBounds(command.children)
    if (!bounds.length) return { x: 0, y: 0, width: 0, height: 0 }
    const x = Math.min(...bounds.map(b => b.x)); const y = Math.min(...bounds.map(b => b.y))
    return { x, y, width: Math.max(...bounds.map(b => b.x + b.width)) - x, height: Math.max(...bounds.map(b => b.y + b.height)) - y }
  }
  if (command.kind === 'path') {
    const points = command.points.flat(); if (!points.length) return { x: 0, y: 0, width: 0, height: 0 }
    const x = Math.min(...points.map(p => p[0])); const y = Math.min(...points.map(p => p[1]))
    return { x, y, width: Math.max(...points.map(p => p[0])) - x, height: Math.max(...points.map(p => p[1])) - y }
  }
  if (command.kind === 'line') return { x: Math.min(command.x1, command.x2), y: Math.min(command.y1, command.y2), width: Math.abs(command.x2 - command.x1), height: Math.abs(command.y2 - command.y1) }
  if (command.kind === 'text') {
    if (!command.layout) throw new CodeMaterialError('CONTEXT', '文字命中需要共享字体度量。')
    const { width, height } = command.layout
    const box = { x: command.x - (command.align === 'center' ? width / 2 : command.align === 'right' ? width : 0), y: command.y - (command.baseline === 'top' ? 0 : command.baseline === 'alphabetic' ? command.layout.baselineOffset ?? command.fontSize * .8 : command.baseline === 'bottom' ? height : height / 2), width, height }
    if (!command.perChar || !command.layout.glyphs.length) return box
    const boxes = codeTextGlyphBoxes(command, box).flatMap(glyph => [[glyph.x, glyph.y], [glyph.x + glyph.width, glyph.y], [glyph.x, glyph.y + glyph.height], [glyph.x + glyph.width, glyph.y + glyph.height]].map(([x, y]) => codePoint(glyph.matrix, x, y)))
    const left = Math.min(...boxes.map(p => p[0])); const top = Math.min(...boxes.map(p => p[1]))
    return { x: left, y: top, width: Math.max(...boxes.map(p => p[0])) - left, height: Math.max(...boxes.map(p => p[1])) - top }
  }
  return { x: command.x, y: command.y, width: command.width, height: command.height }
}
export function codeTextBaseBounds(command: Extract<CodeDrawCommand, { kind: 'text' }>): { x: number; y: number; width: number; height: number } {
  return codeLocalBounds({ ...command, perChar: undefined })
}
function codeTextGlyphBoxes(command: Extract<CodeDrawCommand, { kind: 'text' }>, box = codeTextBaseBounds(command)): { x: number; y: number; width: number; height: number; matrix: CodeMatrix; opacity: number }[] {
  return command.layout!.glyphs.map((glyph, i) => {
    const transform = command.perChar?.[i] ?? { x: 0, y: 0, opacity: 1, scale: 1, rotation: 0 }
    const row = Math.round(glyph.y / (command.layout!.fontSize * (command.lineHeight ?? 1.2))); const lineWidth = command.layout!.lineWidths?.[row] ?? command.layout!.width
    const x = box.x + glyph.x + (command.align === 'center' ? (box.width - lineWidth) / 2 : command.align === 'right' ? box.width - lineWidth : 0); const y = box.y + glyph.y
    const rotation = transform.rotation * Math.PI / 180; const c = Math.cos(rotation) * transform.scale; const s = Math.sin(rotation) * transform.scale
    return { x, y, width: glyph.width, height: command.layout!.fontSize * (command.lineHeight ?? 1.2), opacity: transform.opacity, matrix: [c, s, -s, c, x + transform.x - c * x + s * y, y + transform.y - s * x - c * y] }
  })
}
export function codeElementBounds(commands: readonly CodeDrawCommand[], parent: CodeMatrix = CODE_IDENTITY, inheritedOpacity = 1, inheritedClip?: { x: number; y: number; width: number; height: number }): CodeElementBounds[] {
  const result: CodeElementBounds[] = []
  commands.forEach((command, index) => {
    const matrix = codeMultiply(parent, codeTransform(command)); const box = codeLocalBounds(command)
    const padding = command.kind === 'line' ? command.width / 2 : command.stroke ? (command.strokeWidth ?? 0) / 2 : 0
    const canvasBox = (box: { x: number; y: number; width: number; height: number }): { x: number; y: number; width: number; height: number } => {
      const points = [[box.x, box.y], [box.x + box.width, box.y], [box.x, box.y + box.height], [box.x + box.width, box.y + box.height]].map(([x, y]) => codePoint(matrix, x, y))
      const x = Math.min(...points.map(p => p[0])); const y = Math.min(...points.map(p => p[1]))
      return { x, y, width: Math.max(...points.map(p => p[0])) - x, height: Math.max(...points.map(p => p[1])) - y }
    }
    let bounds = canvasBox({ x: box.x - padding, y: box.y - padding, width: box.width + padding * 2, height: box.height + padding * 2 })
    let clip = inheritedClip
    const intersect = (a: typeof box, b: typeof box): typeof box => { const x = Math.max(a.x, b.x); const y = Math.max(a.y, b.y); return { x, y, width: Math.max(0, Math.min(a.x + a.width, b.x + b.width) - x), height: Math.max(0, Math.min(a.y + a.height, b.y + b.height) - y) } }
    if (command.kind === 'group' && command.clip) { const own = canvasBox(command.clip); clip = clip ? intersect(clip, own) : own }
    if (clip) bounds = intersect(bounds, clip)
    const opacity = inheritedOpacity * (command.opacity ?? 1)
    result.push({ elementId: command.elementId ?? `draw:${index}`, sourceSpan: command.sourceSpan, elementPath: command.elementPath ?? [], ...bounds, command, matrix, opacity })
    if (command.kind === 'group') result.push(...codeElementBounds(command.children, matrix, opacity, clip))
  })
  return result
}
function polygonContains(paths: CodePoint[][], x: number, y: number): boolean {
  let winding = 0
  for (const path of paths) for (let i = 0; i < path.length; i++) {
    const a = path[i]; const b = path[(i + 1) % path.length]; const cross = (b[0] - a[0]) * (y - a[1]) - (x - a[0]) * (b[1] - a[1])
    if (a[1] <= y && b[1] > y && cross > 0) winding++
    if (a[1] > y && b[1] <= y && cross < 0) winding--
  }
  return winding !== 0
}
function paintAlpha(paint: CodePaint, x: number, y: number): number {
  if (Array.isArray(paint)) return paint[3]
  const dx = (paint.x2 ?? 0) - (paint.x1 ?? 0); const dy = (paint.y2 ?? 0) - (paint.y1 ?? 0)
  const at = Math.min(1, Math.max(0, paint.kind === 'radialGradient' ? Math.hypot(x - paint.cx!, y - paint.cy!) / paint.r! : ((x - paint.x1!) * dx + (y - paint.y1!) * dy) / (dx * dx + dy * dy)))
  const right = paint.stops.findIndex(stop => stop[0] > at)
  if (right < 0) return paint.stops.at(-1)![1][3]
  if (right === 0) return paint.stops[0][1][3]
  const a = paint.stops[right - 1]; const b = paint.stops[right]; const t = (at - a[0]) / (b[0] - a[0])
  return a[1][3] + (b[1][3] - a[1][3]) * t
}
function strokeContains(paths: CodePoint[][], x: number, y: number, width: number, cap: string, dash: number[] = []): boolean {
  const pattern = dash.length % 2 ? [...dash, ...dash] : dash; const totalDash = pattern.reduce((a, b) => a + b, 0)
  const painted = (distance: number): boolean => {
    if (!totalDash) return true
    let position = distance % totalDash
    for (let i = 0; i < pattern.length; i++) { if (position < pattern[i]) return i % 2 === 0; position -= pattern[i] }
    return true
  }
  for (const path of paths) {
    let offset = 0
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1]; const b = path[i]; const dx = b[0] - a[0]; const dy = b[1] - a[1]; const length = Math.hypot(dx, dy)
      if (!length) continue
      const raw = ((x - a[0]) * dx + (y - a[1]) * dy) / (length * length)
      const t = Math.min(1, Math.max(0, raw)); const distance = Math.hypot(x - a[0] - t * dx, y - a[1] - t * dy)
      const allowed = cap === 'round' || cap === 'square' && raw >= -width / (2 * length) && raw <= 1 + width / (2 * length) || raw >= 0 && raw <= 1
      if (allowed && painted(offset + t * length) && (cap === 'square' ? Math.abs((x - a[0]) * dy - (y - a[1]) * dx) / length : distance) <= width / 2) return true
      offset += length
    }
  }
  return false
}
function cornerRadii(command: Extract<CodeDrawCommand, { kind: 'rect' }>): number[] {
  const radii = command.radii ?? [command.radius]
  const corners = radii.length === 1 ? [radii[0], radii[0], radii[0], radii[0]] : radii.length === 2 ? [radii[0], radii[1], radii[0], radii[1]] : radii.length === 3 ? [radii[0], radii[1], radii[2], radii[1]] : radii
  const ratios = [[command.width, corners[0] + corners[1]], [command.width, corners[2] + corners[3]], [command.height, corners[0] + corners[3]], [command.height, corners[1] + corners[2]]]
  const factor = Math.min(1, ...ratios.map(([size, sum]) => sum ? size / sum : 1))
  return corners.map(radius => radius * factor)
}
export function hitCodeCommands(commands: readonly CodeDrawCommand[], x: number, y: number, threshold = .01): CodeElementBounds | undefined {
  const hits = codeElementBounds(commands)
  const groups = hits.filter(element => element.command.kind === 'group')
  for (const hit of hits.reverse()) {
    if (hit.command.kind === 'group' || hit.opacity < threshold) continue
    const m = hit.matrix; const determinant = m[0] * m[3] - m[1] * m[2]; if (Math.abs(determinant) < 1e-12) continue
    const px = (m[3] * (x - m[4]) - m[2] * (y - m[5])) / determinant; const py = (-m[1] * (x - m[4]) + m[0] * (y - m[5])) / determinant
    const command = hit.command; const box = codeLocalBounds(command)
    const ancestors = groups.filter(element => hit.elementPath.slice(0, element.elementPath.length).join('/') === element.elementPath.join('/'))
    if (ancestors.some(ancestor => {
      if (ancestor.command.kind !== 'group' || !ancestor.command.clip) return false
      const m = ancestor.matrix; const det = m[0] * m[3] - m[1] * m[2]; if (!det) return true
      const a = (m[3] * (x - m[4]) - m[2] * (y - m[5])) / det; const b = (-m[1] * (x - m[4]) + m[0] * (y - m[5])) / det; const clip = ancestor.command.clip
      return a < clip.x || a > clip.x + clip.width || b < clip.y || b > clip.y + clip.height
    })) continue
    const alpha = command.paint ? paintAlpha(command.paint, px, py) : 'fill' in command ? command.fill[3] : 'color' in command ? command.color[3] : 1
    if (alpha * hit.opacity < threshold && !(command.stroke && (command.strokeWidth ?? 0) > 0)) continue
    if (command.kind === 'text' && command.perChar) {
      if (codeTextGlyphBoxes(command).some(glyph => {
        if (glyph.opacity * hit.opacity < threshold) return false
        const m = glyph.matrix; const det = m[0] * m[3] - m[1] * m[2]; if (!det) return false
        const gx = (m[3] * (px - m[4]) - m[2] * (py - m[5])) / det; const gy = (-m[1] * (px - m[4]) + m[0] * (py - m[5])) / det
        return gx >= glyph.x && gx <= glyph.x + glyph.width && gy >= glyph.y && gy <= glyph.y + glyph.height
      })) return hit
      continue
    }
    if (command.kind === 'path') { if (alpha * hit.opacity >= threshold && polygonContains(command.points, px, py)) return hit }
    else if (command.kind === 'ellipse') { if (alpha * hit.opacity >= threshold && box.width && box.height && ((px - box.x) / box.width * 2 - 1) ** 2 + ((py - box.y) / box.height * 2 - 1) ** 2 <= 1) return hit }
    else if (command.kind === 'rect' && alpha * hit.opacity >= threshold && px >= box.x && px <= box.x + box.width && py >= box.y && py <= box.y + box.height) {
      const corners = cornerRadii(command)
      const outside = corners.some((r, corner) => {
        const left = corner === 0 || corner === 3; const top = corner < 2
        const cx = box.x + (left ? r : box.width - r); const cy = box.y + (top ? r : box.height - r)
        const inCorner = (left ? px < cx : px > cx) && (top ? py < cy : py > cy)
        return inCorner && Math.hypot(px - cx, py - cy) > r
      })
      if (!outside) return hit
    } else if (command.kind !== 'line' && command.kind !== 'rect' && px >= box.x && px <= box.x + box.width && py >= box.y && py <= box.y + box.height) return hit
    if ((command.kind === 'rect' || command.kind === 'ellipse') && command.stroke && (command.strokeWidth ?? 0) > 0 && paintAlpha(command.stroke, px, py) * hit.opacity >= threshold) {
      const points: CodePoint[] = []
      if (command.kind === 'ellipse') for (let i = 0; i <= 128; i++) { const angle = i / 128 * Math.PI * 2; points.push([box.x + box.width / 2 + Math.cos(angle) * box.width / 2, box.y + box.height / 2 + Math.sin(angle) * box.height / 2]) }
      else {
        const corners = cornerRadii(command); points.push([box.x + corners[0], box.y])
        for (const corner of [1, 2, 3, 0]) {
          const r = corners[corner]; const cx = box.x + (corner === 0 || corner === 3 ? r : box.width - r); const cy = box.y + (corner < 2 ? r : box.height - r)
          for (let i = 0; i <= 32; i++) { const angle = (corner - 2) * Math.PI / 2 + i / 32 * Math.PI / 2; points.push([cx + Math.cos(angle) * r, cy + Math.sin(angle) * r]) }
        }
        points.push(points[0])
      }
      if (strokeContains([points], px, py, command.strokeWidth!, 'round', command.dash)) return hit
    }
    if (command.kind === 'path' || command.kind === 'line') {
      const paths = trimCodePath(command.kind === 'path' ? command.points : [[[command.x1, command.y1], [command.x2, command.y2]]], command.trimStart, command.trimEnd)
      const width = command.kind === 'line' ? command.width : command.strokeWidth ?? 0
      if (width > 0 && (!command.stroke || paintAlpha(command.stroke, px, py) * hit.opacity >= threshold) && strokeContains(paths, px, py, width, command.lineCap ?? 'butt', command.dash)) return hit
    }
  }
  return undefined
}
