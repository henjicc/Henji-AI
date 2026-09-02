import { describe, expect, it, vi } from 'vitest'

import { runSharpOperation } from './sharp-operation'

describe('runSharpOperation', () => {
  it('取消进行中的 Sharp pass 时不向 Stream 注入未处理错误', async () => {
    const controller = new AbortController()
    let rejectOperation: ((error: Error) => void) | undefined
    const destroy = vi.fn(() => {
      rejectOperation?.(new Error('pipeline destroyed'))
    })
    const operation = runSharpOperation(
      { destroy },
      controller.signal,
      () => new Promise<never>((_resolve, reject) => {
        rejectOperation = reject
      }),
    )

    controller.abort()

    await expect(operation).rejects.toMatchObject({ name: 'AbortError' })
    expect(destroy).toHaveBeenCalledOnce()
    expect(destroy).toHaveBeenCalledWith()
  })

  it('开始前已取消时同样无错误参数地销毁管线', async () => {
    const controller = new AbortController()
    controller.abort()
    const destroy = vi.fn()
    const execute = vi.fn(async () => 'unused')

    await expect(runSharpOperation(
      { destroy },
      controller.signal,
      execute,
    )).rejects.toMatchObject({ name: 'AbortError' })
    expect(destroy).toHaveBeenCalledWith()
    expect(execute).not.toHaveBeenCalled()
  })

  it('成功完成后立即销毁管线并释放原生文件句柄', async () => {
    const destroy = vi.fn()

    await expect(runSharpOperation(
      { destroy },
      undefined,
      async () => 'done',
    )).resolves.toBe('done')

    expect(destroy).toHaveBeenCalledOnce()
    expect(destroy).toHaveBeenCalledWith()
  })
})
