import { beforeEach, expect, it, vi } from 'vitest'
import type { RecordingControlSnapshot } from '@/core/screenRecording/contracts'
import type { ApplicationCapabilityDefinition } from '@/core/application-control/applicationCapabilities'
const hooks = vi.hoisted(() => ({ desktop: vi.fn(), snapshot: vi.fn(), record: vi.fn(), changed: undefined as ((snapshot: RecordingControlSnapshot | null) => void) | undefined }))
vi.mock('@/platform', () => ({ isDesktopRuntime: hooks.desktop, getPlatform: () => ({ screenRecording: { snapshot: hooks.snapshot, recordCapability: hooks.record, onChanged: (listener: typeof hooks.changed) => { hooks.changed = listener; return () => {} } } }) }))
vi.mock('@/core/logging', () => ({ createLogger: () => ({ warn: vi.fn() }) }))
beforeEach(() => { vi.resetModules(); vi.resetAllMocks(); hooks.desktop.mockReturnValue(true); hooks.record.mockResolvedValue(undefined); hooks.snapshot.mockResolvedValue({ sessionId: 'old', phase: 'recording' }) })
const definition = { id: 'read_application_entity' } as ApplicationCapabilityDefinition
it('能力调用只保留稳定引用，结果不进入日志，迟到完成仍绑定原会话', async () => {
  const { beginCapabilityCapture } = await import('./recordingCapture')
  const complete = await beginCapabilityCapture(definition, { ref: { kind: 'settings.registry', id: 'singleton', label: 'password' }, password: 'secret' })
  hooks.changed!({ phase: 'recording', sessionId: 'new' } as RecordingControlSnapshot)
  await complete('completed')
  expect(hooks.record.mock.calls).toHaveLength(2)
  expect(hooks.record.mock.calls[0][1]).toMatchObject({ capability: definition.id, targets: [{ kind: 'settings.registry', id: 'singleton' }], phase: 'started' })
  expect(hooks.record.mock.calls[0][1].callId).toBe(hooks.record.mock.calls[1][1].callId)
  expect(hooks.record.mock.calls[1][0]).toBe('old')
  expect(JSON.stringify(hooks.record.mock.calls)).not.toContain('password'); expect(JSON.stringify(hooks.record.mock.calls)).not.toContain('secret')
})
it('不录制/暂停时没有能力事实，能力记录连接失败不改变业务执行', async () => {
  hooks.snapshot.mockResolvedValue(null)
  const { beginCapabilityCapture } = await import('./recordingCapture')
  await (await beginCapabilityCapture(definition, {}))('completed'); expect(hooks.record).not.toHaveBeenCalled()
  hooks.changed!({ phase: 'paused', sessionId: 'paused' } as RecordingControlSnapshot)
  await (await beginCapabilityCapture(definition, {}))('failed'); expect(hooks.record).not.toHaveBeenCalled()
})
