import { describeImageEditorV3SourcePyramid } from '@/commands/imageEditorV3'
import type { ImageEditorV3PyramidDescriptor, ImageEditorV3ResourceRef } from '@/platform/contracts/imageEditorV3'

type Reader = typeof describeImageEditorV3SourcePyramid
interface PendingPyramid {
  promise: Promise<ImageEditorV3PyramidDescriptor>
  controller: AbortController
  readers: number
}

/** GPU、CPU draft/target 和代理预热共享同一资源元数据；内容哈希是唯一身份。 */
export class ImageEditorSourcePyramidCacheV3 {
  private readonly completed = new Map<ImageEditorV3ResourceRef, ImageEditorV3PyramidDescriptor>()
  private readonly pending = new Map<ImageEditorV3ResourceRef, PendingPyramid>()
  private queue: Promise<unknown> = Promise.resolve()

  constructor(private readonly reader: Reader = describeImageEditorV3SourcePyramid) {}

  read: Reader = async (request, signal) => {
    if (signal?.aborted) throw abortError()
    const cached = this.completed.get(request.resourceRef)
    if (cached) {
      this.completed.delete(request.resourceRef)
      this.completed.set(request.resourceRef, cached)
      return structuredClone(cached)
    }
    let entry = this.pending.get(request.resourceRef)
    if (!entry) {
      const controller = new AbortController()
      const next: PendingPyramid = {
        controller, readers: 0,
        promise: Promise.resolve(null as unknown as ImageEditorV3PyramidDescriptor),
      }
      // 元数据极小；串行读取给实际像素解码保留主进程 admission 槽位。
      next.promise = this.queue.then(async () => {
        if (controller.signal.aborted) throw abortError()
        const pyramid = await this.reader(request, controller.signal)
        if (controller.signal.aborted) throw abortError()
        this.completed.set(request.resourceRef, structuredClone(pyramid))
        if (this.completed.size > 128) this.completed.delete(this.completed.keys().next().value!)
        return pyramid
      }).finally(() => {
        if (this.pending.get(request.resourceRef) === next) this.pending.delete(request.resourceRef)
      })
      this.queue = next.promise.catch(() => undefined)
      this.pending.set(request.resourceRef, next)
      entry = next
    }
    entry.readers += 1
    const current = entry
    try {
      return await new Promise<ImageEditorV3PyramidDescriptor>((resolve, reject) => {
        const onAbort = (): void => { reject(abortError()) }
        signal?.addEventListener('abort', onAbort, { once: true })
        void current.promise.then(
          (pyramid) => { if (!signal?.aborted) resolve(structuredClone(pyramid)) },
          reject,
        ).finally(() => { signal?.removeEventListener('abort', onAbort) })
      })
    } finally {
      current.readers -= 1
      if (current.readers === 0 && this.pending.get(request.resourceRef) === current) {
        this.pending.delete(request.resourceRef)
        current.controller.abort()
      }
    }
  }
}

function abortError(): Error {
  const error = new Error('图片资源金字塔读取已取消')
  error.name = 'AbortError'
  return error
}

const sharedPyramids = new ImageEditorSourcePyramidCacheV3()
export const readSharedImageEditorSourcePyramidV3: Reader = sharedPyramids.read
