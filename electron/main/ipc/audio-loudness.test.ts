import { EventEmitter } from 'node:events'
import type { IpcMainInvokeEvent } from 'electron'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
type Handler = (raw: unknown, event: IpcMainInvokeEvent) => Promise<unknown>
const mock = vi.hoisted(() => ({ handler: undefined as Handler | undefined, trusted: vi.fn(), init: vi.fn(), close: vi.fn(), append: vi.fn(), measure: vi.fn(), activity: vi.fn() }))
vi.mock('electron', () => ({ app: { once() {} } }))
vi.mock('./application-control', () => ({ assertTrustedApplicationSender: mock.trusted }))
vi.mock('./registry', () => ({ registerIpcHandler: (_channel: string, parse: (raw: unknown) => unknown, handler: Handler, guard: (event: IpcMainInvokeEvent) => void) => { mock.handler = async (raw, event) => { guard(event); return handler(parse(raw), event) } } }))
vi.mock('../services/audio/loudness', () => ({ AudioLoudnessSession: class { initialize = mock.init; close = mock.close; append = mock.append; measure = mock.measure; detectActivity = mock.activity } }))
vi.mock('../services/logging', () => ({ createMainLogger: () => ({ info() {}, warn() {}, error() {} }) }))
import { registerAudioLoudnessHandlers } from './audio-loudness'
const senders: EventEmitter[] = []
function sender(id: number): IpcMainInvokeEvent { const emitter = Object.assign(new EventEmitter(), { id }); senders.push(emitter); return { sender: emitter } as unknown as IpcMainInvokeEvent }
beforeEach(() => { vi.resetAllMocks(); mock.init.mockResolvedValue(undefined); mock.close.mockResolvedValue(undefined); registerAudioLoudnessHandlers() })
afterEach(() => { for (const sender of senders.splice(0)) sender.emit('destroyed') })
it('会话只能由原窗口使用和关闭；重复 ID 拒绝，导航时清理声音', async () => {
  const a = sender(601); const b = sender(602); const invoke = mock.handler!
  await invoke({ action: 'start', sessionId: 'audio', sampleRate: 48000, channels: 2 }, a)
  await expect(invoke({ action: 'start', sessionId: 'audio', sampleRate: 48000, channels: 2 }, a)).rejects.toThrow('正在进行')
  await expect(invoke({ action: 'measure', sessionId: 'audio' }, b)).rejects.toThrow('关闭')
  await invoke({ action: 'close', sessionId: 'audio' }, b); expect(mock.close).not.toHaveBeenCalled()
  a.sender.emit('did-start-navigation', {}, '', false, true)
  expect(mock.close).toHaveBeenCalledOnce(); await expect(invoke({ action: 'measure', sessionId: 'audio' }, a)).rejects.toThrow('关闭')
})
it('严格参数、可信窗口和每窗口四会话上限', async () => {
  const event = sender(603); const invoke = mock.handler!
  await expect(invoke({ action: 'start', sessionId: 'audio', sampleRate: 96000, channels: 2 }, event)).rejects.toThrow()
  await expect(invoke({ action: 'read', sessionId: 'audio', startFrame: 0, frames: 96001 }, event)).rejects.toThrow()
  await expect(invoke({ action: 'append', sessionId: 'audio', channels: [[0]], path: '/untrusted' }, event)).rejects.toThrow()
  for (let index = 0; index < 4; index++) await invoke({ action: 'start', sessionId: `audio${index}`, sampleRate: 48000, channels: 2 }, event)
  await expect(invoke({ action: 'start', sessionId: 'fifth', sampleRate: 48000, channels: 2 }, event)).rejects.toThrow('正在进行')
  mock.trusted.mockImplementationOnce(() => { throw new Error('untrusted') }); await expect(invoke({ action: 'close', sessionId: 'audio0' }, event)).rejects.toThrow('untrusted')
})
it('开始失败释放 ID，可以重新开始', async () => {
  const event = sender(604); const invoke = mock.handler!
  mock.init.mockRejectedValueOnce(new Error('disk full'))
  const request = { action: 'start', sessionId: 'retry', sampleRate: 48000, channels: 2 }
  await expect(invoke(request, event)).rejects.toThrow('disk full'); expect(mock.close).toHaveBeenCalledOnce()
  await invoke(request, event)
})
it('活动检测仍归原窗口，敏感度严格验证并传到同一会话', async () => {
  const event = sender(605); const invoke = mock.handler!
  await invoke({ action: 'start', sessionId: 'vad', sampleRate: 48000, channels: 1 }, event)
  mock.activity.mockResolvedValue([{ startSeconds: 1, endSeconds: 2 }])
  await expect(invoke({ action: 'activity', sessionId: 'vad', sensitivity: 75 }, event)).resolves.toEqual([{ startSeconds: 1, endSeconds: 2 }])
  expect(mock.activity).toHaveBeenCalledWith(75)
  await expect(invoke({ action: 'activity', sessionId: 'vad', sensitivity: -1 }, event)).rejects.toThrow()
  await expect(invoke({ action: 'activity', sessionId: 'vad', sensitivity: 50 }, sender(606))).rejects.toThrow('关闭')
})
