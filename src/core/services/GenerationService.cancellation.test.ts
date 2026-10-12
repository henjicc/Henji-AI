// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { registry } from '@/core/ModelRegistry'
import { aiCancelTask, aiContinuePolling, aiGenerate } from '@/commands/aiRuntime'
import { GenerationService } from './GenerationService'
import { voiceLibraryService } from '@/services/voiceLibrary/VoiceLibraryService'
import { useAlertDialogStore, showAlertDialog, requestAlertConfirmation } from '@/stores/alertDialogStore'
import { configureGenerationSubmissionConfirmation, transferGenerationPaidApproval } from './generationSubmissionConfirmation'
import { bindApplicationConfirmation, requestApplicationPaidApproval } from '../application-control/userConfirmation'
import { ttsPresentation } from '@/models/presentation/tts'
import { clearProviderAvailability, getProviderAvailabilityFailure } from './providerAvailability'

vi.mock('@/commands/aiRuntime', () => ({
  aiCancelTask: vi.fn(async () => undefined), aiGenerate: vi.fn(), aiContinuePolling: vi.fn(),
  aiGetProgressEstimate: vi.fn(async () => null), aiRecordProgressSample: vi.fn(async () => null),
}))
const paid = vi.hoisted(() => ({ prepare: vi.fn(), confirm: vi.fn(), start: vi.fn(), complete: vi.fn(), failed: vi.fn(), reject: vi.fn() }))
vi.mock('@/services/paidApproval', () => ({ prepareGenerationPaidApproval: paid.prepare }))
const service = GenerationService.getInstance()
beforeEach(() => {
  clearProviderAvailability('fixture')
  configureGenerationSubmissionConfirmation(requestAlertConfirmation)
  vi.clearAllMocks()
  paid.prepare.mockResolvedValue({ ...paid, project: undefined, decision: { decision: 'ask', reason: '每次询问', estimatedCny: 0.1, dailySpentCny: 0 } })
  useAlertDialogStore.setState({ queue: [] })
  vi.spyOn(service, 'getProgressEstimate').mockResolvedValue(null)
  registry.register({ meta: { id: 'cancel-fixture', canonicalModelId: 'nano-banana', provider: 'fixture', type: 'image', name: { zh: '测试', en: 'Test' } },
    params: [], endpoints: '/fixture', pricing: { currency: '$', fixed: 0.01 }, request: { builder: params => params } })
})
afterEach(() => { registry.unregister('cancel-fixture'); vi.restoreAllMocks(); useAlertDialogStore.setState({ queue: [] }) })

function enableConfirmation(): void {
  registry.getModel('cancel-fixture')!.submissionConfirmation = ttsPresentation['volcengine-seed-icl-2.0'].submissionConfirmation
}

it.each(['generate', 'poll'] as const)('%s 失败记住模型准入，手动重试仍派发且成功清除，界面文案不含内部码', async phase => {
  const dispatch = phase === 'generate' ? aiGenerate : aiContinuePolling
  vi.mocked(dispatch).mockRejectedValueOnce(new Error('[provider_product_not_activated] 测试供应商账号未开通该模型，请到控制台开通。'))
    .mockResolvedValueOnce({ status: 'completed', urls: ['C:/result.png'], filePaths: [], metadata: {} })
  const invoke = () => phase === 'generate' ? service.generate('cancel-fixture', { prompt: 'fixture' }) : service.continuePolling('cancel-fixture', 'fixture-task')
  const error = await invoke().catch((error: unknown) => error)
  expect(error).toMatchObject({ code: 'PROVIDER_PRODUCT_NOT_ACTIVATED', message: expect.stringContaining('测试供应商') })
  expect((error as Error).message).not.toContain('PROVIDER_')
  expect(getProviderAvailabilityFailure('fixture', 'cancel-fixture')).toMatchObject({ code: 'PROVIDER_PRODUCT_NOT_ACTIVATED' })
  expect(getProviderAvailabilityFailure('fixture', 'other-model')).toBeUndefined()
  await invoke()
  expect(dispatch).toHaveBeenCalledTimes(2)
  expect(getProviderAvailabilityFailure('fixture', 'cancel-fixture')).toBeUndefined()
})

