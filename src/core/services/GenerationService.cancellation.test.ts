// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { registry } from '@/core/ModelRegistry'
import { aiCancelTask, aiContinuePolling, aiGenerate } from '@/commands/aiRuntime'
import { GenerationService } from './GenerationService'
import { voiceLibraryService } from '@/services/voiceLibrary/VoiceLibraryService'
import { useAlertDialogStore, showAlertDialog, requestAlertConfirmation } from '@/stores/alertDialogStore'
import { configureGenerationSubmissionConfirmation } from './generationSubmissionConfirmation'
import { ttsPresentation } from '@/models/presentation/tts'

vi.mock('@/commands/aiRuntime', () => ({
  aiCancelTask: vi.fn(async () => undefined), aiGenerate: vi.fn(), aiContinuePolling: vi.fn(),
  aiGetProgressEstimate: vi.fn(async () => null), aiRecordProgressSample: vi.fn(async () => null),
}))
const service = GenerationService.getInstance()
beforeEach(() => {
  configureGenerationSubmissionConfirmation(requestAlertConfirmation)
  vi.clearAllMocks()
  useAlertDialogStore.setState({ queue: [] })
  vi.spyOn(service, 'getProgressEstimate').mockResolvedValue(null)
  registry.register({ meta: { id: 'cancel-fixture', canonicalModelId: 'nano-banana', provider: 'fixture', type: 'image', name: { zh: '测试', en: 'Test' } },
    params: [], endpoints: '/fixture', pricing: { currency: '$', fixed: 0.01 }, request: { builder: params => params } })
})
afterEach(() => { registry.unregister('cancel-fixture'); vi.restoreAllMocks(); useAlertDialogStore.setState({ queue: [] }) })

function enableConfirmation(): void {
  registry.getModel('cancel-fixture')!.submissionConfirmation = ttsPresentation['volcengine-seed-icl-2.0'].submissionConfirmation
}

it.each(['dialog', 'signal', 'task'] as const)('克隆等待 %s 取消时不上传或提交供应商请求，也不取消其他弹窗', async mode => {
  enableConfirmation()
  showAlertDialog({ title: '已有提示', message: '保留' })
  const controller = new AbortController()
  const run = service.generate('cancel-fixture', { volcIclMode: 'clone' }, undefined, { requestId: 'confirmation', signal: controller.signal })
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
  const params = { volcIclMode: 'clone', volcCloneAudio: ['original.wav'] }
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
  controller.abort()
  await vi.waitFor(() => expect(aiCancelTask).toHaveBeenCalledWith(phase === 'generate' ? 'original-request' : 'provider-task'))
  release()
  await run
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
