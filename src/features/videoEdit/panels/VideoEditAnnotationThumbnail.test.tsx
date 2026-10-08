// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createVideoEditTestDocument } from '@/core/videoEdit/testFixtures'
import { VideoEditAnnotationThumbnail } from './VideoEditAnnotationThumbnail'
import { trialVideoEditCodeFrames } from '../application/videoEditCodeTrial'
import { VIDEO_EDIT_PREVIEW_TIMEOUT_MS } from '../application/videoEditPreviewTask'

const logs = vi.hoisted(() => ({ debug: vi.fn(), warn: vi.fn() }))
vi.mock('@/core/logging', () => ({ createLogger: () => logs }))
vi.mock('../application/videoEditCodeTrial', () => ({ trialVideoEditCodeFrames: vi.fn() }))
const close = vi.fn(); const encode = vi.fn(async () => new Blob(['thumbnail']))
const bitmap = (): ImageBitmap => ({ width: 1920, height: 1080, close } as unknown as ImageBitmap)
beforeEach(() => {
  vi.clearAllMocks(); vi.useFakeTimers()
  vi.mocked(trialVideoEditCodeFrames).mockResolvedValue(bitmap())
  encode.mockResolvedValue(new Blob(['thumbnail']))
  vi.stubGlobal('OffscreenCanvas', class {
    constructor(public width: number, public height: number) {}
    getContext() { return { drawImage: vi.fn() } }
    convertToBlob = encode
  })
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => `blob:thumbnail-${Math.random()}`), revokeObjectURL: vi.fn() }))
})
afterEach(async () => { cleanup(); await act(async () => { await vi.advanceTimersByTimeAsync(0) }); vi.useRealTimers(); vi.unstubAllGlobals() })
const flush = async (): Promise<void> => { await act(async () => { await vi.advanceTimersByTimeAsync(0) }) }

it('标注AI处理状态/讨论变化不取消同一画面；画面修改后中止并重排，迟到帧不会覆盖', async () => {
  const document = createVideoEditTestDocument('批注'); const sequenceId = document.sequences[0].id
  let finish!: (value: ImageBitmap) => void
  vi.mocked(trialVideoEditCodeFrames).mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  const view = render(<VideoEditAnnotationThumbnail document={document} sequenceId={sequenceId} frame={12} />)
  await flush()
  const signal = vi.mocked(trialVideoEditCodeFrames).mock.calls[0][1]
  const addressed = structuredClone(document); addressed.revision++
  addressed.sequences[0].annotations = [{ id: 'mark', frame: 12, space: 'composition-normalized', createdAt: '2026-10-08T00:00:00Z', author: { kind: 'user', name: '我' }, text: '已处理', status: 'addressed', target: { kind: 'point', x: .2, y: .2 }, addressedBy: { revision: 1 }, thread: [{ id: 'reply', author: { kind: 'assistant', name: '助手' }, createdAt: '2026-10-08T00:00:00Z', text: '已处理' }] }]
  view.rerender(<VideoEditAnnotationThumbnail document={addressed} sequenceId={sequenceId} frame={12} />)
  await flush(); expect(signal.aborted).toBe(false); expect(trialVideoEditCodeFrames).toHaveBeenCalledOnce()
  const changed = structuredClone(addressed); changed.sequences[0].width = 1280; changed.revision++
  view.rerender(<VideoEditAnnotationThumbnail document={changed} sequenceId={sequenceId} frame={12} />)
  await flush(); expect(signal.aborted).toBe(true); expect(trialVideoEditCodeFrames).toHaveBeenCalledTimes(2)
  const url = screen.getByRole('img').getAttribute('src')
  finish(bitmap()); await flush()
  expect(screen.getByRole('img').getAttribute('src')).toBe(url); expect(close).toHaveBeenCalledTimes(2)
  view.unmount(); expect(URL.revokeObjectURL).toHaveBeenCalledWith(url)
})
it('可见列表单项失败不阻塞后项，行内重试重新取帧且没有嵌套按钮', async () => {
  const document = createVideoEditTestDocument('串行'); const sequenceId = document.sequences[0].id
  vi.mocked(trialVideoEditCodeFrames).mockRejectedValueOnce(new Error('取帧失败'))
  render(<><VideoEditAnnotationThumbnail document={document} sequenceId={sequenceId} frame={1} /><VideoEditAnnotationThumbnail document={document} sequenceId={sequenceId} frame={2} /></>)
  await flush()
  expect(screen.getAllByRole('img')).toHaveLength(1)
  expect(logs.warn).toHaveBeenCalledWith('批注缩略图未完成', expect.objectContaining({ event: 'video_edit.annotation_preview.failed' }))
  fireEvent.click(screen.getByRole('button', { name: '重新获取标注画面' })); await flush()
  expect(screen.getAllByRole('img')).toHaveLength(2)
  expect(window.document.querySelector('button button')).toBeNull()
})
it('卡住的PNG转换超时释放队列，后项成功出图；bitmap在转换前释放', async () => {
  const document = createVideoEditTestDocument('超时'); const sequenceId = document.sequences[0].id
  encode.mockImplementationOnce(() => new Promise(() => undefined))
  const first = render(<VideoEditAnnotationThumbnail document={document} sequenceId={sequenceId} frame={1} />)
  await flush(); expect(close).toHaveBeenCalledOnce()
  await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
  render(<VideoEditAnnotationThumbnail document={document} sequenceId={sequenceId} frame={2} />)
  await act(async () => { await vi.advanceTimersByTimeAsync(VIDEO_EDIT_PREVIEW_TIMEOUT_MS - 1000) })
  expect(screen.getByRole('button', { name: '重新获取标注画面' })).toBeTruthy()
  expect(screen.getByRole('img')).toBeTruthy(); expect(close).toHaveBeenCalledTimes(2)
  fireEvent.click(screen.getByRole('button', { name: '重新获取标注画面' })); await flush()
  expect(screen.getAllByRole('img')).toHaveLength(2); first.unmount()
})
it('卸载卡住项后再次挂载正常取帧，迟到结果关闭且不创建URL', async () => {
  const document = createVideoEditTestDocument('重新可见'); const sequenceId = document.sequences[0].id
  let finish!: (value: ImageBitmap) => void
  vi.mocked(trialVideoEditCodeFrames).mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  const first = render(<VideoEditAnnotationThumbnail document={document} sequenceId={sequenceId} frame={1} />)
  await flush(); first.unmount(); await flush()
  render(<VideoEditAnnotationThumbnail document={document} sequenceId={sequenceId} frame={1} />); await flush()
  expect(screen.getByRole('img')).toBeTruthy(); expect(URL.createObjectURL).toHaveBeenCalledOnce()
  finish(bitmap()); await flush(); expect(close).toHaveBeenCalledTimes(2); expect(URL.createObjectURL).toHaveBeenCalledOnce()
})
