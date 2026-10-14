import { beforeEach, expect, it, vi } from 'vitest'
import type { IpcMainInvokeEvent } from 'electron'
import { screenRecordingRequestSchema, type ScreenRecordingRequest } from '../../../src/core/screenRecording/contracts'
import { registerScreenRecordingIpc } from './screen-recording'

const hooks = vi.hoisted(() => ({ handler: undefined as ((request: ScreenRecordingRequest, event: IpcMainInvokeEvent) => Promise<unknown>) | undefined, guard: undefined as ((event: IpcMainInvokeEvent) => void) | undefined, trusted: vi.fn(), sender: vi.fn(), snapshot: vi.fn(), command: vi.fn(), access: vi.fn(), grant: vi.fn(), revoke: vi.fn(), capture: vi.fn() }))
vi.mock('./registry', () => ({ registerIpcHandler: (_channel: string, _parse: unknown, handler: typeof hooks.handler, guard: typeof hooks.guard) => { hooks.handler = handler; hooks.guard = guard } }))
vi.mock('./application-control', () => ({ assertTrustedApplicationSender: hooks.trusted }))
vi.mock('../security/main-renderer-url', () => ({ isTrustedMainRendererUrl: (url: string) => url === 'app://henji' }))
vi.mock('../services/media-permissions', () => ({ mediaPermissions: { requestAccess: hooks.access, grant: hooks.grant, revoke: hooks.revoke } }))
const tracks = vi.hoisted(() => ({ update: vi.fn() }))
vi.mock('../services/screen-recording/runtime', () => ({ isRecordingControlSender: hooks.sender, recordingControl: { snapshot: hooks.snapshot, command: hooks.command }, recordRecordingCapability: hooks.capture, updateRecordingTracks: tracks.update }))
vi.mock('../services/logging', () => ({ createMainLogger: () => ({ warn: vi.fn() }) }))
beforeEach(() => { vi.resetAllMocks(); registerScreenRecordingIpc() })
it('轨道状态封闭校验，拒绝远程预览、超长预览、越界电平与伪造额外时钟', () => {
  const valid = { action: 'track-status', sessionId: '00000000-0000-4000-8000-000000000000', status: { microphoneLevel: .5, cameraPreview: 'data:image/jpeg;base64,YWJj', warnings: [] } }
  expect(screenRecordingRequestSchema.safeParse(valid).success).toBe(true)
  for (const status of [{ ...valid.status, cameraPreview: 'https://other/image.jpg' }, { ...valid.status, cameraPreview: 'data:image/jpeg;base64,' + 'A'.repeat(100_000) }, { ...valid.status, microphoneLevel: 2 }, { ...valid.status, originUs: 10 }]) expect(screenRecordingRequestSchema.safeParse({ ...valid, status }).success).toBe(false)
})
it('共享时钟返回真实单调微秒；轨道状态交权威宿主核对，不另建通道', async () => {
  const before = Number(process.hrtime.bigint() / 1000n)
  const at = await hooks.handler!({ action: 'clock' }, event())
  expect(at).toBeGreaterThanOrEqual(before)
  expect(at).toBeLessThanOrEqual(Number(process.hrtime.bigint() / 1000n))
  const status = { microphoneLevel: .5, cameraPreview: null, warnings: [] }
  const sender = event()
  await hooks.handler!({ action: 'track-status', sessionId: 'live', status }, sender)
  expect(tracks.update).toHaveBeenCalledWith(sender.sender, 'live', status)
})
function event(url = 'app://henji', main = true): IpcMainInvokeEvent {
  const frame = { url }
  return { senderFrame: frame, sender: { mainFrame: main ? frame : { url }, id: 10 } } as unknown as IpcMainInvokeEvent
}
it('唯一桥拒绝外部来源/子frame，辅助控制窗只能控制归属会话，过期会话不执行', async () => {
  expect(() => hooks.guard!(event('https://other'))).toThrow('来源不可信')
  expect(() => hooks.guard!(event('app://henji', false))).toThrow('来源不可信')
  hooks.sender.mockReturnValue(true); hooks.snapshot.mockReturnValue({ sessionId: 'live' })
  await expect(hooks.handler!({ action: 'control', sessionId: 'old', command: 'stop' }, event())).rejects.toThrow('会话已改变')
  expect(hooks.command).not.toHaveBeenCalled()
  await hooks.handler!({ action: 'control', sessionId: 'live', command: 'stop' }, event())
  expect(hooks.command).toHaveBeenCalledWith('stop')
  hooks.trusted.mockImplementation(() => { throw new Error('不是主窗口') })
  await expect(hooks.handler!({ action: 'grant', sessionId: 'live', userReceipt: 'receipt', kinds: ['camera'] }, event())).rejects.toThrow('不是主窗口')
  expect(hooks.grant).not.toHaveBeenCalled()
})
it('OS授权等待后重新核对宿主；导航后的迟到授权不能落地', async () => {
  let finish!: () => void
  hooks.access.mockImplementation(() => new Promise<void>(resolve => { finish = resolve }))
  const pending = hooks.handler!({ action: 'grant', sessionId: 'live', userReceipt: 'receipt', kinds: ['microphone'] }, event())
  hooks.trusted.mockImplementation(() => { throw new Error('宿主已改变') }); finish()
  await expect(pending).rejects.toThrow('宿主已改变')
  expect(hooks.grant).not.toHaveBeenCalled()
})
it('能力事实复用原请求通道且只能由可信主宿主提交；备注经统一控制层处理', async () => {
  const source = event()
  const fact = { callId: 'call', capability: 'read_application_entity', targets: [], phase: 'started' as const }
  await hooks.handler!({ action: 'capability', sessionId: 'live', fact }, source)
  expect(hooks.capture).toHaveBeenCalledWith(source.sender, 'live', fact)
  hooks.snapshot.mockReturnValue({ sessionId: 'live' })
  await hooks.handler!({ action: 'control', sessionId: 'live', command: 'mark', note: '重点' }, source)
  expect(hooks.command).toHaveBeenCalledWith('mark', '重点')
  hooks.trusted.mockImplementation(() => { throw new Error('不是主窗口') })
  await expect(hooks.handler!({ action: 'capability', sessionId: 'live', fact }, source)).rejects.toThrow('不是主窗口')
  expect(hooks.capture).toHaveBeenCalledTimes(1)
})
