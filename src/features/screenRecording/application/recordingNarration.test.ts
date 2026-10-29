// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { installPaidApprovalTestBridge } from '@/tests/paidApprovalTestKit'
import { assertGenerationPaidReceipt } from '../../../../electron/main/services/application-runtime/paidApprovalPolicy'
import { aiGenerate } from '@/commands/aiRuntime'
import { registry } from '@/core/ModelRegistry'
import { GenerationService } from '@/core/services/GenerationService'
import { configureGenerationSubmissionConfirmation } from '@/core/services/generationSubmissionConfirmation'
import { requestAlertConfirmation, useAlertDialogStore } from '@/stores/alertDialogStore'
import { withPaidOperation } from '@/services/paidApproval'
import type { GenerationPreparationInput } from '@/features/generation/application/generationPreparationService'
import { generateRecordingNarration } from './recordingNarration'

const ports = vi.hoisted(() => ({ applicationControl: { complete: vi.fn() }, audioEdit: { probeSource: vi.fn() } }))
const generation = vi.hoisted(() => ({ prepare: vi.fn(), submit: vi.fn(), wait: vi.fn(), read: vi.fn() }))
vi.mock('@/platform/runtime', () => ({ isDesktopRuntime: () => true, getPlatform: () => ports }))
vi.mock('@/features/documents/documentOperations', () => ({ getDocumentOperations: () => ({ findDocument: async () => ({ container: { kind: 'user' } }) }) }))
vi.mock('@/contexts/NotificationContext', () => ({ notifyUser: vi.fn() }))
vi.mock('@/features/generation', () => ({ generationApplicationService: generation, waitForGenerationCompletion: generation.wait, readGenerationResultMedia: generation.read }))
vi.mock('@/commands/aiRuntime', () => ({ aiGenerate: vi.fn(), aiCancelTask: vi.fn(), aiContinuePolling: vi.fn(), aiGetProgressEstimate: vi.fn(async () => null), aiRecordProgressSample: vi.fn() }))

const voice = { modelId: 'narration-fixture', options: {} }
let bridge: ReturnType<typeof installPaidApprovalTestBridge>
beforeEach(() => {
  vi.clearAllMocks()
  bridge = installPaidApprovalTestBridge({ singleLimitCny: 0 })
  useAlertDialogStore.setState({ queue: [] })
  configureGenerationSubmissionConfirmation(requestAlertConfirmation)
  registry.register({ meta: { id: voice.modelId, canonicalModelId: 'minimax-speech-2.8', provider: 'fixture', type: 'audio', name: { zh: '配音', en: 'Narration' } },
    params: [{ id: 'voice', type: 'composite', panel: 'voice-selector', default: {}, order: 1, name: { zh: '音色', en: 'Voice' } }], endpoints: '/fixture', pricing: { currency: '¥', fixed: .5 }, request: { builder: params => params } })
  const service = GenerationService.getInstance()
  vi.spyOn(service, 'getProgressEstimate').mockResolvedValue(null)
  generation.prepare.mockReturnValue({ priceEstimate: { comparableCnyAmount: .5 } })
  generation.submit.mockImplementation(async (input: GenerationPreparationInput, operationId: string) => {
    await service.generate(input.modelId, { prompt: input.prompt, ...input.options }, undefined, { requestId: operationId })
    return { taskId: operationId }
  })
  vi.mocked(aiGenerate).mockImplementation(async request => {
    assertGenerationPaidReceipt(bridge.store, request.paidReceipt, request)
    return { status: 'completed', urls: [], filePaths: [] }
  })
  generation.wait.mockResolvedValue({ ok: true })
  generation.read.mockResolvedValue({ source: '/fixture/narration.wav' })
  ports.audioEdit.probeSource.mockResolvedValue({ durationFrames: 48000, sampleRate: 48000 })
})
afterEach(() => { registry.unregister(voice.modelId); vi.restoreAllMocks(); useAlertDialogStore.setState({ queue: [] }) })

