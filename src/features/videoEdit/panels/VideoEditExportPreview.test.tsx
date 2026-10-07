// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { UiModal } from '@/components/ui'
import { createVideoEditDocument, createVideoEditSequence, videoEditComposition } from '@/core/videoEdit/document'
import { videoEditSequenceExportSettings } from '@/core/videoEdit/exportPresets'
import { VideoEditExportPreview } from './VideoEditExportPreview'

const renderer = vi.hoisted(() => ({
  create: vi.fn(), renderBitmap: vi.fn(), updateDocument: vi.fn(), dispose: vi.fn(),
  setSmartRegions: vi.fn(), setTracks: vi.fn(), warn: vi.fn(), debug: vi.fn(),
}))
// The pixel boundary is controlled; the real component, modal mount and output geometry are exercised.
vi.mock('../engine/videoEditRenderSession', () => ({ VideoEditRenderSession: class {
  constructor(...args: unknown[]) { renderer.create(...args) }
  renderBitmap = renderer.renderBitmap
  updateDocument = renderer.updateDocument
  dispose = renderer.dispose
  setSmartRegions = renderer.setSmartRegions
  setTracks = renderer.setTracks
} }))
vi.mock('../application/videoEditSmartRegions', () => ({ videoEditSmartRegionSegments: () => ({}) }))
vi.mock('../application/videoEditTracking', () => ({ videoEditTrackResults: () => ({}) }))
vi.mock('@/core/logging', () => ({ createLogger: () => ({ warn: renderer.warn, debug: renderer.debug }) }))

function fixture() {
  const sequence = { ...createVideoEditSequence(), width: 1920, height: 1080 }
  const composition = videoEditComposition({ ...createVideoEditDocument('预览测试'), sequences: [sequence] }, sequence.id)
  return { composition, settings: videoEditSequenceExportSettings(composition), frame: 12, projectId: 'project' }
}
function picture() {
  const bitmap = { width: 640, height: 360, close: vi.fn() } as unknown as ImageBitmap
  return { bitmap }
}
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}
const drawImage = vi.fn()
beforeEach(() => {
  vi.resetAllMocks()
  renderer.renderBitmap.mockImplementation(async () => picture())
  renderer.updateDocument.mockResolvedValue(undefined)
  renderer.dispose.mockResolvedValue(undefined)
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ fillRect: vi.fn(), drawImage, fillStyle: '' } as unknown as CanvasRenderingContext2D)
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers() })

it('弹窗打开后画布已挂载，正式预览会话返回画面后绘制并结束加载', async () => {
  const props = fixture(); const result = picture()
  renderer.renderBitmap.mockResolvedValue(result)
  const view = render(<UiModal isOpen title="导出" onClose={vi.fn()}><VideoEditExportPreview {...props} /></UiModal>)
  await waitFor(() => expect(view.queryByText('正在准备预览…')).toBeNull())
  expect(renderer.create).toHaveBeenCalledWith(expect.objectContaining({ id: props.composition.id, captions: [] }), 640, undefined, undefined, undefined, undefined, false)
  expect(renderer.renderBitmap).toHaveBeenCalledWith(12)
  const canvas = view.getByLabelText('导出画面预览') as HTMLCanvasElement
  expect(canvas.hidden).toBe(false)
  expect([canvas.width, canvas.height]).toEqual([640, 360])
  expect(drawImage).toHaveBeenCalledWith(result.bitmap, 0, 0, 640, 360, 0, 0, 640, 360)
  expect(canvas.parentElement?.getAttribute('aria-busy')).toBe('false')
  expect(result.bitmap.close).toHaveBeenCalledOnce()
  expect(renderer.debug).toHaveBeenCalledWith('导出预览画面已显示', expect.objectContaining({ event: 'video_edit.export.preview_completed' }))
  view.unmount(); expect(renderer.dispose).toHaveBeenCalledOnce()
})

it('渲染失败显示可重试的失败状态并记日志，重试创建新会话后显示画面', async () => {
  const reason = new Error('worker decode failed')
  renderer.renderBitmap.mockRejectedValueOnce(reason)
  const view = render(<VideoEditExportPreview {...fixture()} />)
  await waitFor(() => expect(view.getByText('预览未能生成')).toBeTruthy())
  expect(view.queryByText('正在准备预览…')).toBeNull()
  expect(view.getByLabelText('导出画面预览')).toHaveProperty('hidden', true)
  expect(renderer.warn).toHaveBeenCalledWith('渲染导出预览失败', expect.objectContaining({ event: 'video_edit.export.preview_failed', error: reason }))
  expect(view.queryByText(reason.message)).toBeNull()
  fireEvent.click(view.getByRole('button', { name: /^(重试|Retry)$/ }))
  await waitFor(() => expect(drawImage).toHaveBeenCalledOnce())
  expect(renderer.create).toHaveBeenCalledTimes(2)
  expect(renderer.dispose).toHaveBeenCalledOnce()
  expect(view.queryByText('预览未能生成')).toBeNull()
})

