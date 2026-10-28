// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { VideoEditInstance } from '../application/videoEditService'
import { VideoEditRenderWorkerError } from '../engine/videoEditGpuFailure'
import { VideoEditMulticamView } from './VideoEditMulticamView'

const boundary = vi.hoisted(() => ({ present: vi.fn(), dispose: vi.fn(async () => undefined), created: 0 }))
vi.mock('../engine/videoEditRenderSession', () => ({ VideoEditRenderSession: class {
  constructor() { boundary.created++ }
  renderBitmap = boundary.present
  dispose = boundary.dispose
  async updateDocument() {}
} }))
vi.mock('../application/videoEditMulticam', () => ({
  videoEditProgramMulticam: () => ({ source: { id: 'source', multicam: { cameras: [{ id: 'camera', name: '机位' }] } }, clip: {} }), switchVideoEditMulticam: vi.fn(),
}))
vi.mock('../application/videoEditService', () => ({
  subscribeVideoEditView: () => () => {}, subscribeVideoEditDomain: () => () => {}, videoEditDomainRevision: () => 0, videoEditViewRevision: () => 0, getActiveVideoEditSequence: () => ({}),
}))
vi.mock('@/core/videoEdit/document', async importOriginal => ({ ...await importOriginal<typeof import('@/core/videoEdit/document')>(), videoEditNestedComposition: () => ({}) }))
vi.mock('@/core/videoEdit/nestedSequences', () => ({ videoEditNestedFrame: (_parent: unknown, _clip: unknown, _composition: unknown, frame: number) => frame }))
beforeEach(() => { vi.useFakeTimers(); boundary.created = 0; boundary.present.mockReset(); boundary.dispose.mockClear(); vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: vi.fn() } as unknown as CanvasRenderingContext2D) })
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks() })

it('多机位的普通 Worker 故障退避重建并恢复播放头，连续失败后使用现有重试入口', async () => {
  const bitmap = { width: 320, height: 180, close: vi.fn() }
  boundary.present.mockRejectedValue(new VideoEditRenderWorkerError('退出'))
  const instance = { frame: 7, document: { revision: 1 } } as VideoEditInstance
  const view = render(<VideoEditMulticamView instance={instance} onError={vi.fn()} />)
  await act(async () => {})
  await act(async () => { await vi.advanceTimersByTimeAsync(249) }); expect(boundary.created).toBe(1)
  await act(async () => { await vi.advanceTimersByTimeAsync(1) }); expect(boundary.created).toBe(2)
  await act(async () => { await vi.advanceTimersByTimeAsync(500) }); expect(boundary.created).toBe(3)
  expect(view.getByText('退出')).toBeTruthy()
  await act(async () => { await vi.advanceTimersByTimeAsync(5000) }); expect(boundary.created).toBe(3)
  boundary.present.mockResolvedValue({ bitmap })
  await act(async () => { fireEvent.click(view.getByRole('button', { name: /Retry|重试/ })) })
  expect(boundary.created).toBe(4); expect(boundary.present).toHaveBeenLastCalledWith(7)
  expect(view.queryByText('退出')).toBeNull(); expect(bitmap.close).toHaveBeenCalledOnce()
})
it('多机位故障跨过 30 秒窗口后重新取得两次恢复预算', async () => {
  const bitmap = { width: 320, height: 180, close: vi.fn() }
  boundary.present.mockRejectedValueOnce(new VideoEditRenderWorkerError('退出')).mockResolvedValue({ bitmap })
  const instance = { frame: 7, document: { revision: 1 } } as VideoEditInstance
  const view = render(<VideoEditMulticamView instance={instance} onError={vi.fn()} />)
  await act(async () => {})
  await act(async () => { await vi.advanceTimersByTimeAsync(250) }); expect(boundary.created).toBe(2)
  await act(async () => { await vi.advanceTimersByTimeAsync(30_000) })
  boundary.present.mockRejectedValue(new VideoEditRenderWorkerError('再次退出')); instance.frame++
  await act(async () => { await vi.advanceTimersByTimeAsync(100) }); expect(boundary.created).toBe(2)
  await act(async () => { await vi.advanceTimersByTimeAsync(250) }); expect(boundary.created).toBe(3)
  await act(async () => { await vi.advanceTimersByTimeAsync(500) }); expect(boundary.created).toBe(4)
  expect(view.getByText('再次退出')).toBeTruthy()
})
it('恢复期间重挂载等待同一个旧会话释放屏障，不重叠占用设备', async () => {
  let finish!: () => void
  boundary.dispose.mockImplementationOnce(() => new Promise<undefined>(resolve => { finish = () => resolve(undefined) }))
  boundary.present.mockRejectedValueOnce(new VideoEditRenderWorkerError('退出')).mockResolvedValue({ bitmap: { width: 320, height: 180, close: vi.fn() } })
  const instance = { frame: 7, document: { revision: 1 } } as VideoEditInstance
  const view = render(<VideoEditMulticamView instance={instance} onError={vi.fn()} />)
  await act(async () => {})
  expect(boundary.dispose).toHaveBeenCalledOnce()
  act(() => view.rerender(<VideoEditMulticamView instance={instance} onError={vi.fn()} />))
  await act(async () => {})
  expect(boundary.dispose).toHaveBeenCalledOnce(); expect(boundary.created).toBe(1)
  await act(async () => { finish() })
  expect(boundary.created).toBe(2)
})