it.each(['dialog', 'signal', 'task'] as const)('克隆等待 %s 取消时不上传或提交供应商请求，也不取消其他弹窗', async mode => {
  enableConfirmation()
  showAlertDialog({ title: '已有提示', message: '保留' })
  const controller = new AbortController()
  const run = service.generate('cancel-fixture', { volcIclMode: 'clone', prompt: '试听' }, undefined, { requestId: 'confirmation', signal: controller.signal })
  const assertion = expect(run).rejects.toMatchObject({ name: 'GenerationSubmissionCancelledError' })
  await vi.waitFor(() => expect(useAlertDialogStore.getState().queue).toHaveLength(2))
  expect(service.getProgressEstimate).not.toHaveBeenCalled()
  if (mode === 'dialog') useAlertDialogStore.getState().queue[1].confirmation!.resolve(false)
  if (mode === 'signal') controller.abort()
  if (mode === 'task') await service.cancelTask('confirmation')
  await assertion
  expect(aiGenerate).not.toHaveBeenCalled()
  expect(aiCancelTask).not.toHaveBeenCalled()
  expect(useAlertDialogStore.getState().queue.map(item => item.title)).toEqual(['已有提示'])
})

it('确认后只提交当时的参数，每次重试克隆都重新确认，语音合成不弹克隆确认', async () => {
  enableConfirmation()
  vi.mocked(aiGenerate).mockResolvedValue({ status: 'completed', urls: ['C:/result.mp3'], filePaths: [] })
  const params = { volcIclMode: 'clone', volcCloneAudio: ['original.wav'], prompt: '试听' }
  const run = service.generate('cancel-fixture', params)
  await vi.waitFor(() => expect(useAlertDialogStore.getState().queue).toHaveLength(1))
  params.volcCloneAudio[0] = 'changed.wav'
  expect(aiGenerate).not.toHaveBeenCalled()
  useAlertDialogStore.getState().confirmCurrent()
  await run
  expect(aiGenerate).toHaveBeenCalledTimes(1)
  expect(aiGenerate).toHaveBeenCalledWith(expect.objectContaining({ params: expect.objectContaining({ volcCloneAudio: ['original.wav'] }) }))
  const retry = service.generate('cancel-fixture', params)
  const rejected = expect(retry).rejects.toMatchObject({ name: 'GenerationSubmissionCancelledError' })
  await vi.waitFor(() => expect(useAlertDialogStore.getState().queue).toHaveLength(1))
  useAlertDialogStore.getState().dismissCurrent()
  await rejected
  await service.generate('cancel-fixture', { volcIclMode: 'speech' })
  expect(aiGenerate).toHaveBeenCalledTimes(2)
  expect(useAlertDialogStore.getState().queue).toHaveLength(0)
})

it('克隆采用统一 auto 策略，人工模式使用现有付费弹窗，记录实际提交阶段', async () => {
  enableConfirmation()
  paid.prepare.mockResolvedValueOnce({ ...paid, decision: { decision: 'auto', reason: '额度内', estimatedCny: 0.1, dailySpentCny: 0 } })
  vi.mocked(aiGenerate).mockResolvedValue({ status: 'completed', urls: [], filePaths: [] })
  await service.generate('cancel-fixture', { volcIclMode: 'clone', prompt: '试听' })
  expect(useAlertDialogStore.getState().queue).toHaveLength(0)
  expect(paid.start).toHaveBeenCalledOnce()
  expect(paid.complete).toHaveBeenCalledOnce()
})

it('外部操作已通过统一授权的异步克隆只消费原回执，不再单独确认或重复预留', async () => {
  enableConfirmation()
  const controller = new AbortController()
  const unbind = bindApplicationConfirmation(controller.signal, async () => ({ decision: 'auto', reason: '额度内', estimatedCny: 0.1, dailySpentCny: 0 }))
  await requestApplicationPaidApproval(controller.signal, { category: 'generation', estimatedCny: 0.1 })
  transferGenerationPaidApproval('approved-clone', controller.signal)
  unbind()
  vi.mocked(aiGenerate).mockResolvedValue({ status: 'completed', urls: [], filePaths: [] })
  await service.generate('cancel-fixture', { volcIclMode: 'clone' }, undefined, { requestId: 'approved-clone' })
  expect(paid.prepare).not.toHaveBeenCalled()
  expect(useAlertDialogStore.getState().queue).toHaveLength(0)
  expect(aiGenerate).toHaveBeenCalledOnce()
})

