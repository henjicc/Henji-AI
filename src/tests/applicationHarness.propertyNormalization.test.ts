// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createApplicationHarness } from './applicationHarness'
import { installHarnessNativeStorage, uninstallHarnessNativeStorage } from './harnessNativeStorage'
import { createVideoEditTestProject, closeAllVideoEdits } from '@/features/videoEdit/application/videoEditDocumentTestKit'
import { editVideoProject } from '@/features/videoEdit/application/videoEditService'
import { getApplicationControlExecutionEngine, getApplicationReflectionRegistry } from '@/features/application-control/capabilities/applicationControlRegistry'
import { VIDEO_EDIT_FIELDS } from '@/features/videoEdit/application/videoEditFields'
import { operationVerificationRecovery } from '../../electron/main/services/application-runtime/operationVerificationRecovery'
import { ApplicationOperationCoordinator } from '../../electron/main/services/application-runtime/operationCoordinator'
import type { ApplicationOperationStore, OperationRecord } from '../../electron/main/services/application-runtime/operationStore'
import type { ApplicationExecutionContext } from '@/core/application-control/execution/types'
import { HEX_COLOR_EXAMPLE } from '@/core/theme/colorTokens'
import { videoEditExportSettingsSchema, VIDEO_EDIT_EXPORT_PRESETS } from '@/core/videoEdit/exportPresets'
import { VIDEO_EDIT_MAX_SEQUENCE_FRAMES } from '@/core/videoEdit/time'

const access: ApplicationExecutionContext = { exposure: 'assistant', acceptedDataClasses: new Set(['C0', 'C1']), signal: new AbortController().signal, requestId: 'test' }
const disposers: Array<() => void> = []
beforeEach(() => { installHarnessNativeStorage(); })
afterEach(async () => { disposers.splice(0).forEach(dispose => dispose()); await closeAllVideoEdits(); vi.restoreAllMocks(); uninstallHarnessNativeStorage() })

it('A 部分样式经正式属性写入后 verified，旧误判只读核对结案且不重放', async () => {
  const owner = await createVideoEditTestProject()
  editVideoProject(owner.document.id, document => { document = structuredClone(document); document.sequences[0].captions = [{ id: 'caption', start: 0, duration: 50, text: '字幕' }]; return document })
  const app = createApplicationHarness(); disposers.push(app.dispose)
  const target = { kind: 'video_edit.caption', id: `${owner.document.id}:caption` }
  const style = { fontFamily: 'sans-serif', fontWeight: 400, fontStyle: 'normal', fontSize: 60, fill: { enabled: true, color: HEX_COLOR_EXAMPLE.toLowerCase() } }
  const result = await app.change(target, { 'video_edit.caption.style': style })
  expect(result.ok, JSON.stringify(result)).toBe(true)
  expect(result).toMatchObject({ data: { verification: { verified: true } } })
  const snapshot = await app.read(target, ['video_edit.caption.style'])
  expect(snapshot).toMatchObject({ properties: { 'video_edit.caption.style': { fontSize: 60, fill: { color: HEX_COLOR_EXAMPLE.toLowerCase() }, tracking: 0 } } })
  let stored: OperationRecord = { operationId: '2f8b0d4e-7a1c-4d30-a5fb-4e9b7d1a6cca', callerId: 'test', inputDigest: 'input', capabilityId: 'change_application_entities', state: 'partial', verificationState: 'unresolved', input: { changes: [{ kind: 'set_properties', entityType: target.kind, target, properties: { style } }] }, result: { ok: false, error: { details: { transaction: { code: 'VERIFICATION_FAILED', partial: { completedStepIndexes: [0], compensatedStepIndexes: [], uncompensatedStepIndexes: [0] } } } } } }
  const proof = operationVerificationRecovery(stored)!
  const verify = async (value: typeof proof) => ({ ok: true, data: { verification: await getApplicationControlExecutionEngine().verifyRecovery(value.conditions, value.evidence, access) } })
  const history = owner.past.length
  // 仅账本存储为内存替身；结案判断、恢复证明与领域回读都是正式实现。
  const store = { recoverInterrupted() {}, unresolved: () => ['partial', 'unknown'].includes(stored.state) ? [stored] : [], get: () => stored, save: (record: OperationRecord) => { stored = record } } as unknown as ApplicationOperationStore
  const coordinator = new ApplicationOperationCoordinator(store)
  await coordinator.reconcileVerification(stored, verify)
  expect(stored).toMatchObject({ state: 'completed', verificationState: 'verified' })
  expect(store.unresolved()).toEqual([])
  expect(owner.past).toHaveLength(history)
  const mismatched = { ...stored, state: 'partial' as const, verificationState: 'unresolved' as const, input: { changes: [{ kind: 'set_properties', entityType: target.kind, target, properties: { style: { ...style, fontSize: 61 } } }] } }
  stored = mismatched
  await coordinator.reconcileVerification(stored, verify)
  expect(stored.state).toBe('partial')
  expect((await getApplicationControlExecutionEngine().verifyRecovery([{ kind: 'property_equals', target, propertyId: 'video_edit.caption.style', expected: { ...style, fill: { enabled: true, color: HEX_COLOR_EXAMPLE } } }], [], access)).verified).toBe(true)
  const { codec: _codec, followSequence: _follow, ...partialExport } = VIDEO_EDIT_EXPORT_PRESETS[0].settings
  const registry = getApplicationReflectionRegistry()
  expect(registry.validatePropertyValueShape('video_edit.export_preset', 'video_edit.export_preset.settings', partialExport, access)).toEqual(videoEditExportSettingsSchema.parse(partialExport))
  expect(registry.validatePropertyValueShape('video_edit.caption', 'video_edit.caption.style', { ...style, fontFamily: '  sans-serif  ' }, access)).toMatchObject({ fontFamily: 'sans-serif' })
})

