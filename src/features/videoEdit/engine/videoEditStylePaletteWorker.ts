import { extractStylePalettePixels } from '@/core/videoEdit/styleKitExtraction'
const worker = self as unknown as DedicatedWorkerGlobalScope
worker.onmessage = (event: MessageEvent<{ pixels: Uint8ClampedArray }>): void => {
  try { worker.postMessage({ clusters: extractStylePalettePixels(event.data.pixels) }) }
  catch (error) { worker.postMessage({ error: error instanceof Error ? error.message : '参考配色提取失败。' }) }
}
