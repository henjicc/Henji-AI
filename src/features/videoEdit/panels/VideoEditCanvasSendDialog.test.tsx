// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { CanvasPersistenceError } from '@/features/canvas/application/canvasPersistenceService'
import { VideoEditCanvasSendDialog } from './VideoEditCanvasSendDialog'

const boundary = vi.hoisted(() => ({ list: vi.fn(), send: vi.fn(), save: vi.fn(), notify: vi.fn(), document: { revision: 0 } }))
vi.mock('@/features/documents/documentOperations', () => ({ getDocumentOperations: () => ({ listDocuments: boundary.list }) }))
vi.mock('@/services/workspaceTransfer', () => ({ sendVideoEditToCanvas: boundary.send }))
vi.mock('../application/videoEditService', () => ({ requireVideoEditInstance: () => ({ document: boundary.document }), subscribeVideoEditDomain: () => () => undefined }))
vi.mock('@/contexts/NotificationContext', () => ({ useNotification: () => ({ showNotification: boundary.notify }) }))
vi.mock('@/features/canvas/application/canvasPersistenceService', async importOriginal => ({ ...await importOriginal<Record<string, unknown>>(), confirmCanvasPersistence: boundary.save }))
beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  boundary.list.mockResolvedValue([{ id: 'canvas', name: '目标画布' }]); boundary.save.mockResolvedValue(undefined)
})
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.unstubAllGlobals() })

it('当前帧和来源序列固定在打开时；画布保存失败后只重试保存，不重复发送/出帧', async () => {
  boundary.send.mockRejectedValueOnce(new CanvasPersistenceError('canvas', new Error('磁盘只读')))
  const close = vi.fn()
  const view = render(<VideoEditCanvasSendDialog request={{ projectId: 'video', sequenceId: 'sequence', source: { kind: 'frame', frame: 42 } }} onClose={close} />)
  await act(async () => {})
  await act(async () => { fireEvent.click(view.getByRole('button', { name: /^发送$/ })) })
  expect(boundary.send).toHaveBeenCalledWith({ projectId: 'video', sequenceId: 'sequence', source: { kind: 'frame', frame: 42 }, canvasId: 'canvas', placement: { mode: 'viewport_center' } }, expect.any(AbortSignal))
  expect(close).not.toHaveBeenCalled()
  await act(async () => { fireEvent.click(view.getByRole('button', { name: '重试保存画布' })) })
  expect(boundary.save).toHaveBeenCalledWith('canvas'); expect(boundary.send).toHaveBeenCalledTimes(1)
  expect(close).toHaveBeenCalledOnce()
})
