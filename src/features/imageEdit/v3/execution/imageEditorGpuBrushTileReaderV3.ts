import { readImageEditorV3BrushTiles } from '@/commands/imageEditorV3'

const BRUSH_READ_CONTENTION_RETRIES = 12

type BrushTileRead = typeof readImageEditorV3BrushTiles

/** GPU Scene 与 CPU fallback 共用同一主进程准入池；短暂争用必须可取消地退避。 */
export async function readImageEditorBrushTilesWithAdmissionV3(
  read: BrushTileRead,
  request: Parameters<BrushTileRead>[0],
  signal: AbortSignal,
): Promise<Awaited<ReturnType<BrushTileRead>>> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await read(request, signal)
    } catch (error) {
      if (signal.aborted || attempt >= BRUSH_READ_CONTENTION_RETRIES
        || !(error instanceof Error)
        || !error.message.includes('brush_tiles.read concurrency limit reached')) throw error
      await abortableDelay(20 * (attempt + 1), signal)
    }
  }
}

export const readImageEditorGpuBrushTilesV3 = readImageEditorBrushTilesWithAdmissionV3

function abortableDelay(delayMs: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(new DOMException('Aborted', 'AbortError'))
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve() }, delayMs)
    const abort = (): void => {
      clearTimeout(timer)
      reject(new DOMException('Aborted', 'AbortError'))
    }
    signal.addEventListener('abort', abort, { once: true })
  })
}
