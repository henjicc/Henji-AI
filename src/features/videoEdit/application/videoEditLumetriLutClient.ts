import type { CubeLut } from '@/core/videoEdit/cubeLut'
import type { VideoEditBuiltinParams } from '@/core/videoEdit/builtinEffects'
export type LumetriWorkerRequest = { kind: 'lut'; bytes: Uint8Array } | { kind: 'analyze'; pixels: Uint8ClampedArray; reference?: Uint8ClampedArray; method?: 'moments' | 'histogram' }
export type LumetriWorkerResult = { lut: CubeLut; contentIdentity: string } | { parameters: VideoEditBuiltinParams }
/** One import/verification owns one worker; large 65³ tables never parse on the UI thread. */
function request(request: LumetriWorkerRequest, transfer: Transferable[], signal?: AbortSignal): Promise<LumetriWorkerResult> {
  signal?.throwIfAborted()
  const worker = new Worker(new URL('../engine/videoEditLumetriLutWorker.ts', import.meta.url), { type: 'module' })
  return new Promise((resolve, reject) => {
    const finish = () => { worker.terminate(); signal?.removeEventListener('abort', abort) }
    const abort = () => { finish(); reject(signal?.reason ?? new Error('LUT 导入已取消。')) }
    worker.onmessage = (event: MessageEvent<LumetriWorkerResult | { error: string }>) => { finish(); if ('error' in event.data) reject(new Error(event.data.error)); else resolve(event.data) }
    worker.onerror = event => { finish(); reject(new Error(event.message)) }
    signal?.addEventListener('abort', abort, { once: true })
    if (signal?.aborted) { abort(); return }
    try { worker.postMessage(request, transfer) } catch (error) { finish(); reject(error) }
  })
}
export async function decodeVideoEditLutOffThread(bytes: Uint8Array, signal?: AbortSignal): Promise<{ lut: CubeLut; contentIdentity: string }> {
  const owned = Uint8Array.from(bytes)
  const result = await request({ kind: 'lut', bytes: owned }, [owned.buffer], signal)
  if (!('lut' in result)) throw new Error('LUT 解析返回异常。')
  return result
}
export async function analyzeVideoEditLumetriOffThread(pixels: Uint8ClampedArray, reference?: Uint8ClampedArray, method?: 'moments' | 'histogram', signal?: AbortSignal): Promise<VideoEditBuiltinParams> {
  const result = await request({ kind: 'analyze', pixels, reference, method }, [pixels.buffer, ...(reference ? [reference.buffer] : [])], signal)
  if (!('parameters' in result)) throw new Error('颜色分析返回异常。')
  return result.parameters
}
