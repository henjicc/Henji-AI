import { Vector2 } from 'three'
import { SVGLoader } from 'three/examples/jsm/loaders/SVGLoader.js'
import type { CodeDrawCommand } from '@/core/videoEdit/codeMaterial/contract'
import { trimCodePath, type CodePoint } from '@/core/videoEdit/codeMaterial/geometry'

export type CodeVector = Extract<CodeDrawCommand, { kind: 'line' | 'path' | 'rect' | 'ellipse' }>
export function isCodeVector(command: CodeDrawCommand): command is CodeVector {
  return command.kind === 'line' || command.kind === 'path' || command.kind === 'rect' || command.kind === 'ellipse'
}
/** Avoid unbounded dash tessellation / fragment winding work without changing author budgets.
 * Dense paths retain the existing Canvas fallback, with exactly the same accepted input/errors. */
export function supportsCodeVector(command: CodeDrawCommand): command is CodeVector {
  if (!isCodeVector(command)) return false
  if ((command.kind === 'rect' || command.kind === 'ellipse') && (!command.width || !command.height)) return false
  if (command.kind === 'path' && command.points.reduce((sum, path) => sum + path.length, 0) > 512) return false
  const points = command.kind === 'path' ? command.points.reduce((sum, path) => sum + path.length, 0) : 2
  if (points * Math.max(16, Math.ceil(Math.sqrt((command.strokeWidth ?? 0) / .02))) > 8192) return false
  if (!command.dash?.some(n => n > 0)) return true
  // Skia measures curved dash positions on its conics; flattening them first visibly shifts caps.
  // Preserve that uncommon contract via Canvas rather than accepting >64/255 pixel errors.
  if (command.kind === 'rect' || command.kind === 'ellipse') return false
  // Canvas' zero-length dash caps are a distinct raster primitive, not a polyline.
  if (command.dash.some(n => n === 0)) return false
  let length = 0
  if (command.kind === 'path') {
    for (const path of command.points) for (let i = 1; i < path.length; i++) length += Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1])
  }
  else length = Math.hypot(command.x2 - command.x1, command.y2 - command.y1)
  return length / command.dash.reduce((sum, n) => sum + n, 0) * command.dash.length <= 512
}
export function vectorStrokeWidth(command: CodeVector): number {
  // Canvas ignores a zero lineWidth assignment and retains its initial width of one.
  return command.kind === 'line' ? (command.strokeWidth ?? command.width) || 1 : command.strokeWidth ?? 0
}

/** Canvas normalizes all four corners by the same factor, including asymmetric radii. */
export function vectorRadii(command: Extract<CodeVector, { kind: 'rect' }>): number[] {
  const r = command.radii ?? [command.radius]
  const corners = [r[0], r[1] ?? r[0], r[2] ?? r[0], r[3] ?? r[1] ?? r[0]]
  const [a, b, c, d] = corners
  const scale = Math.min(1, command.width / (a + b || 1), command.width / (c + d || 1), command.height / (a + d || 1), command.height / (b + c || 1))
  return corners.map(radius => radius * scale)
}

/** Canvas resets dash phase at each subpath; zero entries and odd patterns are legal. */
export function dashVectorPaths(paths: CodePoint[][], dash: number[] = [], closed = false): CodePoint[][] {
  if (!dash.length || !dash.some(n => n > 0)) return paths
  const pattern = dash.length % 2 ? [...dash, ...dash] : dash
  const output: CodePoint[][] = []
  for (const path of paths) {
    const firstRun = output.length
    let index = 0; let remaining = pattern[0]; let run: CodePoint[] = []
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1]; const b = path[i]; const length = Math.hypot(b[0] - a[0], b[1] - a[1])
      let at = 0
      while (at < length) {
        while (remaining <= 0) {
          if (!(index % 2) && run.length) { output.push(run); run = [] }
          index = (index + 1) % pattern.length; remaining = pattern[index]
        }
        const take = Math.min(remaining, length - at)
        if (!(index % 2)) {
          if (!run.length) run.push([a[0] + (b[0] - a[0]) * at / length, a[1] + (b[1] - a[1]) * at / length])
          run.push([a[0] + (b[0] - a[0]) * (at + take) / length, a[1] + (b[1] - a[1]) * (at + take) / length])
        }
        remaining -= take; at += take
      }
    }
    if (run.length) output.push(run)
    const a = path[0]; const b = path[path.length - 1]
    if (closed && a && b && a[0] === b[0] && a[1] === b[1] && output.length > firstRun + 1) {
      const first = output[firstRun]; const last = output[output.length - 1]
      if (first[0][0] === a[0] && first[0][1] === a[1] && last[last.length - 1][0] === a[0] && last[last.length - 1][1] === a[1]) {
        output[firstRun] = [...last, ...first.slice(1)]; output.pop()
      }
    }
  }
  return output
}

