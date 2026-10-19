import type { CodeDrawCommand, CodeMatrix, CodePaint } from './contract'
import { CODE_IDENTITY, codeLocalBounds, codeMultiply, codePoint, codeTransform } from './geometry'

type Box = { x: number; y: number; width: number; height: number }
/** Conservative support, including raster padding and the default miter limit.
 * Never cull animated glyphs using their unanimated text rectangle. */
export function codeOutside(box: Box, matrix: CodeMatrix, width: number, height: number, pad = 2): boolean {
  if (matrix[0] === 1 && matrix[1] === 0 && matrix[2] === 0 && matrix[3] === 1 && box.width >= 0 && box.height >= 0) {
    return box.x + box.width + pad + matrix[4] < 0 || box.y + box.height + pad + matrix[5] < 0
      || box.x - pad + matrix[4] > width || box.y - pad + matrix[5] > height
  }
  const points = [[box.x - pad, box.y - pad], [box.x + box.width + pad, box.y - pad], [box.x - pad, box.y + box.height + pad], [box.x + box.width + pad, box.y + box.height + pad]].map(([x, y]) => codePoint(matrix, x, y))
  return points.every(p => p[0] < 0) || points.every(p => p[1] < 0) || points.every(p => p[0] > width) || points.every(p => p[1] > height)
}
export function codeEmptyGroup(command: Extract<CodeDrawCommand, { kind: 'group' }>): boolean {
  return (command.motionSamples ? command.motionSamples.every(sample => !sample.pose || sample.pose.opacity === 0 || sample.weight === 0) : command.opacity === 0) || !!command.clip && (!command.clip.width || !command.clip.height)
    || !!command.mask && !command.mask.invert && codeEmptyMask(command.mask.shape, command.mask.mode)
}
function codeEmptyMask(command: CodeDrawCommand | null, mode: 'alpha' | 'luma'): boolean {
  if (!command || command.opacity === 0 && !(command.kind === 'group' && command.motionSamples)) return true
  if (command.kind === 'image' || command.kind === 'shader' || command.kind === 'text' && command.perChar || command.glow || command.shadow) return false
  if (command.kind === 'group') return codeEmptyGroup(command) || command.children.every(child => codeEmptyMask(child, mode))
  const empty = (paint: CodePaint): boolean => {
    const colors = Array.isArray(paint) ? [paint] : paint.stops.map(stop => stop[1])
    return colors.every(color => color[3] === 0 || mode === 'luma' && color[0] === 0 && color[1] === 0 && color[2] === 0)
  }
  const fill = command.paint ?? ('fill' in command ? command.fill : command.color)
  return empty(fill) && (!(command.stroke && command.strokeWidth) || empty(command.stroke))
}
export function codeInvisible(command: CodeDrawCommand, matrix: CodeMatrix, width: number, height: number): boolean {
  // The supplied matrix is the frame center; it cannot prove exposure invisible.
  if (command.kind === 'group' && command.motionSamples) return codeEmptyGroup(command)
  if (command.opacity === 0) return true
  if (command.kind === 'group') return codeEmptyGroup(command) || !!command.clip && codeOutside({ ...command.clip, width: Math.ceil(command.clip.width), height: Math.ceil(command.clip.height) }, matrix, width, height)
  if (command.kind === 'text' && command.perChar) return false
  const stroke = Math.max(command.strokeWidth ?? 0, command.kind === 'line' ? command.width : 0)
  const pad = Math.ceil(stroke * 5 + Math.max(command.blur ?? 0, command.glow?.radius ?? 0, command.shadow?.blur ?? 0) * 4 + Math.max(Math.abs(command.shadow?.x ?? 0), Math.abs(command.shadow?.y ?? 0)) + 3)
  return codeOutside(codeLocalBounds(command), matrix, width, height, pad)
}

/** Keep the complete ID/path inventory for editing, but expose proven-culled
 * entries using the same zero-opacity state as existing invisible elements.
 * Only fresh commands from the evaluator may be passed to this function. */
export function hideInvisibleCodeCommands(commands: CodeDrawCommand[], width: number, height: number, parent: CodeMatrix = CODE_IDENTITY, ancestorEffect = false): CodeDrawCommand[] {
  for (const command of commands) {
    const matrix = codeMultiply(parent, codeTransform(command))
    if ((command.kind === 'group' ? codeEmptyGroup(command) : command.opacity === 0) || !ancestorEffect && codeInvisible(command, matrix, width, height)) command.opacity = 0
    else if (command.kind === 'group') hideInvisibleCodeCommands(command.children, width, height, matrix, ancestorEffect || !!command.motionSamples || !!command.blur || !!command.glow || !!command.shadow)
  }
  return commands
}

/** Full precision canonical serialization, with an exact collision check. No
 * rounding: even changes smaller than one float32 ULP invalidate reuse. */
export function codeCommandSignature(value: unknown): { hash: number; exact: string } {
  // Commands contain validated finite numbers and deterministic property order.
  // Native stringify keeps the shortest round-trip double representation. Signed
  // zero renders identically; no other finite double is rounded away.
  const exact = JSON.stringify(value)
  let hash = 2166136261
  for (let i = 0; i < exact.length; i++) hash = Math.imul(hash ^ exact.charCodeAt(i), 16777619)
  return { hash: hash >>> 0, exact }
}
/** Mutable media textures have no content revision; never cache their consumers. */
export function codeHasLiveImage(commands: readonly CodeDrawCommand[]): boolean {
  return commands.some(command => command.kind === 'image' || command.kind === 'group' && (codeHasLiveImage(command.children) || !!command.mask?.shape && codeHasLiveImage([command.mask.shape])))
}

/** Exclude editor-only identity from visual equality. A local map avoids
 * serializing group children twice, without caching mutable commands globally. */
export function codeVisualCommands(commands: readonly CodeDrawCommand[]): { commands: CodeDrawCommand[]; groups: Map<CodeDrawCommand, Extract<CodeDrawCommand, { kind: 'group' }>> } {
  const groups = new Map<CodeDrawCommand, Extract<CodeDrawCommand, { kind: 'group' }>>()
  const visit = (command: CodeDrawCommand): CodeDrawCommand => {
    const { elementId: _id, authorElementId: _author, elementPath: _path, sourceSpan: _span, ...visual } = command
    void _id; void _author; void _path; void _span
    if (visual.kind === 'group') {
      visual.children = visual.children.map(visit)
      if (visual.mask) visual.mask = { ...visual.mask, shape: visual.mask.shape ? visit(visual.mask.shape) : null }
      groups.set(command, visual)
    }
    return visual
  }
  return { commands: commands.map(visit), groups }
}
