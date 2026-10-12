import { paidApprovalSettingsSchema, PAID_APPROVAL_SETTING_KEY, type PaidApprovalSettings, type PaidApprovalRequest, type PaidApprovalDecision, type PaidApprovalReceipt } from '../../../../src/core/application-control/paidApproval'
import type { ApplicationOperationStore, OperationRecord } from './operationStore'
import { getSettingsStore } from '../settings/store'
import { createMainLogger } from '../logging'
import { applicationUserConfirmation } from '../../../../src/core/application-control/userConfirmation'
import type { LocalHostReply } from '../../../../src/core/application-control/localHostContracts'

const logger = createMainLogger('main.application_runtime.paid_approval')
export function localDayStart(now: number): number {
  const date = new Date(now); date.setHours(0, 0, 0, 0); return date.getTime()
}
/** All callers share these limits; only official application estimates enter this service. */
export function decidePaidApproval(settings: PaidApprovalSettings, request: PaidApprovalRequest, dailySpentCny: number, allowPaid: boolean, estimateKind?: 'upper-bound' | 'estimate'): PaidApprovalDecision {
  const base = { estimatedCny: request.estimatedCny, dailySpentCny }
  const decision = (decision: PaidApprovalDecision['decision'], reason: string): PaidApprovalDecision => ({ ...base, decision, reason })
  if (!allowPaid) return decision('deny', '此连接没有付费操作授权。')
  const granted = request.project && settings.projects.some(value => value.id === request.project!.id && value.category === request.category)
  if (settings.mode === 'ask' && !granted) return decision('ask', '每次询问')
  if (dailySpentCny + (request.estimatedCny ?? 0) > settings.dailyLimitCny) return decision('ask', `今日已用 ¥${dailySpentCny.toFixed(2)}，超出每日上限 ¥${settings.dailyLimitCny}`)
  if (settings.mode === 'bypass') return decision('auto', '全部放行')
  if (request.estimatedCny === null) return decision('ask', '费用暂无法预估')
  if (request.estimatedCny > settings.singleLimitCny) return decision('ask', `超出单次自动通过额度 ¥${settings.singleLimitCny}`)
  const cost = `${estimateKind === 'upper-bound' ? '按上限估算' : '预计'} ¥${request.estimatedCny.toFixed(4)}`
  return decision('auto', `${cost}，${granted ? '项目已授权且费用在额度内' : '费用在自动通过额度内'}`)
}
export function readPaidApprovalSettings(): PaidApprovalSettings {
  const raw = getSettingsStore().get(PAID_APPROVAL_SETTING_KEY)
  return paidApprovalSettingsSchema.parse(raw ? JSON.parse(raw) : {})
}
/** Synchronous decision + reservation prevents concurrent operations overspending the shared allowance. */
export function approvePaidOperation(store: Pick<ApplicationOperationStore, 'get' | 'save' | 'generationSpendSince'>, record: OperationRecord, request: PaidApprovalRequest,
  allowPaid: boolean, consent?: 'once' | 'project', now = Date.now()): PaidApprovalDecision {
  const settings = readPaidApprovalSettings()
  const decision = decidePaidApproval(settings, request, store.generationSpendSince(localDayStart(now)), allowPaid, request.category === 'generation' ? record.paidGenerationEstimateKind : undefined)
  if (decision.decision === 'deny') return decision
  if (consent === 'project' && request.project) {
    const projects = settings.projects.filter(value => value.id !== request.project!.id || value.category !== request.category)
    getSettingsStore().set(PAID_APPROVAL_SETTING_KEY, JSON.stringify({ ...settings, projects: [...projects, { ...request.project, category: request.category }] }), 'json')
  }
  if (decision.decision === 'auto' || consent) {
    const approval: PaidApprovalReceipt = { decision: consent ? 'user' : 'auto', reason: consent ? '用户确认' : decision.reason }
    const current = store.get(record.operationId, record.callerId)!
    store.save({ ...current, paidReservations: [...(current.paidReservations ?? []), { ...request, reservedAt: now, approval }], approval })
    logger.info('AI 付费已授权', { event: 'application.paid_approval.accepted', requestId: record.operationId, context: { category: request.category, estimatedCny: request.estimatedCny, ...approval } })
  } else logger.info('AI 付费等待确认', { event: 'application.paid_approval.ask', requestId: record.operationId, context: { category: request.category, reason: decision.reason } })
  return decision
}

/** UI 讲解与音色克隆使用同一费用策略、确认回执和账本。 */
export function handleUiPaidApproval(store: Pick<ApplicationOperationStore, 'get' | 'save' | 'generationSpendSince' | 'prepare'>, reply: LocalHostReply): PaidApprovalDecision | void {
  const command = reply.uiPaidApproval!
  const generation = command.capabilityId === 'create_visible_generation_task'
  if (command.request.category !== (generation ? 'generation' : 'explanation')) throw new Error('付费类别与正式操作不一致。')
  const callerId = reply.rendererEpoch
  let record = store.get(reply.requestId, callerId)
  if (command.action === 'prepare') {
    if (record) throw new Error('此付费请求已登记，请继续原请求。')
    record = store.prepare({ operationId: reply.requestId, callerId, capabilityId: command.capabilityId,
      input: { paid: command.request }, inputDigest: JSON.stringify(command.request), state: 'preparing', origin: { at: Date.now(), actor: 'user' } })
    const decision = approvePaidOperation(store, record, command.request, true)
    const current = store.get(record.operationId, callerId)!
    store.save({ ...current, state: decision.decision === 'ask' ? 'awaiting_user_confirmation' : 'preparing',
      confirmation: decision.decision === 'ask' ? applicationUserConfirmation({ title: generation ? '生成内容' : '发送讲解给 AI？', message: generation ? '将上传素材并按模型计费。' : '将发送讲解文字和画面给模型。', confirmLabel: '允许本次', paid: decision }) : undefined })
    return decision
  }
  if (!record || record.inputDigest !== JSON.stringify(command.request)) throw new Error('付费请求与原授权不一致。')
  if (command.action === 'approve') {
    if (record.state !== 'awaiting_user_confirmation' || !record.confirmation || record.confirmation.expiresAt === null || record.confirmation.expiresAt <= Date.now()) throw new Error('付费确认已结束，请重新发起。')
    const decision = approvePaidOperation(store, record, command.request, true, command.projectConsent ? 'project' : 'once')
    store.save({ ...store.get(record.operationId, callerId)!, state: 'preparing', confirmation: undefined })
    return decision
  }
  if (command.action === 'start') {
    if (record.state !== 'preparing' || !record.approval) throw new Error('请先确认本次付费操作。')
    store.save({ ...record, state: 'executing' })
  } else if (command.action === 'reject') {
    if (!['preparing', 'awaiting_user_confirmation'].includes(record.state)) throw new Error('已开始发送，无法撤回计费。')
    store.save({ ...record, state: 'not_executed', confirmation: undefined, verificationState: 'verified' })
  } else {
    if (record.state !== 'executing') throw new Error('付费操作尚未开始。')
    store.save({ ...record, state: command.action === 'complete' ? 'completed' : 'unknown', verificationState: command.action === 'complete' ? 'verified' : 'unresolved' })
  }
}