function outlines(command: CodeVector): CodePoint[][] {
  if (command.kind === 'path') return trimCodePath(command.points, command.trimStart, command.trimEnd)
  if (command.kind === 'line') return trimCodePath([[[command.x1, command.y1], [command.x2, command.y2]]], command.trimStart, command.trimEnd)
  if (command.kind === 'rect') {
    const radii = vectorRadii(command); const points: CodePoint[] = [[command.x + radii[0], command.y]]
    for (const corner of [1, 2, 3, 0]) {
      const radius = radii[corner]; const cx = command.x + (corner === 0 || corner === 3 ? radius : command.width - radius); const cy = command.y + (corner < 2 ? radius : command.height - radius)
      const steps = Math.max(1, Math.ceil(Math.PI / 2 * Math.sqrt(radius / .08)))
      for (let i = 0; i <= steps; i++) { const a = (corner - 2 + i / steps) * Math.PI / 2; points.push([cx + Math.cos(a) * radius, cy + Math.sin(a) * radius]) }
    }
    points.push(points[0]); return [points]
  }
  return [] // Ellipses use analytic SDF; curved dashes retain Canvas' conic measurement.
}

export interface VectorEdges { fill: number[]; stroke: number[]; hairline?: boolean }
/** Geometric cache deliberately excludes paint, opacity, effects and element transforms. */
export class CodeVectorGeometry {
  private readonly entries = new Map<string, VectorEdges>()
  private bytes = 0
  get(command: CodeVector): VectorEdges {
    const width = vectorStrokeWidth(command)
    const key = JSON.stringify([command.kind, command.kind === 'path' ? command.points : command.kind === 'line' ? [command.x1, command.y1, command.x2, command.y2] : [command.x, command.y, command.width, command.height, command.kind === 'rect' ? vectorRadii(command) : null], width, command.lineCap, command.lineJoin, command.dash, command.trimStart, command.trimEnd, Boolean(command.stroke)])
    const cached = this.entries.get(key)
    if (cached) { this.entries.delete(key); this.entries.set(key, cached); return cached }
    const fill: number[] = []
    if (command.kind === 'path') for (const path of command.points) for (let i = 0; i < path.length; i++) {
      const a = path[i]; const b = path[(i + 1) % path.length]
      if (a[0] !== b[0] || a[1] !== b[1]) fill.push(...a, ...b)
    }
    // Reuse Three.js' MIT stroke tessellator (miter limit 10 matches Canvas).
    // Removing shared triangle edges gives an oriented outline; winding sampling unions overlaps
    // without compositing translucent joins twice. No new triangulator or stroke implementation.
    const boundary = new Map<string, { a: CodePoint; b: CodePoint; winding: number }>()
    const hairline = command.kind === 'path' && width > 0 && width <= 1
    const hairlineEdges: number[] = []
    if (width > 0 && (command.kind === 'line' || command.stroke)) {
      for (const path of dashVectorPaths(outlines(command), command.dash, command.kind === 'rect')) {
        if (hairline) {
          for (let i = 1; i < path.length; i++) hairlineEdges.push(...path[i - 1], ...path[i])
          continue
        }
        const vertices: number[] = []
        const points = path.map(([x, y]) => new Vector2(x, y))
        // trimCodePath is traced as an OPEN polyline, even when its endpoints coincide.
        // SVGLoader infers closure from exact equality. A double-precision ULP separates them
        // for topology only; their eventual float32 GPU positions are still identical.
        if (command.kind === 'path' && points.length > 1 && points[0].equals(points[points.length - 1])) {
          const last = points[points.length - 1]; last.x += Math.max(1, Math.abs(last.x)) * Number.EPSILON * 4
        }
        SVGLoader.pointsToStrokeWithBuffers(points, SVGLoader.getStrokeStyle(width, '', command.lineJoin ?? 'miter', command.lineCap ?? 'butt', 10), Math.max(16, Math.ceil(Math.sqrt(width / .02))), 1e-7, vertices, [], [])
        for (let i = 0; i < vertices.length; i += 9) {
          let points: CodePoint[] = [[vertices[i], vertices[i + 1]], [vertices[i + 3], vertices[i + 4]], [vertices[i + 6], vertices[i + 7]]]
          const [a, b, c] = points
          const area = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
          if (Math.abs(area) < 1e-12) continue
          if (area < 0) points = [c, b, a]
          for (let edge = 0; edge < 3; edge++) {
            const a = points[edge]; const b = points[(edge + 1) % 3]
            const ka = `${a[0].toFixed(6)},${a[1].toFixed(6)}`; const kb = `${b[0].toFixed(6)},${b[1].toFixed(6)}`
            const forward = ka < kb; const key = forward ? `${ka}/${kb}` : `${kb}/${ka}`
            const old = boundary.get(key)
            if (old) old.winding += forward ? 1 : -1
            else boundary.set(key, { a: forward ? a : b, b: forward ? b : a, winding: forward ? 1 : -1 })
          }
        }
      }
    }
    const stroke: number[] = hairlineEdges
    for (const edge of boundary.values()) for (let i = 0; i < Math.abs(edge.winding); i++) stroke.push(...(edge.winding > 0 ? edge.a : edge.b), ...(edge.winding > 0 ? edge.b : edge.a))
    const result = { fill, stroke, hairline }; const bytes = (fill.length + stroke.length) * 8
    while (this.bytes + bytes > 4 * 1024 ** 2 && this.entries.size) {
      const oldest = this.entries.entries().next().value!
      this.bytes -= (oldest[1].fill.length + oldest[1].stroke.length) * 8; this.entries.delete(oldest[0])
    }
    if (bytes <= 4 * 1024 ** 2) { this.entries.set(key, result); this.bytes += bytes }
    return result
  }
  clear(): void { this.entries.clear(); this.bytes = 0 }
}
