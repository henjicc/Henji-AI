// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { installHarnessNativeStorage, uninstallHarnessNativeStorage } from '@/tests/harnessNativeStorage'
import { installPaidApprovalTestBridge } from '@/tests/paidApprovalTestKit'
import { createApplicationHarness } from '@/tests/applicationHarness'
import { getPlatform } from '@/platform'
import { createVideoEditTestProject, closeAllVideoEdits } from '@/features/videoEdit/application/videoEditDocumentTestKit'
import { useAlertDialogStore } from '@/stores/alertDialogStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { recordingDirectorPlanSchema } from '@/core/screenRecording/director'
import { planDirectorInputSchema } from '@/core/application-control/domains/screenRecording/directorCapability'
import { recordingOperationSchema } from '@/core/screenRecording/script'
import { planRecordingDirector, startRecordingDirector, cancelRecordingDirector, recordingDirectorBusy } from './recordingDirectorService'
import { readRecordingUnderstanding } from './recordingUnderstandingService'
import { replaySession } from './recordingReplayService'
import { generateRecordingNarration } from './recordingNarration'

vi.mock('./recordingNarration', async original => ({ ...await original<typeof import('./recordingNarration')>(), recordingNarrationCost: () => .01, generateRecordingNarration: vi.fn() }))
const input = () => planDirectorInputSchema.parse({ goal: '打开设置并切换主题', voice: { modelId: 'mock-tts', options: {} }, steps: [
  { title: '打开设置', narration: '先打开设置。', picture: '设置中的主题预设', operations: [{ target: { kind: 'settings.registry', id: 'singleton' }, properties: { 'interface.theme_preset': 'graphite' } }], settleMs: 100 },
  { title: '切换主题', narration: '选择纸白主题。', picture: '纸白主题已选中', operations: [{ target: { kind: 'settings.registry', id: 'singleton' }, properties: { 'interface.theme_preset': 'paper' } }], settleMs: 100 },
] })
beforeEach(() => { installHarnessNativeStorage(); installPaidApprovalTestBridge(); vi.clearAllMocks(); useAlertDialogStore.setState({ queue: [] }) })
afterEach(async () => { await closeAllVideoEdits(); vi.restoreAllMocks(); useAlertDialogStore.setState({ queue: [] }); uninstallHarnessNativeStorage() })
async function prepared() {
  const id = await planRecordingDirector(input(), { signal: new AbortController().signal }), app = createApplicationHarness()
  const read = await readRecordingUnderstanding(id)
  const changed = await app.change({ kind: 'screen_recording.understanding', id }, { 'screen_recording.understanding.result': { ...read.content.understanding, director: { ...read.content.understanding.director!, confirmed: true } } })
  expect(changed.ok).toBe(true)
  return { id, app }
}
it('正式规划入口保存可读脚本；结构限制、确认与再次编辑不能复用旧确认', async () => {
  const app = createApplicationHarness()
  try {
    const result = await app.requireResult('plan_screen_recording_director', input())
    const id = (result.resultRef as { id: string }).id, read = await readRecordingUnderstanding(id)
    expect(read.content.understanding.director).toMatchObject({ confirmed: false, narration: [{ text: '先打开设置。' }, { text: '选择纸白主题。' }] })
    expect(recordingDirectorPlanSchema.safeParse({ director: read.content.understanding.director, operationScript: read.content.understanding.operationScript }).success).toBe(true)
    const edited = structuredClone(read.content.understanding); edited.director!.narration[0].text = '改动'; edited.director!.confirmed = true
    expect((await app.change({ kind: 'screen_recording.understanding', id }, { 'screen_recording.understanding.result': edited })).ok).toBe(false)
    expect((await readRecordingUnderstanding(id)).content).toEqual(read.content)
    expect(recordingOperationSchema.safeParse({ target: { kind: 'settings.registry', id: 'singleton' }, properties: { 'security.allow_paid': true } }).success).toBe(false)
    await expect(startRecordingDirector(id, 'missing', { signal: new AbortController().signal })).rejects.toThrow('确认')
    expect(generateRecordingNarration).not.toHaveBeenCalled()
  } finally { app.dispose() }
})
it('复用重放执行设置操作，完成/失败/取消都恢复原主题', async () => {
  const { id, app } = await prepared()
  const original = useSettingsStore.getState().themeSelection
  try {
    const invokeCapability = (id: string, input: unknown) => app.requireResult(id, input as Record<string, unknown>)
    await replaySession(id, {}, { signal: new AbortController().signal, invokeCapability })
    expect(useSettingsStore.getState().themeSelection).toEqual(original)
    const controller = new AbortController()
    let calls = 0
    await expect(replaySession(id, {}, { signal: controller.signal, invokeCapability: async (name, value) => {
      const result = await invokeCapability(name, value)
      if (name === 'change_application_entities' && ++calls === 1) controller.abort()
      return result
    } })).rejects.toThrow()
    expect(calls).toBe(2); expect(useSettingsStore.getState().themeSelection).toEqual(original)
  } finally { app.dispose() }
})
it('询问费用拒绝与执行中取消均不提交配音、不开始采集；总估价覆盖全部新句', async () => {
  const { id, app } = await prepared(), owner = await createVideoEditTestProject()
  try {
    const bridge = installPaidApprovalTestBridge('ask')
    const pending = startRecordingDirector(id, owner.document.id, { signal: new AbortController().signal })
    const assertion = expect(pending).rejects.toThrow()
    await vi.waitFor(() => expect(useAlertDialogStore.getState().queue).toHaveLength(1))
    expect(recordingDirectorBusy(id)).toBe(true)
    expect(bridge.complete.mock.calls[0][0].uiPaidApproval).toMatchObject({ request: { estimatedCny: .02 } })
    cancelRecordingDirector(id)
    await assertion
    expect(generateRecordingNarration).not.toHaveBeenCalled()
    expect(recordingDirectorBusy(id)).toBe(false)
    expect([...bridge.records.values()]).toMatchObject([{ state: 'not_executed' }])
    expect((await readRecordingUnderstanding(id)).content.directorRun?.takes).toHaveLength(0)
  } finally { app.dispose() }
})

it('明确接受一次总费用后逐句生成；采集失败保留已完成配音，重试不重付', async () => {
  const { id, app } = await prepared(), owner = await createVideoEditTestProject()
  try {
    const bridge = installPaidApprovalTestBridge('ask')
    vi.mocked(generateRecordingNarration).mockImplementation(async text => ({ path: `/fixture/${text.length}.wav`, durationUs: 2e6 }))
    vi.spyOn(getPlatform().screenRecording, 'capture').mockRejectedValue(new Error('测试采集不可用'))
    const pending = startRecordingDirector(id, owner.document.id, { signal: new AbortController().signal })
    const assertion = expect(pending).rejects.toThrow('测试采集不可用')
    await vi.waitFor(() => expect(useAlertDialogStore.getState().queue).toHaveLength(1))
    expect(generateRecordingNarration).not.toHaveBeenCalled()
    useAlertDialogStore.getState().confirmCurrent()
    await assertion
    expect(generateRecordingNarration).toHaveBeenCalledTimes(2)
    expect((await readRecordingUnderstanding(id)).content.directorRun?.takes).toHaveLength(2)
    await expect(startRecordingDirector(id, owner.document.id, { signal: new AbortController().signal })).rejects.toThrow('测试采集不可用')
    expect(generateRecordingNarration).toHaveBeenCalledTimes(2)
    expect(bridge.records.size).toBe(1)
    expect(useAlertDialogStore.getState().queue).toHaveLength(0)
  } finally { app.dispose() }
})
