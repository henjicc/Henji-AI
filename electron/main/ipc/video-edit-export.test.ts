import { EventEmitter } from 'node:events'
import type { IpcMainInvokeEvent } from 'electron'
import { beforeEach, expect, it, vi } from 'vitest'
import { VIDEO_EDIT_EXPORT_CHANNELS } from '../../../src/platform/contracts/videoEditExport'
import { videoEditExportQualityEncoding } from '../../../src/core/videoEdit/exportEncoding'

const state = vi.hoisted(() => ({
  handlers: new Map<string, (payload: unknown, event: IpcMainInvokeEvent) => Promise<unknown>>(),
  release: vi.fn(async (_match: (owner: string) => boolean): Promise<void> => undefined),
  leave: vi.fn(async () => undefined),
  restore: vi.fn(async () => []),
  register: vi.fn(),
  ownsOutput: vi.fn(() => true),
  prepare: vi.fn(async () => ({ id: 'session', intermediatePath: 'intermediate.mp4' })),
  finish: vi.fn(async () => undefined),
  cancel: vi.fn(async () => undefined),
}))
vi.mock('./registry', () => ({ registerIpcHandler: (channel: string, parse: (value: unknown) => unknown, handle: (value: unknown, event: IpcMainInvokeEvent) => unknown) => {
  state.handlers.set(channel, async (payload, event) => handle(parse(payload), event))
} }))
vi.mock('./application-control', () => ({ assertTrustedApplicationSender: vi.fn() }))
vi.mock('../services/video-edit-export/registry', () => ({ videoEditExportJobRegistry: { leave: state.leave, restore: state.restore, register: state.register, ownsOutput: state.ownsOutput } }))
vi.mock('../services/video-edit-export/compression', () => ({ videoEditExportCompression: { release: state.release, prepare: state.prepare, finish: state.finish, cancel: state.cancel } }))
vi.mock('../services/video-edit-export/capabilities', () => ({ videoEditExportCapabilities: vi.fn() }))
import { registerVideoEditExportIpc } from './video-edit-export'

beforeEach(() => { vi.clearAllMocks(); state.handlers.clear(); registerVideoEditExportIpc() })
for (const reason of ['render-process-gone', 'destroyed']) it(`真实 IPC 的 ${reason} 先终止压制，再清理登记；导航不触发离开`, async () => {
  const sender = Object.assign(new EventEmitter(), { id: 42 })
  const event = { sender } as unknown as IpcMainInvokeEvent
  await state.handlers.get(VIDEO_EDIT_EXPORT_CHANNELS.register)!({ pageId: 'page-before', snapshots: [], jobs: [{ id: 'job', projectId: 'p', name: '', presetName: '', outputPaths: [process.cwd()], restorable: false }] }, event)
  for (const name of ['will-navigate', 'did-start-navigation', 'did-fail-load']) sender.emit(name)
  expect(state.release).not.toHaveBeenCalled()
  let finish!: () => void
  state.release.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve }))
  sender.emit(reason)
  await vi.waitFor(() => expect(state.release).toHaveBeenCalledOnce())
  expect(state.release.mock.calls[0][0]('42:page-before')).toBe(true)
  expect(state.release.mock.calls[0][0]('43:page-before')).toBe(false)
  expect(state.leave).not.toHaveBeenCalled()
  const restore = state.handlers.get(VIDEO_EDIT_EXPORT_CHANNELS.restore)!({ pageId: 'page-after' }, event)
  expect(state.restore).not.toHaveBeenCalled()
  finish(); await restore
  expect(state.leave).toHaveBeenCalledWith(42, reason === 'destroyed' ? 'destroyed' : 'render_process_gone')
  expect(state.restore).toHaveBeenCalledWith({ senderId: 42, pageId: 'page-after' })
})
it('崩溃清理期间的新登记、准备与压制均等待屏障，晚完成的旧准备被取消', async () => {
  const sender = Object.assign(new EventEmitter(), { id: 44, isDestroyed: () => false })
  const event = { sender } as unknown as IpcMainInvokeEvent
  const registration = (pageId: string): object => ({ pageId, snapshots: [], jobs: [{ id: 'job', projectId: 'p', name: '', presetName: '', outputPaths: [process.cwd()], restorable: false }] })
  const invoke = (channel: string, payload: unknown): Promise<unknown> => state.handlers.get(channel)!(payload, event)
  await invoke(VIDEO_EDIT_EXPORT_CHANNELS.register, registration('page-before'))
  let prepared!: (value: { id: string; intermediatePath: string }) => void
  state.prepare.mockImplementationOnce(() => new Promise(resolve => { prepared = resolve }))
  const old = invoke(VIDEO_EDIT_EXPORT_CHANNELS.prepareCompression, { pageId: 'page-before', jobId: 'job', path: process.cwd() })
  const rejected = expect(old).rejects.toThrow('页面已关闭')
  await vi.waitFor(() => expect(state.prepare).toHaveBeenCalledOnce())
  let cleaned!: () => void
  state.release.mockImplementationOnce(() => new Promise<void>(resolve => { cleaned = resolve }))
  sender.emit('render-process-gone')
  const register = invoke(VIDEO_EDIT_EXPORT_CHANNELS.register, registration('page-after'))
  const prepare = invoke(VIDEO_EDIT_EXPORT_CHANNELS.prepareCompression, { pageId: 'page-after', jobId: 'job', path: process.cwd() })
  const compress = invoke(VIDEO_EDIT_EXPORT_CHANNELS.compress, { pageId: 'page-after', id: 'new-session', encoding: videoEditExportQualityEncoding('avc', 'high'), fps: 30, durationSeconds: 1 })
  await new Promise<void>(resolve => setImmediate(resolve))
  expect(state.register).toHaveBeenCalledOnce()
  expect(state.prepare).toHaveBeenCalledOnce()
  expect(state.finish).not.toHaveBeenCalled()
  prepared({ id: 'old-session', intermediatePath: 'old.mp4' }); await rejected
  expect(state.cancel).toHaveBeenCalledWith('44:page-before', 'old-session')
  cleaned(); await Promise.all([register, prepare, compress])
  expect(state.leave).toHaveBeenCalledOnce()
  expect(state.prepare).toHaveBeenLastCalledWith('44:page-after', 'job', process.cwd(), 0)
  expect(state.finish).toHaveBeenCalledWith('44:page-after', 'new-session', expect.any(Object), 30, 1, expect.any(Function), 50)
})
