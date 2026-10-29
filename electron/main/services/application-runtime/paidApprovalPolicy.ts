import type { AiGenerateRequestDto } from '@henjicc/ai-sdk'
import { operationDigest } from '../application-control/operationDigest'
import type { PaidOperationReceipt } from '../../../../src/core/application-control/paidApproval'
import { UI_PAID_CAPABILITIES, PAID_OPERATION_LABELS, readPaidApprovalSettingsValue, PAID_APPROVAL_SETTING_KEY, generationReservationKey, type PaidReservation, type PaidApprovalSettings, type PaidApprovalRequest, type PaidApprovalDecision, type PaidApprovalReceipt } from '../../../../src/core/application-control/paidApproval'
import type { ApplicationOperationStore, OperationRecord } from './operationStore'
import { getSettingsStore } from '../settings/store'
import { createMainLogger } from '../logging'
import { applicationUserConfirmation } from '../../../../src/core/application-control/userConfirmation'
import type { LocalHostReply } from '../../../../src/core/application-control/localHostContracts'

const logger = createMainLogger('main.application_runtime.paid_approval')
export function localDayStart(now: number): number {
  const date = new Date(now); date.setHours(0, 0, 0, 0); return date.getTime()
}
/** 所有入口共享额度，估价由正式准备服务提供。 */
export function decidePaidApproval(settings: PaidApprovalSettings, request: PaidApprovalRequest, dailySpentCny: number, estimateKind?: 'upper-bound' | 'estimate'): PaidApprovalDecision {
  const base = { estimatedCny: request.estimatedCny, dailySpentCny }
  const decision = (decision: PaidApprovalDecision['decision'], reason: string): PaidApprovalDecision => ({ ...base, decision, reason })
  if (settings.unlimited) return decision('auto', '完全放开')
  if (request.estimatedCny === 0) return decision('auto', '本次费用为零')
  if (dailySpentCny + (request.estimatedCny ?? 0) > settings.dailyLimitCny) return decision('ask', `今日已用 ¥${dailySpentCny.toFixed(2)}，超出每日上限 ¥${settings.dailyLimitCny}`)
  if (request.estimatedCny === null) return decision('ask', '费用暂无法预估')
  if (request.estimatedCny > settings.singleLimitCny) return decision('ask', `超出单次自动通过额度 ¥${settings.singleLimitCny}`)
  const cost = `${estimateKind === 'upper-bound' ? '按上限估算' : '预计'} ¥${request.estimatedCny.toFixed(4)}`
  return decision('auto', `${cost}，费用在额度内`)
}
export function readPaidApprovalSettings(): PaidApprovalSettings {
  const raw = getSettingsStore().get(PAID_APPROVAL_SETTING_KEY)
  return readPaidApprovalSettingsValue(raw ? JSON.parse(raw) : {})
}
/** 同步决策与预留，防止并发任务同时花掉同一份额度。 */
export function approvePaidOperation(store: Pick<ApplicationOperationStore, 'get' | 'save' | 'generationSpendSince' | 'generationTaskReservations'>, record: OperationRecord, request: PaidApprovalRequest,
  consent?: 'once', now = Date.now()): PaidApprovalDecision {
  const settings = readPaidApprovalSettings()
  const { generationTaskEstimates, ...reservationRequest } = request
  const reused = new Map<string, PaidReservation>()
  let fresh = [reservationRequest]
  if (request.category === 'generation' && request.generationTaskIds?.length) {
    const existing = store.generationTaskReservations()
    const missing = request.generationTaskIds.filter(id => {
      const prior = existing.find(item => item.generationTaskIds?.includes(id))
      if (!prior) return true
      reused.set(generationReservationKey(prior)!, prior)
      return false
    })
    if (generationTaskEstimates) {
      const estimates = new Map(generationTaskEstimates.map(item => [item.taskId, item.estimatedCny]))
      if (estimates.size !== request.generationTaskIds.length || request.generationTaskIds.some(id => !estimates.has(id))) throw new Error('GENERATION_ESTIMATE_CONFLICT:任务估价与提交清单不一致。')
      const total = generationTaskEstimates.some(item => item.estimatedCny === null) ? null : generationTaskEstimates.reduce((sum, item) => sum + (item.estimatedCny ?? 0), 0)
      if (total === null ? request.estimatedCny !== null : request.estimatedCny === null || Math.abs(total - request.estimatedCny) > 1e-9) throw new Error('GENERATION_ESTIMATE_CONFLICT:任务估价与总费用不一致。')
      fresh = missing.map(id => ({ ...reservationRequest, generationTaskIds: [id], estimatedCny: estimates.get(id)! }))
    } else if (!missing.length) fresh = []
    else if (reused.size) throw new Error('GENERATION_ESTIMATE_REQUIRED:请提供新增生成任务的逐项估价。')
  }
  const incremental = fresh.some(item => item.estimatedCny === null) ? null : fresh.reduce((sum, item) => sum + (item.estimatedCny ?? 0), 0)
  const approvalRequest = { ...reservationRequest, estimatedCny: incremental }
  const decision = decidePaidApproval(settings, approvalRequest, store.generationSpendSince(localDayStart(now)), request.category === 'generation' ? record.paidGenerationEstimateKind : undefined)
  if (decision.decision === 'deny') return decision
  if (decision.decision === 'auto' || consent) {
    const approval: PaidApprovalReceipt = { decision: consent ? 'user' : 'auto', reason: consent ? '用户确认' : decision.reason }
    const current = store.get(record.operationId, record.callerId)!
    store.save({ ...current, paidReservations: [...(current.paidReservations ?? []), ...reused.values(), ...fresh.map(item => ({ ...item, reservedAt: now, approval }))], approval })
    logger.info('AI 付费已授权', { event: 'application.paid_approval.accepted', requestId: record.operationId, context: { category: request.category, estimatedCny: incremental, reusedReservations: reused.size, generationTaskIds: request.generationTaskIds, ...approval } })
  } else logger.info('AI 付费等待确认', { event: 'application.paid_approval.ask', requestId: record.operationId, context: { category: request.category, reason: decision.reason } })
  return decision
}

