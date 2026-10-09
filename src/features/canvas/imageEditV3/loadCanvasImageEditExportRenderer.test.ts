import { beforeEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  moduleLoads: vi.fn(), error: vi.fn(), fail: false,
  cause: new Error('Failed to fetch dynamically imported module'),
}))
vi.mock('@/core/logging', () => ({ createLogger: () => ({ error: mocks.error }) }))
beforeEach(() => {
  vi.resetModules(); vi.clearAllMocks(); mocks.fail = false
  vi.doMock('@/features/imageEdit/v3/export', () => {
    mocks.moduleLoads()
    if (mocks.fail) throw mocks.cause
    return { prepareImageEditorV3ExportRender: vi.fn(), renderImageEditorV3ExportTilesWithGpu: vi.fn() }
  })
})

it('导入装配壳不加载渲染器；执行时加载且复用已加载模块', async () => {
  const { loadCanvasImageEditExportRenderer } = await import('./loadCanvasImageEditExportRenderer')
  expect(mocks.moduleLoads).not.toHaveBeenCalled()
  const renderer = await loadCanvasImageEditExportRenderer()
  expect(await loadCanvasImageEditExportRenderer()).toBe(renderer)
  expect(mocks.moduleLoads).toHaveBeenCalledTimes(1)
})

it('加载失败保留原因并记录日志，返回可恢复的用户错误', async () => {
  mocks.fail = true
  const { loadCanvasImageEditExportRenderer } = await import('./loadCanvasImageEditExportRenderer')
  const failure: unknown = await loadCanvasImageEditExportRenderer().catch((error: unknown) => error)
  expect(failure).toMatchObject({ code: 'OPERATION_FAILED', recoverable: true })
  if (!(failure instanceof Error)) throw new Error('加载失败必须返回 Error')
  expect(failure.message).toContain('请重试')
  expect(failure.cause).toBeInstanceOf(Error)
  expect(mocks.error).toHaveBeenCalledWith('加载图片导出功能失败', failure.cause, {
    event: 'canvas.document.export.load.failed',
  })
})