it('旁白把一次确认的收据交给 GenerationService，只记一次费用；恢复原任务不重复提交', async () => {
  const dispatched = vi.fn(async (_id: string) => undefined)
  const pending = generateRecordingNarration('旁白', voice, 'recording', { signal: new AbortController().signal }, { dispatched })
  await vi.waitFor(() => expect(useAlertDialogStore.getState().queue).toHaveLength(1))
  useAlertDialogStore.getState().confirmCurrent()
  const result = await pending
  expect(result).toMatchObject({ durationUs: 1e6, taskId: expect.any(String) })
  expect(dispatched).toHaveBeenCalledWith(result.taskId)
  expect(aiGenerate).toHaveBeenCalledOnce()
  expect(bridge.records.size).toBe(1)
  const record = [...bridge.records.values()][0]
  expect(record).toMatchObject({ state: 'completed', paidReservations: [{ generationRequest: { id: result.taskId } }] })
  expect(vi.mocked(aiGenerate).mock.calls[0][0].paidReceipt).toEqual({ operationId: record.operationId, callerId: record.callerId })
  expect(bridge.store.generationSpendSince(0)).toBe(.5)
  await generateRecordingNarration('旁白', voice, 'recording', { signal: new AbortController().signal }, { taskId: result.taskId, dispatched })
  expect(generation.wait).toHaveBeenLastCalledWith(result.taskId, expect.any(AbortSignal), true)
  expect(aiGenerate).toHaveBeenCalledOnce()
  expect(bridge.records.size).toBe(1)
  expect(useAlertDialogStore.getState().queue).toHaveLength(0)
})

it('一项录制任务的多句旁白共用总价收据，只允许清单中的生成且不能改变已提交输入', async () => {
  const ids = [crypto.randomUUID(), crypto.randomUUID()]
  const pending = withPaidOperation({ category: 'generation', estimatedCny: 1, generationTaskIds: ids }, async signal => {
    for (const [index, operationId] of ids.entries()) await generateRecordingNarration(`旁白${index}`, voice, 'recording', { signal }, { operationId, dispatched: async () => undefined })
  })
  await vi.waitFor(() => expect(useAlertDialogStore.getState().queue).toHaveLength(1))
  useAlertDialogStore.getState().confirmCurrent()
  await pending
  expect(aiGenerate).toHaveBeenCalledTimes(2)
  expect(bridge.records.size).toBe(1)
  expect(bridge.store.generationSpendSince(0)).toBe(1)
  expect(useAlertDialogStore.getState().queue).toHaveLength(0)
  const request = vi.mocked(aiGenerate).mock.calls[0][0]
  assertGenerationPaidReceipt(bridge.store, request.paidReceipt, request)
  expect(() => assertGenerationPaidReceipt(bridge.store, request.paidReceipt, { ...request, requestId: crypto.randomUUID() })).toThrow('PAID_CONFIRMATION_REQUIRED')
  expect(() => assertGenerationPaidReceipt(bridge.store, request.paidReceipt, { ...request, params: { prompt: '不同旁白' } })).toThrow('GENERATION_INPUT_CONFLICT')
})

it('停止等待排队旁白后仍移交原收据，不能另开付费请求', async () => {
  generation.submit.mockImplementation(async (_input: GenerationPreparationInput, operationId: string) => ({ taskId: operationId }))
  generation.wait.mockRejectedValue(new DOMException('停止等待', 'AbortError'))
  const pending = generateRecordingNarration('旁白', voice, 'recording', { signal: new AbortController().signal })
  const rejected = expect(pending).rejects.toThrow('停止等待')
  await vi.waitFor(() => expect(useAlertDialogStore.getState().queue).toHaveLength(1))
  useAlertDialogStore.getState().confirmCurrent()
  await rejected
  const confirm = vi.fn(async () => false)
  configureGenerationSubmissionConfirmation(confirm)
  const taskId = generation.submit.mock.calls[0][1] as string
  await expect(GenerationService.getInstance().generate(voice.modelId, { prompt: '旁白' }, undefined, { requestId: taskId })).resolves.toMatchObject({ status: 'completed' })
  expect(confirm).not.toHaveBeenCalled()
  expect(bridge.records.size).toBe(1)
  expect([...bridge.records.values()][0].state).toBe('completed')
  expect(bridge.store.generationSpendSince(0)).toBe(.5)
})
