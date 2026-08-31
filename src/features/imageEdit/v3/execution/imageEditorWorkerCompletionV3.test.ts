import { describe, expect, it, vi } from 'vitest'

import { ImageEditorWorkerCompletionV3 } from './imageEditorWorkerCompletionV3'

describe('ImageEditorWorkerCompletionV3', () => {
  it('同步启动失败会释放等待者，同一实例可安全继续使用', async () => {
    const completion = new ImageEditorWorkerCompletionV3<string>()
    await expect(completion.wait({
      signals: [],
      onAbort: () => undefined,
      fallbackAbortError: () => new Error('已取消'),
      start: () => { throw new Error('启动失败') },
    })).rejects.toThrow('启动失败')

    const next = completion.wait({
      signals: [],
      onAbort: () => undefined,
      fallbackAbortError: () => new Error('已取消'),
      start: () => { completion.resolve('ok') },
    })
    await expect(next).resolves.toBe('ok')
  })

  it('取消时即使 Worker 清理回调失败也以 signal reason 稳定拒绝', async () => {
    const completion = new ImageEditorWorkerCompletionV3<string>()
    const controller = new AbortController()
    const onAbort = vi.fn(() => { throw new Error('清理失败') })
    const pending = completion.wait({
      signals: [controller.signal],
      onAbort,
      fallbackAbortError: () => new Error('已取消'),
      start: () => undefined,
    })
    const reason = new Error('更新版本取代')
    controller.abort(reason)
    await expect(pending).rejects.toBe(reason)
    expect(onAbort).toHaveBeenCalledOnce()
  })
})
