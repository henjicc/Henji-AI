// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { llmChatStream, llmCancelTask } from '@/commands/llmRuntime'
import { llmConfigService } from '@/services/llm/LlmConfigService'
import { DEFAULT_LLM_CAPABILITIES } from '@/core/llm/defaults'
import { APP_ACCENT_HEX } from '@/core/theme/colorTokens'
import { installHarnessNativeStorage, uninstallHarnessNativeStorage } from '@/tests/harnessNativeStorage'
import { createApplicationHarness } from '@/tests/applicationHarness'
import { createVideoEditProject, editVideoSequence, undoVideoEdit, type VideoEditInstance } from './videoEditService'
import { closeAllVideoEdits } from './videoEditDocumentTestKit'
import { generateTitleFromDescription, confirmTitleFromDescription } from './videoEditTitleDescription'
import { useAlertDialogStore } from '@/stores/alertDialogStore'

vi.mock('@/commands/llmRuntime', async original => ({ ...await original<typeof import('@/commands/llmRuntime')>(), llmChatStream: vi.fn(), llmCancelTask: vi.fn(async () => undefined) }))
const trace = { providerId: 'fixture', modelId: 'text', startedAtMs: 0, elapsedMs: 1, inputChars: 8, outputChars: 10 }
let owner: VideoEditInstance
const result = { kind: 'lower_third', parameters: { text: '张三', subtitle: '导演', color: APP_ACCENT_HEX, durationSeconds: 6, entrance: 'left' } }
beforeEach(async () => {
  installHarnessNativeStorage(); vi.clearAllMocks(); useAlertDialogStore.setState({ queue: [] })
  vi.stubGlobal('OffscreenCanvas', class { getContext() { return { font: '', measureText(text: string) { return { width: text.length * 20, actualBoundingBoxLeft: 0, actualBoundingBoxRight: text.length * 20 } } } } })
  vi.spyOn(llmConfigService, 'getConfig').mockResolvedValue({ providers: [{ providerId: 'fixture', displayName: 'Fixture', adapter: 'openai', enabled: true }], models: [{ providerId: 'fixture', modelId: 'text', displayName: 'Text', adapter: 'openai', enabled: true, capabilities: DEFAULT_LLM_CAPABILITIES }], promptProfiles: [], textProcessingPromptTemplates: [], agentProfiles: [], tools: [], policy: { allowedTools: [], requireHumanConfirmation: false }, memory: {} })
  vi.mocked(llmChatStream).mockImplementation(async (_request, emit) => { emit({ type: 'Token', data: JSON.stringify(result) }); emit({ type: 'Done', data: trace }) })
  owner = await createVideoEditProject()
})
afterEach(async () => { useAlertDialogStore.setState({ queue: [] }); await closeAllVideoEdits(); vi.restoreAllMocks(); vi.unstubAllGlobals(); uninstallHarnessNativeStorage() })
it('描述使用现有文本入口并生成可编辑实例，一步撤销；公共助手入口保存核实', async () => {
  const id = owner.document.id; const sequenceId = owner.activeSequenceId; const history = owner.past.length
  const generated = await generateTitleFromDescription(id, sequenceId, { description: '科技感蓝色人名条，左侧滑入', placement: { frame: 30 } })
  expect(generated.clipIds).toHaveLength(1); expect(owner.document.sequences[0].clips[0]).toMatchObject({ start: 30, duration: 180, kind: 'graphic' }); expect(owner.past).toHaveLength(history + 1)
  expect(llmChatStream).toHaveBeenCalledWith(expect.objectContaining({ providerId: 'fixture', metadata: { source: 'video-edit-title-description' } }), expect.any(Function))
  undoVideoEdit(id); expect(owner.document.sequences[0].clips).toHaveLength(0)
  const app = createApplicationHarness(); try { const output = await app.requireResult('generate_video_edit_title_from_description', { documentRef: { kind: 'video_edit.document', id }, sequenceRef: { kind: 'video_edit.sequence', id: `${id}:${sequenceId}` }, frame: 60, description: '蓝色人名条' }); expect(output.verified).toBe(true) } finally { app.dispose() }
})
it('手动确认取消不发请求，审批等待期间取消结束确认', async () => {
  const pending = confirmTitleFromDescription(owner.document.id, owner.activeSequenceId, { description: '标题' })
  expect(useAlertDialogStore.getState().queue).toHaveLength(1); useAlertDialogStore.getState().dismissCurrent(); await pending
  expect(llmChatStream).not.toHaveBeenCalled()
})
it('错误/未完成/越界参数不落位；迟到结果不得覆盖用户后续修改', async () => {
  const input = { description: '标题' }; const id = owner.document.id; const sequenceId = owner.activeSequenceId
  vi.mocked(llmChatStream).mockImplementationOnce(async (_request, emit) => { emit({ type: 'Token', data: JSON.stringify({ ...result, parameters: { durationSeconds: 999 } }) }); emit({ type: 'Done', data: trace }) })
  await expect(generateTitleFromDescription(id, sequenceId, input)).rejects.toThrow('有效'); expect(owner.document.sequences[0].clips).toHaveLength(0)
  vi.mocked(llmChatStream).mockImplementationOnce(async (_request, emit) => { emit({ type: 'Token', data: '{}' }) })
  await expect(generateTitleFromDescription(id, sequenceId, input)).rejects.toThrow('完整')
  vi.mocked(llmChatStream).mockImplementationOnce(async (_request, emit) => { editVideoSequence(id, sequenceId, sequence => ({ ...sequence, name: '后续修改' })); emit({ type: 'Token', data: JSON.stringify(result) }); emit({ type: 'Done', data: trace }) })
  await expect(generateTitleFromDescription(id, sequenceId, input)).rejects.toThrow('已有修改'); expect(owner.document.sequences[0].name).toBe('后续修改')
})
it('取消请求经现有取消入口，不留下片段', async () => {
  const abort = new AbortController()
  vi.mocked(llmChatStream).mockImplementationOnce(async (_request, emit) => { abort.abort(); emit({ type: 'Token', data: JSON.stringify(result) }); emit({ type: 'Done', data: trace }) })
  await expect(generateTitleFromDescription(owner.document.id, owner.activeSequenceId, { description: '标题' }, abort.signal)).rejects.toThrow()
  expect(llmCancelTask).toHaveBeenCalledTimes(1); expect(owner.document.sequences[0].clips).toHaveLength(0)
})
