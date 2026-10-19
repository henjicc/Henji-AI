import { parentPort, workerData } from 'node:worker_threads'
import { ScreenChangeAccumulator, type ScreenChangeOptions } from '../../../../src/core/videoEdit/screenChanges'

export type ScreenChangeWorkerRequest = { id: number; type: 'chunk'; bytes: Uint8Array } | { id: number; type: 'finish' }
const port = parentPort
if (port) {
  const options = workerData as ScreenChangeOptions
  const accumulator = new ScreenChangeAccumulator(options)
  const frame = new Uint8Array(options.width * options.height * options.channels)
  let offset = 0; let finished = false
  port.on('message', (request: ScreenChangeWorkerRequest) => {
    try {
      if (finished) throw new Error('局部变化分析已结束。')
      if (request.type === 'chunk') {
        if (!(request.bytes instanceof Uint8Array) || request.bytes.length > 1024 * 1024) throw new Error('局部变化采样块超过资源上限。')
        let read = 0
        while (read < request.bytes.length) {
          const count = Math.min(frame.length - offset, request.bytes.length - read)
          frame.set(request.bytes.subarray(read, read + count), offset); offset += count; read += count
          if (offset === frame.length) { accumulator.push(frame); offset = 0 }
        }
        port.postMessage({ id: request.id, ok: true })
      } else if (request.type === 'finish') {
        if (offset) throw new Error('局部变化解码帧不完整。')
        finished = true; port.postMessage({ id: request.id, ok: true, scan: accumulator.finish() })
      } else throw new Error('局部变化分析消息无效。')
    } catch (error) {
      finished = true
      port.postMessage({ id: request.id, ok: false, message: error instanceof Error ? error.message : String(error) })
    }
  })
}