it('B 三类属性值错误只说字段、约束和收到的值', async () => {
  const owner = await createVideoEditTestProject()
  editVideoProject(owner.document.id, document => { document = structuredClone(document); document.sequences[0].captions = [{ id: 'caption', start: 0, duration: 50, text: '字幕' }]; return document })
  const app = createApplicationHarness(); disposers.push(app.dispose)
  const target = { kind: 'video_edit.caption', id: `${owner.document.id}:caption` }
  for (const [properties, expected] of [
    [{ start: -10 }, `开始帧（video_edit.caption.start）应在 0 到 ${VIDEO_EDIT_MAX_SEQUENCE_FRAMES} 帧 之间，收到 -10。`],
    [{ duration: 0 }, `时长（video_edit.caption.duration）应在 1 到 ${VIDEO_EDIT_MAX_SEQUENCE_FRAMES} 帧 之间，收到 0。`],
    [{ style: { fill: { color: 'red' } } }, `字幕样式（video_edit.caption.style）的 fill.color 应为 6 位十六进制颜色，例如 ${HEX_COLOR_EXAMPLE}，收到 "red"。`],
  ] as const) {
    const result = await app.change(target, Object.fromEntries(Object.entries(properties).map(([key, value]) => [`video_edit.caption.${key}`, value])))
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('应拒绝非法值')
    expect(result.error.message).toContain(expected)
    expect(result.error.message).not.toMatch(/请选择|Too small|需要.*object|。。/)
  }
})

it('C 剪辑属性标题均为中文，单位说明只跟随对应属性，对象默认值如实披露', async () => {
  const fields = Object.values(VIDEO_EDIT_FIELDS).flat().map(field => field.descriptor)
  expect(fields.filter(field => !/[\u3400-\u9fff]/.test(field.title)).map(field => field.id)).toEqual([])
  expect(fields.filter(field => field.description.includes('时间线使用整数帧')).every(field => field.unit === '帧')).toBe(true)
  for (const key of ['name', 'locked', 'muted', 'solo']) expect(fields.find(field => field.id === `video_edit.track.${key}`)?.description).not.toMatch(/整数帧|微秒|归一化/)
  expect(fields.find(field => field.id === 'video_edit.caption.source_text')).toMatchObject({ title: '原句', description: '生成字幕时保存的排版前原句，整理字幕合并时用于恢复标点；手动改正文不会自动同步原句。' })
  const registry = getApplicationReflectionRegistry()
  expect(registry.getProperty('video_edit.caption.style')?.description).toContain('未提供的字段使用默认值')
  expect(registry.getProperty('video_edit.export_preset.settings')?.description).toContain('未提供的字段')
  const app = createApplicationHarness(); disposers.push(app.dispose)
  const described = await app.requireResult('describe_application_entities', { entityTypes: ['video_edit.caption'], propertyIds: ['video_edit.caption.source_text', 'video_edit.caption.style'], detail: 'full' })
  expect(described).toMatchObject({ properties: expect.arrayContaining([expect.objectContaining({ title: '原句' })]) })
  const style = registry.getProperty('video_edit.caption.style')!
  if (style.value.kind !== 'json') throw new Error('样式应为对象属性')
  expect(JSON.stringify(registry.resolveSchema(style.value.schemaRef, access))).toContain('"x-value-format":"hex-color"')
  const recording = await app.requireResult('describe_application_entities', { domains: ['screen_recording'], detail: 'full' })
  const recordingProperties = recording.properties as Array<{ id: string; title: string }>
  expect(recordingProperties.length).toBeGreaterThan(0)
  expect(recordingProperties.filter(field => !/[\u3400-\u9fff]/.test(field.title)).map(field => field.id)).toEqual([])
  expect(recordingProperties.map(field => field.id)).toContain('screen_recording.export.details')
})
