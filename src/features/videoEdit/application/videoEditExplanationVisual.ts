const pictures = new WeakMap<HTMLCanvasElement, { frame: number; bitmap: ImageBitmap }>()
/** Worker snapshots are installed with the same receipt that acknowledges the visible frame. */
export function retainExplanationPixels(canvas: HTMLCanvasElement, frame: number, bitmap?: ImageBitmap): void {
  pictures.get(canvas)?.bitmap.close(); pictures.delete(canvas)
  if (bitmap) pictures.set(canvas, { frame, bitmap })
}
/** Copies acknowledged pixels synchronously; encoding/I/O never substitute a later picture. */
export function captureExplanationPixels(monitor: HTMLElement, frame: number): Promise<{ bytes: Uint8Array; size: [number, number] }> | undefined {
  const canvas = monitor.querySelector<HTMLCanvasElement>('canvas[aria-label="剪辑画面"]')
  if (!canvas || canvas.dataset.presentedFrame !== String(frame) || !canvas.width || !canvas.height || typeof OffscreenCanvas === 'undefined') return undefined
  const historical = pictures.get(canvas)
  if (!historical || historical.frame !== frame) return undefined
  // Per-attachment working pixel budget, never a recording/word/attachment count limit.
  const width = historical.bitmap.width; const height = historical.bitmap.height
  const copy = new OffscreenCanvas(width, height); const context = copy.getContext('2d')
  if (!context) throw new Error('无法保存指向时的历史画面')
  context.drawImage(historical.bitmap, 0, 0, width, height)
  return copy.convertToBlob({ type: 'image/png' }).then(async blob => ({ bytes: new Uint8Array(await blob.arrayBuffer()), size: [width, height] }))
}