it('会话初始化抛错也显示失败；画布显示失败关闭返回的画面', async () => {
  renderer.create.mockImplementationOnce(() => { throw new Error('初始化失败') })
  const view = render(<VideoEditExportPreview {...fixture()} />)
  expect(view.getByText('预览未能生成')).toBeTruthy()
  expect(view.queryByText('正在准备预览…')).toBeNull()
  expect(renderer.warn).toHaveBeenCalledWith('创建导出预览失败', expect.objectContaining({ event: 'video_edit.export.preview_failed' }))
  vi.mocked(HTMLCanvasElement.prototype.getContext).mockReturnValue(null)
  const result = picture(); renderer.renderBitmap.mockResolvedValue(result)
  fireEvent.click(view.getByRole('button', { name: /^(重试|Retry)$/ }))
  await waitFor(() => expect(result.bitmap.close).toHaveBeenCalledOnce())
  expect(view.getByText('预览未能生成')).toBeTruthy()
  expect(view.queryByText('正在准备预览…')).toBeNull()
})

it('渲染一直不返回时超时结束加载、释放会话；迟到画面被关闭且不能抹掉失败', async () => {
  vi.useFakeTimers()
  const pending = deferred<ReturnType<typeof picture>>()
  renderer.renderBitmap.mockReturnValue(pending.promise)
  const view = render(<VideoEditExportPreview {...fixture()} />)
  await act(async () => { await vi.advanceTimersByTimeAsync(30_000) })
  expect(view.getByText('预览等待时间过长，请重试。')).toBeTruthy()
  expect(view.queryByText('正在准备预览…')).toBeNull()
  expect(renderer.dispose).toHaveBeenCalledOnce()
  expect(renderer.warn).toHaveBeenCalledWith('导出预览等待超时', expect.objectContaining({ event: 'video_edit.export.preview_failed' }))
  const late = picture(); await act(async () => { pending.resolve(late) })
  expect(late.bitmap.close).toHaveBeenCalledOnce()
  expect(drawImage).not.toHaveBeenCalled()
  expect(view.getByText('预览未能生成')).toBeTruthy()
})

it('快速切换时刻合并到最新请求，过期帧只释放不绘制，输出画幅按设置处理', async () => {
  const props = fixture(); const pending = deferred<ReturnType<typeof picture>>()
  renderer.renderBitmap.mockReturnValueOnce(pending.promise)
  const view = render(<VideoEditExportPreview {...props} />)
  view.rerender(<VideoEditExportPreview {...props} frame={24} settings={{ ...props.settings, width: 1080, height: 1920, fit: 'letterbox' }} />)
  view.rerender(<VideoEditExportPreview {...props} frame={30} settings={{ ...props.settings, width: 1080, height: 1920, fit: 'letterbox' }} />)
  const stale = picture(); await act(async () => { pending.resolve(stale) })
  expect(renderer.renderBitmap.mock.calls).toEqual([[12], [30]])
  expect(stale.bitmap.close).toHaveBeenCalledOnce()
  expect(drawImage).toHaveBeenCalledOnce()
  expect(drawImage.mock.calls[0][0]).not.toBe(stale.bitmap)
  const canvas = view.getByLabelText('导出画面预览') as HTMLCanvasElement
  expect([canvas.width, canvas.height]).toEqual([360, 640])
  expect(drawImage.mock.calls[0].slice(5)).toEqual([0, 218.75, 360, 202.5])
})

it('视频关闭或面板卸载时释放会话，迟到画面不绘制；纯音频不创建渲染器', async () => {
  const props = fixture(); const pending = deferred<ReturnType<typeof picture>>()
  renderer.renderBitmap.mockReturnValueOnce(pending.promise)
  const view = render(<VideoEditExportPreview {...props} />)
  view.rerender(<VideoEditExportPreview {...props} settings={{ ...props.settings, videoEnabled: false }} />)
  expect(view.getByText('仅导出音频')).toBeTruthy()
  expect(renderer.dispose).toHaveBeenCalledOnce()
  const stale = picture(); await act(async () => { pending.resolve(stale) })
  expect(stale.bitmap.close).toHaveBeenCalledOnce()
  expect(drawImage).not.toHaveBeenCalled()
  cleanup(); renderer.create.mockClear()
  render(<VideoEditExportPreview {...props} settings={{ ...props.settings, videoEnabled: false }} />)
  expect(renderer.create).not.toHaveBeenCalled()
})
