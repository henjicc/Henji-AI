import { expect, it, vi } from 'vitest'
import { VideoEditSharedCompilation } from './videoEditSharedCompilation'
import type { CodeMaterialFiles } from '@/core/videoEdit/codeMaterial/sources'

it('sessions multiplex independent ids and cancellation only removes that owner', () => {
  const send = vi.fn(); const transport = new VideoEditSharedCompilation(send)
  const a = transport.worker(); const b = transport.worker()
  a.onmessage = vi.fn(); b.onmessage = vi.fn()
  const files: CodeMaterialFiles = { entry: 'main.ts', files: { 'main.ts': 'content' } }
  a.postMessage({ id: 1, files }); b.postMessage({ id: 1, files })
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
