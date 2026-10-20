import { expect, it, vi } from 'vitest'
import { VideoEditSharedCompilation } from './videoEditSharedCompilation'
import type { CodeMaterialFiles } from '@/core/videoEdit/codeMaterial/sources'

it('直接执行模块通过共享通道打包并返回源码定位', () => {
  const send = vi.fn(); const transport = new VideoEditSharedCompilation(send)
  const worker = transport.worker(); worker.onmessage = vi.fn()
  const files = { entry: 'main.js', files: { 'main.js': 'export default {}' } }
  worker.postMessage({ id: 7, kind: 'author.bundle', files })
  expect(send).toHaveBeenCalledWith(expect.objectContaining({ kind: 'code.compile', operation: 'author.bundle', files }))
  const token = send.mock.calls[0][0].token
  const bundle = { code: 'export default {}', map: '{}', locations: { layers: {} } }
  transport.receive({ kind: 'code.compiled', token, result: { id: 1, bundle } })
  expect(worker.onmessage).toHaveBeenCalledWith({ data: { id: 7, bundle } })
})

it('sessions multiplex independent ids and cancellation only removes that owner', () => {
  const send = vi.fn(); const transport = new VideoEditSharedCompilation(send)
  const a = transport.worker(); const b = transport.worker()
  a.onmessage = vi.fn(); b.onmessage = vi.fn()
  const files: CodeMaterialFiles = { entry: 'main.ts', files: { 'main.ts': 'content' } }
  a.postMessage({ id: 1, files, kind: 'author.bundle' }); b.postMessage({ id: 1, files, kind: 'author.bundle' })
  const first = send.mock.calls[0][0].token; const second = send.mock.calls[1][0].token
  expect(first).not.toBe(second)
  a.terminate()
  expect(send).toHaveBeenLastCalledWith({ kind: 'code.cancel', token: first })
  const result = { id: 100, error: { code: 'CONTEXT' as const, message: 'failure' } }
  transport.receive({ kind: 'code.compiled', token: first, result })
  transport.receive({ kind: 'code.compiled', token: second, result })
  expect(a.onmessage).not.toHaveBeenCalled()
  expect(b.onmessage).toHaveBeenCalledWith({ data: { ...result, id: 1 } })
  transport.receive({ kind: 'code.compiled', token: second, result })
  expect(b.onmessage).toHaveBeenCalledOnce()
})
