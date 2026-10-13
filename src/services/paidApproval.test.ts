import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { applicationPaidRequest, withPaidOperation, prepareExplanationPaidApproval, PaidOperationCancelledError } from './paidApproval'
import { bindApplicationConfirmation } from '@/core/application-control/userConfirmation'
import { useAlertDialogStore } from '@/stores/alertDialogStore'
import type { LocalHostReply } from '@/core/application-control/localHostContracts'
import { TranscriptionFailure } from '@/core/audioEdit/transcriptionFailure'
import { ApplicationPreflightFailure } from '@/core/application-control/execution/transactionFailure'

const ports = vi.hoisted(() => ({ findDocument: vi.fn(), findProject: vi.fn(), target: vi.fn(), complete: vi.fn() }))
vi.mock('@/platform/runtime', () => ({ getPlatform: () => ({ applicationControl: { complete: ports.complete } }) }))
vi.mock('@/contexts/NotificationContext', () => ({ notifyUser: vi.fn() }))
vi.mock('@/features/documents/documentOperations', () => ({ getDocumentOperations: () => ports }))
vi.mock('@/features/canvas/application/imageEditDocumentProjectionBinding', () => ({ findCanvasImageEditDocumentTarget: ports.target }))
beforeEach(() => {
  vi.resetAllMocks()
  ports.findProject.mockResolvedValue({ id: 'project', name: '测试项目' })
  ports.complete.mockImplementation(async (reply: LocalHostReply) => reply.uiPaidApproval?.action === 'prepare'
    ? { decision: 'auto', reason: '额度内', estimatedCny: 1, dailySpentCny: 0, expiresAt: null } : undefined)
})
afterEach(() => { useAlertDialogStore.setState({ queue: [] }); vi.useRealTimers() })
it('直接使用讲解确认回执的调用方也得到过期取消错误', async () => {
  ports.findDocument.mockResolvedValue({ container: { kind: 'user' } })
  ports.complete.mockImplementation(async (reply: LocalHostReply) => {
    if (reply.uiPaidApproval?.action === 'prepare') return { decision: 'ask', reason: '询问', estimatedCny: 1, dailySpentCny: 0, expiresAt: Date.now() + 1000 }
    if (reply.uiPaidApproval?.action === 'approve') throw new Error('付费确认已结束，请重新发起。')
  })
  const paid = await prepareExplanationPaidApproval({ kind: 'video_edit.document', id: 'document' })
  await expect(paid.confirm(false)).rejects.toBeInstanceOf(PaidOperationCancelledError)
})
it('共享付费操作审批在 IPC 往返中到期按取消收口，不能启动工作', async () => {
  vi.useFakeTimers()
  ports.complete.mockImplementation(async (reply: LocalHostReply) => {
    if (reply.uiPaidApproval?.action === 'prepare') return { decision: 'ask', reason: '询问', estimatedCny: 1, dailySpentCny: 0, expiresAt: Date.now() + 1000 }
    if (reply.uiPaidApproval?.action === 'approve') throw new Error('付费确认已结束，请重新发起。')
  })
  const work = vi.fn()
  const run = withPaidOperation({ category: 'title' }, work)
  const outcome = run.catch(error => error)
  await vi.advanceTimersByTimeAsync(0)
  expect(useAlertDialogStore.getState().queue).toHaveLength(1)
  useAlertDialogStore.getState().confirmCurrent()
  expect(await outcome).toBeInstanceOf(PaidOperationCancelledError)
  expect(work).not.toHaveBeenCalled()
  expect(ports.complete.mock.calls.map(([reply]) => reply.uiPaidApproval.action)).toEqual(['prepare', 'approve', 'reject'])
})
it('prepare 传输消耗的时间不会重新计入弹窗期限', async () => {
  vi.useFakeTimers()
  const expiresAt = Date.now() + 1000
  ports.complete.mockImplementation(async (reply: LocalHostReply) => {
    if (reply.uiPaidApproval?.action === 'prepare') return { decision: 'ask', reason: '询问', estimatedCny: 1, dailySpentCny: 0, expiresAt }
  })
  vi.setSystemTime(expiresAt - 100)
  const work = vi.fn()
  const run = withPaidOperation({ category: 'title' }, work)
  const outcome = run.catch(error => error)
  await vi.advanceTimersByTimeAsync(100)
  expect(useAlertDialogStore.getState().queue).toHaveLength(0)
  expect(await outcome).toBeInstanceOf(PaidOperationCancelledError)
  expect(work).not.toHaveBeenCalled()
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
    if (reply.uiPaidApproval?.action === 'prepare') return { decision: 'auto', reason: '额度内', estimatedCny: 1, dailySpentCny: 0, expiresAt: null }
    if (reply.uiPaidApproval?.action === 'complete') throw new ApplicationPreflightFailure('保存回执失败')
  })
  await expect(withPaidOperation({ category: 'title' }, async () => '已完成')).rejects.toThrow('保存回执失败')
  expect(ports.complete.mock.lastCall?.[0].uiPaidApproval.failureFacts).toEqual({ billing: 'completed' })
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