it('媒体准备期间取消不会提交供应商请求', async () => {
  let release!: () => void
  vi.mocked(service.getProgressEstimate).mockImplementationOnce(() => new Promise(resolve => { release = () => resolve(null) }))
  const controller = new AbortController()
  const run = service.generate('cancel-fixture', { prompt: 'test' }, undefined, { requestId: 'original-request', signal: controller.signal })
  const assertion = expect(run).rejects.toThrow('停止')
  await vi.waitFor(() => expect(service.getProgressEstimate).toHaveBeenCalled())
  controller.abort(new Error('停止'))
  release()
  await assertion
  expect(aiGenerate).not.toHaveBeenCalled()
  expect(aiCancelTask).not.toHaveBeenCalled()
})

it.each(['generate', 'poll'] as const)('%s 只取消实际运行标识，不把信号发送到 IPC', async phase => {
  let release!: () => void
  const response = { status: 'completed' as const, urls: ['C:/result.png'], filePaths: [], metadata: {} }
  const pending = new Promise<typeof response>(resolve => { release = () => resolve(response) })
  vi.mocked(aiGenerate).mockReturnValue(pending)
  vi.mocked(aiContinuePolling).mockReturnValue(pending)
  const controller = new AbortController()
  const run = phase === 'generate'
    ? service.generate('cancel-fixture', { prompt: 'test' }, undefined, { requestId: 'original-request', signal: controller.signal })
    : service.continuePolling('cancel-fixture', 'provider-task', {}, undefined, { requestId: 'original-request', signal: controller.signal })
  const dispatch = phase === 'generate' ? aiGenerate : aiContinuePolling
  await vi.waitFor(() => expect(dispatch).toHaveBeenCalledTimes(1))
  const cancelled = expect(run).rejects.toMatchObject({ name: 'AbortError' })
  controller.abort()
  await cancelled
  await vi.waitFor(() => expect(aiCancelTask).toHaveBeenCalledWith(phase === 'generate' ? 'original-request' : 'provider-task'))
  release()
  expect(aiCancelTask).toHaveBeenCalledTimes(1)
  expect(vi.mocked(dispatch).mock.calls[0][0]).not.toHaveProperty('signal')
})

it('正常结束后信号不再取消已完成请求', async () => {
  vi.mocked(aiGenerate).mockResolvedValue({ status: 'completed', urls: ['C:/result.png'], filePaths: [], metadata: {} })
  const controller = new AbortController()
  await service.generate('cancel-fixture', { prompt: 'test' }, undefined, { requestId: 'completed', signal: controller.signal })
  controller.abort()
  expect(aiCancelTask).not.toHaveBeenCalled()
})

it('仅将供应商确认的训练失败写回音色库，网络错误仍可重试', async () => {
  const save = vi.spyOn(voiceLibraryService, 'markTaskFailed').mockResolvedValue(undefined)
  vi.mocked(aiContinuePolling).mockRejectedValueOnce(new Error('[voice_training_failed] 训练失败'))
  await expect(service.continuePolling('cancel-fixture', 'voice-task')).rejects.toThrow('训练失败')
  expect(save).toHaveBeenCalledWith('voice-task')
  save.mockClear()
  vi.mocked(aiContinuePolling).mockRejectedValueOnce(new Error('网络暂不可用'))
  await expect(service.continuePolling('cancel-fixture', 'voice-task')).rejects.toThrow('网络暂不可用')
  expect(save).not.toHaveBeenCalled()
})

it('生成失败抛出的错误文案就是失败原因，不带英文前缀与模型 ID（任务 5.8，克隆面板与画布节点直接展示它）', async () => {
  vi.mocked(aiGenerate).mockRejectedValueOnce(new Error('供应商返回音频时长不足 10 秒'))
  await expect(service.generate('cancel-fixture', {})).rejects.toMatchObject({
    name: 'GenerationFailedError',
    message: '供应商返回音频时长不足 10 秒',
    modelId: 'cancel-fixture',
  })
})
