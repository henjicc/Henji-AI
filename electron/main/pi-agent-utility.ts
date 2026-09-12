import { PiEngine } from './services/embedded-agent/piEngine'
import type { EngineCommand } from './services/embedded-agent/contracts'

const port = process.parentPort
if (!port) throw new Error('助手运行时缺少宿主连接')
const pending = new Map<string, { resolve(value: unknown): void; reject(error: Error): void }>()
const engine = new PiEngine((event) => port.postMessage(event), (id, name, input, signal) => new Promise((resolve, reject) => {
  const abort = (): void => { pending.delete(id); port.postMessage({ type: 'toolCancel', id }); reject(new Error('操作等待已取消；已提交的业务操作请查询结果。')) }
  if (signal?.aborted) { abort(); return }
  pending.set(id, { resolve: (value) => { signal?.removeEventListener('abort', abort); resolve(value) },
    reject: (error) => { signal?.removeEventListener('abort', abort); reject(error) } })
  signal?.addEventListener('abort', abort, { once: true })
  port.postMessage({ type: 'tool', id, name, input })
}))
port.on('message', (event) => {
  const message = event.data as { type: 'command'; id: string; command: EngineCommand } | { type: 'toolResult'; id: string; value?: unknown; error?: string }
  if (message.type === 'toolResult') {
    const entry = pending.get(message.id)
    pending.delete(message.id)
    if (message.error) entry?.reject(new Error(message.error)); else entry?.resolve(message.value)
  } else if (message.type === 'command') {
    void engine.command(message.command).then((value) => port.postMessage({ type: 'result', id: message.id, value }),
      (error: unknown) => port.postMessage({ type: 'result', id: message.id, error: error instanceof Error ? error.message : '助手运行失败' }))
  }
})