/** All UI paid operations share the policy, reservations and operation lifecycle. */
export function handleUiPaidApproval(store: Pick<ApplicationOperationStore, 'get' | 'save' | 'generationSpendSince' | 'generationTaskReservations' | 'prepare'>, reply: LocalHostReply): (PaidApprovalDecision & { expiresAt?: number | null }) | void {
  const command = reply.uiPaidApproval!
  if (command.request.category !== UI_PAID_CAPABILITIES[command.capabilityId]) throw new Error('付费类别与正式操作不一致。')
  const callerId = reply.rendererEpoch
  let record = store.get(reply.requestId, callerId)
  if (command.action === 'prepare') {
    if (record) throw new Error('此付费请求已登记，请继续原请求。')
    const { generationTaskEstimates: _estimates, ...paid } = command.request
    record = store.prepare({ operationId: reply.requestId, callerId, capabilityId: command.capabilityId,
      input: { paid }, inputDigest: JSON.stringify(command.request), state: 'preparing', origin: { at: Date.now(), actor: 'user' } })
    const decision = approvePaidOperation(store, record, command.request)
    const current = store.get(record.operationId, callerId)!
    const confirmation = decision.decision === 'ask' ? applicationUserConfirmation({ title: PAID_OPERATION_LABELS[command.request.category], message: '你发起的操作将使用已配置的模型，按模型计费。', confirmLabel: '允许本次', paid: decision }) : undefined
    store.save({ ...current, state: confirmation ? 'awaiting_user_confirmation' : 'preparing', confirmation })
    return { ...decision, expiresAt: confirmation?.expiresAt ?? null }
  }
  if (!record || record.capabilityId !== command.capabilityId || record.inputDigest !== JSON.stringify(command.request)) throw new Error('付费请求与原授权不一致。')
  if (command.action === 'approve') {
    if (record.state !== 'awaiting_user_confirmation' || !record.confirmation || record.confirmation.expiresAt === null || record.confirmation.expiresAt <= Date.now()) throw new Error('付费确认已结束，请重新发起。')
    const decision = approvePaidOperation(store, record, command.request, 'once')
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
    const completed = command.action === 'complete'
    const notCharged = !completed && command.failureFacts?.billing === 'not_charged'
    store.save({ ...record, state: completed ? 'completed' : notCharged ? 'not_executed' : 'unknown',
      verificationState: completed || notCharged ? 'verified' : 'unresolved',
      ...(!completed ? { result: { ok: false, error: { code: 'PAID_OPERATION_FAILED', message: '付费操作失败', details: command.failureFacts ?? { billing: 'unknown' } } } } : {}) })
    logger.info('AI 付费执行事实已记录', { event: 'application.paid_approval.settled', requestId: record.operationId,
      context: { outcome: completed ? 'completed' : notCharged ? 'not_charged' : 'unknown', category: command.request.category } })
  }
}

/** IPC 提交只消费正式账本收据；同一任务的续查与结果恢复不经过这道提交闸。 */
export function assertGenerationPaidReceipt(store: Pick<ApplicationOperationStore, 'get' | 'save'>, receipt: PaidOperationReceipt | undefined, request: AiGenerateRequestDto): void {
  if (!receipt || !request.requestId) throw new Error('PAID_CONFIRMATION_REQUIRED:请先通过应用付费策略确认本次生成。')
  const record = store.get(receipt.operationId, receipt.callerId)
  if (!record || !record.approval || !['executing', 'completed'].includes(record.state)) throw new Error('PAID_CONFIRMATION_REQUIRED:本次生成的付费收据无效或已取消。')
  const { requestId, ...input } = request
  const digest = operationDigest(input)
  const reservations = [...record.paidReservations ?? []]
  const existing = reservations.flatMap(item => [...item.generationRequests ?? [], ...item.generationRequest ? [item.generationRequest] : []]).find(item => item.id === requestId)
  if (existing) {
    if (existing.digest !== digest) throw new Error('GENERATION_INPUT_CONFLICT:原生成标识已绑定其他输入。')
    return
  }
  const index = reservations.findIndex(item => item.category === 'generation' && (item.generationTaskIds ? item.generationTaskIds.includes(requestId) : !item.generationRequest))
  if (index < 0) throw new Error('PAID_CONFIRMATION_REQUIRED:付费收据已用于另一项生成。')
  const reservation = reservations[index]
  reservations[index] = reservation.generationTaskIds
    ? { ...reservation, generationRequests: [...reservation.generationRequests ?? [], { id: requestId, digest }] }
    : { ...reservation, generationRequest: { id: requestId, digest } }
  store.save({ ...record, paidReservations: reservations })
}
