export type ImageEditorSnapAxisV3 = 'x' | 'y'
export type ImageEditorSnapAnchorV3 = 'start' | 'center' | 'end'

export interface ImageEditorSnapBoundsV3 {
  left: number
  top: number
  right: number
  bottom: number
}

export interface ImageEditorSnapCandidateV3 {
  axis: ImageEditorSnapAxisV3
  position: number
  anchor: ImageEditorSnapAnchorV3
}

export interface ImageEditorSnapGuideV3 {
  axis: ImageEditorSnapAxisV3
  position: number
}

export interface ImageEditorMoveSnapResultV3 {
  deltaX: number
  deltaY: number
  guides: ImageEditorSnapGuideV3[]
}

interface AxisSnapMatchV3 {
  correction: number
  guide: ImageEditorSnapGuideV3
  movingAnchor: ImageEditorSnapAnchorV3
  targetAnchor: ImageEditorSnapAnchorV3
}

const ANCHOR_TIE_PRIORITY_V3: Record<ImageEditorSnapAnchorV3, number> = {
  center: 0,
  start: 1,
  end: 2,
}

function axisAnchorsV3(
  bounds: ImageEditorSnapBoundsV3,
  axis: ImageEditorSnapAxisV3,
): ReadonlyArray<{ anchor: ImageEditorSnapAnchorV3; position: number }> {
  const start = axis === 'x' ? bounds.left : bounds.top
  const end = axis === 'x' ? bounds.right : bounds.bottom
  return [
    { anchor: 'start', position: start },
    { anchor: 'center', position: (start + end) / 2 },
    { anchor: 'end', position: end },
  ]
}

function isBetterAxisMatchV3(next: AxisSnapMatchV3, current: AxisSnapMatchV3 | null): boolean {
  if (!current) return true
  const nextDistance = Math.abs(next.correction)
  const currentDistance = Math.abs(current.correction)
  if (Math.abs(nextDistance - currentDistance) > 1e-6) return nextDistance < currentDistance

  const nextSameAnchor = next.movingAnchor === next.targetAnchor
  const currentSameAnchor = current.movingAnchor === current.targetAnchor
  if (nextSameAnchor !== currentSameAnchor) return nextSameAnchor

  return ANCHOR_TIE_PRIORITY_V3[next.targetAnchor]
    < ANCHOR_TIE_PRIORITY_V3[current.targetAnchor]
}

function resolveAxisSnapV3(
  bounds: ImageEditorSnapBoundsV3,
  candidates: readonly ImageEditorSnapCandidateV3[],
  axis: ImageEditorSnapAxisV3,
  threshold: number,
): AxisSnapMatchV3 | null {
  if (!Number.isFinite(threshold) || threshold < 0) return null
  let best: AxisSnapMatchV3 | null = null
  for (const moving of axisAnchorsV3(bounds, axis)) {
    for (const target of candidates) {
      if (target.axis !== axis || !Number.isFinite(target.position)) continue
      const correction = target.position - moving.position
      if (Math.abs(correction) > threshold) continue
      const match: AxisSnapMatchV3 = {
        correction,
        guide: { axis, position: target.position },
        movingAnchor: moving.anchor,
        targetAnchor: target.anchor,
      }
      if (isBetterAxisMatchV3(match, best)) best = match
    }
  }
  return best
}

export function createImageEditorDocumentSnapCandidatesV3(
  width: number,
  height: number,
): ImageEditorSnapCandidateV3[] {
  return [
    { axis: 'x', position: 0, anchor: 'start' },
    { axis: 'x', position: width / 2, anchor: 'center' },
    { axis: 'x', position: width, anchor: 'end' },
    { axis: 'y', position: 0, anchor: 'start' },
    { axis: 'y', position: height / 2, anchor: 'center' },
    { axis: 'y', position: height, anchor: 'end' },
  ]
}

/**
 * 只负责从候选锚点中求出最小校正量；候选来源与图层类型解耦，后续可直接加入
 * 参考线、选区和其他元素的边缘/中心，而无需另写一套拖动算法。
 */
export function resolveImageEditorMoveSnapV3(
  bounds: ImageEditorSnapBoundsV3,
  candidates: readonly ImageEditorSnapCandidateV3[],
  threshold: Readonly<{ x: number; y: number }>,
): ImageEditorMoveSnapResultV3 {
  const xMatch = resolveAxisSnapV3(bounds, candidates, 'x', threshold.x)
  const yMatch = resolveAxisSnapV3(bounds, candidates, 'y', threshold.y)
  return {
    deltaX: xMatch?.correction ?? 0,
    deltaY: yMatch?.correction ?? 0,
    guides: [xMatch?.guide, yMatch?.guide].filter(
      (guide): guide is ImageEditorSnapGuideV3 => Boolean(guide),
    ),
  }
}
