import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { applicationPaidRequest, configurePaidApprovalImageDocumentResolver, withPaidOperation, prepareGenerationPaidApproval, isUserCancellation } from './paidApproval'
import { registry } from '@/core/ModelRegistry'
import type { ModelDefinition } from '@/core/types'
import { readPriceEstimateDisplaySettings } from '@/core/pricing/priceDisplay'
import { bindApplicationConfirmation } from '@/core/application-control/userConfirmation'
import { useAlertDialogStore } from '@/stores/alertDialogStore'
import { notifyUser } from '@/contexts/NotificationContext'
import type { LocalHostReply } from '@/core/application-control/localHostContracts'
import { TranscriptionFailure } from '@/core/audioEdit/transcriptionFailure'
import { ApplicationPreflightFailure } from '@/core/application-control/execution/transactionFailure'

const ports = vi.hoisted(() => ({ findDocument: vi.fn(), findProject: vi.fn(), target: vi.fn(), complete: vi.fn() }))
vi.mock('@/platform/runtime', () => ({ getPlatform: () => ({ applicationControl: { complete: ports.complete } }) }))
vi.mock('@/contexts/NotificationContext', () => ({ notifyUser: vi.fn() }))
vi.mock('@/features/documents/documentOperations', () => ({ getDocumentOperations: () => ports }))
const probes = vi.hoisted(() => ({ readVideoInfo: vi.fn() }))
vi.mock('@/commands/video', () => probes)
configurePaidApprovalImageDocumentResolver(documentId => ports.target(documentId))
beforeEach(() => {
  vi.resetAllMocks()
  ports.findProject.mockResolvedValue({ id: 'project', name: '测试项目' })
  ports.complete.mockImplementation(async (reply: LocalHostReply) => reply.uiPaidApproval?.action === 'prepare'
    ? { decision: 'auto', reason: '用户亲自发起', estimatedCny: 1, dailySpentCny: 0 } : undefined)
})
afterEach(() => { useAlertDialogStore.setState({ queue: [] }); vi.useRealTimers() })
it('界面付费操作不弹确认也不提示自动同意，按准备、开始、完成记账后执行', async () => {
  const work = vi.fn(async () => '完成')
  expect(await withPaidOperation({ category: 'title' }, work)).toBe('完成')
  expect(work).toHaveBeenCalledOnce()
  expect(useAlertDialogStore.getState().queue).toHaveLength(0)
  expect(notifyUser).not.toHaveBeenCalled()
  expect(ports.complete.mock.calls.map(([reply]) => reply.uiPaidApproval.action)).toEqual(['prepare', 'start', 'complete'])
})
it.each([
  [new TranscriptionFailure(new Error('预检拒绝'), { billing: 'not_charged', targetMutation: 'none' }), 'not_charged'],
  [Object.assign(new Error('宿主前置拒绝'), { details: { billing: 'not_charged', execution: { notExecuted: true } } }), 'not_charged'],
  [new TranscriptionFailure(new Error('已提交'), { billing: 'submitted', targetMutation: 'none' }), 'submitted'],
  [Object.assign(new Error('HTTP 400'), { status: 400 }), 'unknown'],
  [new Error('余额不足，未计费'), 'unknown'],
  [new DOMException('提交后取消', 'AbortError'), 'unknown'],
  [new Error('包装失败', { cause: new TranscriptionFailure(new Error('预检'), { billing: 'not_charged', targetMutation: 'none' }) }), 'not_charged'],
  [new TranscriptionFailure(new ApplicationPreflightFailure('旧预检'), { billing: 'completed', targetMutation: 'applied' }), 'completed'],
] as const)('失败 %s 只传递明确的计费事实 %s', async (error, billing) => {
  await expect(withPaidOperation({ category: 'title' }, async () => { throw error })).rejects.toBe(error)
  expect(ports.complete.mock.lastCall?.[0].uiPaidApproval).toMatchObject({ action: 'failed', failureFacts: { billing } })
})
it('工作已成功后的费用回执错误不得释放实际已执行的预算', async () => {
  ports.complete.mockImplementation(async (reply: LocalHostReply) => {
    if (reply.uiPaidApproval?.action === 'prepare') return { decision: 'auto', reason: '用户亲自发起', estimatedCny: 1, dailySpentCny: 0 }
    if (reply.uiPaidApproval?.action === 'complete') throw new ApplicationPreflightFailure('保存回执失败')
  })
  await expect(withPaidOperation({ category: 'title' }, async () => '已完成')).rejects.toThrow('保存回执失败')
  expect(ports.complete.mock.lastCall?.[0].uiPaidApproval.failureFacts).toEqual({ billing: 'completed' })
})
it('生成付费确认先按 pricing.mediaContext 补齐音频时长，授权金额与界面估价一致', async () => {
  const model: ModelDefinition = {
    meta: { id: 'audio-priced-test', canonicalModelId: 'ltx-2.3', provider: 'fal', type: 'video', name: { zh: '音频计价', en: 'Audio priced' }, tags: [] },
    inputLimits: { images: { max: 0 }, videos: { max: 0 }, audios: { exact: 1 } },
    params: [], linkages: [], endpoints: '/test', request: { builder: (params) => params },
    pricing: {
      currency: '$', calculator: (params) => 0.1 * Number(params.__audioDurationSeconds ?? 20),
      mediaContext: [{ targetParam: '__audioDurationSeconds', mediaType: 'audio', metric: 'durationSeconds' }],
    },
  }
  registry.register(model)
  probes.readVideoInfo.mockResolvedValue({ durationSeconds: 5, width: 0, height: 0, hasAudio: true })
  try {
    await prepareGenerationPaidApproval(model.meta.id, { uploadedAudioFilePaths: ['paid-approval-voice.mp3'] })
    expect(probes.readVideoInfo).toHaveBeenCalledWith('paid-approval-voice.mp3')
    const prepared = ports.complete.mock.calls[0][0].uiPaidApproval.request
    expect(prepared.estimatedCny).toBeCloseTo(0.5 * readPriceEstimateDisplaySettings().usdToCnyRate)
  } finally { registry.clear() }
})
const missing = () => Object.assign(new Error('找不到文档'), { name: 'DocumentNotFoundError' })
it('界面与 AI 均查询真实项目，图片引用解码；工具箱没有项目授权', async () => {
  ports.findDocument.mockResolvedValue({ container: { kind: 'project', projectId: 'project' } })
  expect(await applicationPaidRequest('generation', 'document')).toMatchObject({ project: { id: 'project' } })
  const controller = new AbortController()
  const release = bindApplicationConfirmation(controller.signal, async () => {})
  try {
    ports.findDocument.mockResolvedValue({ container: { kind: 'project', projectId: 'project' } })
    expect(await applicationPaidRequest('generation', { kind: 'image_edit.document', id: 'v3:doc%3A1' }, controller.signal, 1))
      .toMatchObject({ estimatedCny: 1, project: { id: 'project', name: '测试项目' } })
    expect(ports.findDocument).toHaveBeenLastCalledWith('doc:1')
    ports.findDocument.mockRejectedValue(missing())
    expect(await applicationPaidRequest('generation', { kind: 'image_edit.document', id: 'v3:toolbox' }, controller.signal))
      .toEqual({ category: 'generation', estimatedCny: null })
  } finally { release() }
})
it('画布内嵌图片沿正式关联找到项目，不把图片工作副本当成项目', async () => {
  const controller = new AbortController(), release = bindApplicationConfirmation(controller.signal, async () => {})
  try {
    ports.findDocument.mockRejectedValueOnce(missing()).mockResolvedValueOnce({ container: { kind: 'project', projectId: 'project' } })
    ports.target.mockResolvedValue({ projectId: 'canvas' })
    expect(await applicationPaidRequest('explanation', { kind: 'image_edit.document', id: 'v3:embedded' }, controller.signal))
      .toMatchObject({ project: { id: 'project' } })
    expect(ports.target).toHaveBeenCalledWith('embedded')
    expect(ports.findDocument).toHaveBeenLastCalledWith('canvas')
    ports.findDocument.mockRejectedValue(new Error('读取失败'))
    await expect(applicationPaidRequest('explanation', { kind: 'image_edit.document', id: 'v3:embedded' }, controller.signal)).rejects.toThrow('读取失败')
  } finally { release() }
})

it('用户取消：生成提交被拒、中途停止都算，包在 cause 里也认得；普通失败不算', () => {
  const declined = new Error('已取消提交'); declined.name = 'GenerationSubmissionCancelledError'
  const aborted = new Error('stopped'); aborted.name = 'AbortError'
  expect(isUserCancellation(declined)).toBe(true)
  expect(isUserCancellation(new Error('画布节点失败', { cause: aborted }))).toBe(true)
  expect(isUserCancellation(new Error('供应商返回 500'))).toBe(false)
  expect(isUserCancellation('取消')).toBe(false)
})
