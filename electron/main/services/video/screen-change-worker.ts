import { parentPort, workerData } from 'node:worker_threads'
import { ScreenChangeAccumulator, type ScreenChangeOptions } from '../../../../src/core/videoEdit/screenChanges'
import { VideoMotionAccumulator } from './motion-pixels'
import type { VideoMotionOptions } from '../../../../src/core/media/motionEvidence'
import { loadTrackingOpenCv } from '../local-inference/tracking/openCvTracking'

export type ScreenChangeWorkerRequest = { id: number; type: 'chunk'; bytes: Uint8Array } | { id: number; type: 'finish' }
const port = parentPort
if (port) {
  const options = workerData as ScreenChangeOptions | VideoMotionOptions
  let accumulator: ScreenChangeAccumulator | VideoMotionAccumulator | undefined
  let frame: Uint8Array | undefined
  let offset = 0; let finished = false; let busy = false
  port.on('message', async (request: ScreenChangeWorkerRequest) => {
    if (busy) { port.postMessage({ id: request.id, ok: false, message: '画面分析只允许一个在途采样块。' }); return }
    try {
      if (finished) throw new Error('局部变化分析已结束。')
      busy = true
      if (!accumulator) {
        accumulator = 'analysis' in options && options.analysis === 'motion'
          ? new VideoMotionAccumulator((await loadTrackingOpenCv()).cv, options)
          : new ScreenChangeAccumulator(options as ScreenChangeOptions)
        frame = new Uint8Array(options.width * options.height * options.channels)
      }
      if (request.type === 'chunk') {
        if (!(request.bytes instanceof Uint8Array) || request.bytes.length > 1024 * 1024) throw new Error('局部变化采样块超过资源上限。')
        let read = 0
        while (read < request.bytes.length) {
          const count = Math.min(frame!.length - offset, request.bytes.length - read)
          frame!.set(request.bytes.subarray(read, read + count), offset); offset += count; read += count
          if (offset === frame!.length) { accumulator.push(frame!); offset = 0 }
        }
        port.postMessage({ id: request.id, ok: true })
      } else if (request.type === 'finish') {
        if (offset) throw new Error('局部变化解码帧不完整。')
        finished = true
        const scan = accumulator.finish()
        if (accumulator instanceof VideoMotionAccumulator) accumulator.dispose()
        port.postMessage({ id: request.id, ok: true, scan })
      } else throw new Error('局部变化分析消息无效。')
    } catch (error) {
      finished = true
      if (accumulator instanceof VideoMotionAccumulator) accumulator.dispose()
      port.postMessage({ id: request.id, ok: false, message: error instanceof Error ? error.message : String(error) })
    } finally { busy = false }
  })
}
