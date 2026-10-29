// @vitest-environment jsdom
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { getPlatform } from '@/platform'
import { DEFAULT_AUDIO_CAPTURE_SETTINGS, type AudioCaptureSettings } from '@/core/audioCapture/contracts'
import { installHarnessNativeStorage } from '@/tests/harnessNativeStorage'
import { applicationReflectionHandlers } from './capabilities/applicationReflectionAdapter'
import { createApplicationCallerGrant } from '@/core/application-control/callerContext'

let settings: AudioCaptureSettings = { ...DEFAULT_AUDIO_CAPTURE_SETTINGS }, revision = 0
const target = { kind: 'audio_capture.settings', id: 'singleton' }
const context = () => ({ requestId: crypto.randomUUID(), signal: new AbortController().signal, expectedRevisions: { audio_capture: revision } })
describe('原生录音通用属性', () => {
  beforeAll(() => {
    installHarnessNativeStorage()
    const api = getPlatform().audioCapture
    vi.spyOn(api, 'getSettings').mockImplementation(async () => ({ settings: { ...settings }, effectiveSettings: { ...settings }, notice: null, revision }))
    vi.spyOn(api, 'enumerate').mockResolvedValue({ hostApis: [], devices: [], defaultInputDevice: -1, asioCompiled: true })
    vi.spyOn(api, 'setSettings').mockImplementation(async (next, expected) => { if (expected !== revision) throw new Error('设置冲突'); settings = { ...next }; revision++; return { settings, effectiveSettings: settings, notice: null, revision } })
  })
  it('通过 describe 和通用 change 修改录音参数并从领域回读', async () => {
    const described = await applicationReflectionHandlers.describeEntities({ domains: ['audio_capture'], entityTypes: [], refs: [target] }, context())
    expect(described.propertyAvailability[0].properties).toContainEqual(expect.objectContaining({ propertyId: 'audio_capture.settings.sample_rate', writable: true }))
    await applicationReflectionHandlers.changeEntities({ summary: '录制高采样率音频', changes: [{ kind: 'set_properties', target, entityType: target.kind, properties: { 'audio_capture.settings.sample_rate': 96000, 'audio_capture.settings.channels': 2 } }] }, context())
    expect(settings.sampleRate).toBe(96000); expect(settings.channels).toBe(2)
    const read = await applicationReflectionHandlers.readEntity({ ref: target }, context())
    expect(read.properties['audio_capture.settings.sample_rate']).toBe(96000)
    expect(read.properties['audio_capture.settings.devices']).toMatchObject({ asioCompiled: true })
    expect(read.properties['audio_capture.settings.recording']).toEqual({ visible: false, phase: 'idle', durationSeconds: 0 })
    expect(described.propertyAvailability[0].properties).toContainEqual(expect.objectContaining({ propertyId: 'audio_capture.settings.recording', writable: false }))
  })
  it('非法位深不写入，录音参数事务可撤销', async () => {
    const before = { ...settings }
    await expect(applicationReflectionHandlers.changeEntities({ summary: '无效格式', changes: [{ kind: 'set_properties', target, entityType: target.kind, properties: { 'audio_capture.settings.bit_depth': 20 } }] }, context())).rejects.toThrow()
    expect(settings).toEqual(before)
    const changes = [{ kind: 'set_properties' as const, target, entityType: target.kind, properties: { 'audio_capture.settings.bit_depth': 16 } }]
    const result = await applicationReflectionHandlers.changeEntities({ summary: '修改录音位深', changes }, context())
    expect(settings.bitDepth).toBe(16)
    await applicationReflectionHandlers.undoEntities({ undoRef: result.undoRef! }, context())
    expect(settings).toEqual(before)

    const writer = createApplicationCallerGrant({ callerId: 'capture-writer' })
    await expect(applicationReflectionHandlers.changeEntities({ summary: '过期写入', changes }, { ...context(), callerGrant: writer, expectedRevisions: { audio_capture: 0 } })).rejects.toThrow()
    expect(settings).toEqual(before)
  })
})
