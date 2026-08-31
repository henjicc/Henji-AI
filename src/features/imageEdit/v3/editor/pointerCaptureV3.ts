export interface CapturedEditorPointerV3 {
  captureTarget: SVGSVGElement
  pointerId: number
}

export function captureEditorPointerV3(
  captureTarget: SVGSVGElement,
  pointerId: number,
): CapturedEditorPointerV3 {
  captureTarget.setPointerCapture?.(pointerId)
  return { captureTarget, pointerId }
}

export function releaseEditorPointerV3(pointer: CapturedEditorPointerV3): void {
  const { captureTarget, pointerId } = pointer
  if (captureTarget.hasPointerCapture?.(pointerId)) {
    captureTarget.releasePointerCapture(pointerId)
  }
}

export function matchesEditorPointerV3(
  pointer: CapturedEditorPointerV3,
  pointerId: number,
): boolean {
  return pointer.pointerId === pointerId
}
