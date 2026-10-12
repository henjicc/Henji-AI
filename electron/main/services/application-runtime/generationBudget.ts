import type { ApplicationOperationStore, OperationRecord } from './operationStore'

/** 金额来自应用正式准备服务，不接受 Agent 自报价格；实际费用预留由统一授权服务执行。 */
export function reserveGenerationBudget(store: Pick<ApplicationOperationStore, 'get' | 'save'>, record: OperationRecord, preparation: unknown): void {
  const current = store.get(record.operationId, record.callerId)
  if (!current || !['prepared', 'preparing'].includes(current.state)) return
  const result = preparation as { ok?: boolean; data?: { preparation?: { canSubmit?: boolean; message?: string; errorCode?: string; priceEstimate?: { comparableCnyAmount?: unknown; estimateKind?: string } } }; error?: { message?: string } }
  if (result?.ok !== true) throw new Error(result?.error?.message ?? '生成参数校验未通过，请修正后再提交。')
  if (result.data?.preparation?.canSubmit === false) throw new Error(`${result.data.preparation.errorCode ?? 'GENERATION_PREFLIGHT_REJECTED'}:${result.data.preparation.message ?? '当前不能提交生成。'}`)
  const amount = result.data?.preparation?.priceEstimate?.comparableCnyAmount
  record.paidGenerationEstimate = typeof amount === 'number' && Number.isFinite(amount) && amount >= 0 ? amount : null
  record.paidGenerationEstimateKind = result.data?.preparation?.priceEstimate?.estimateKind === 'upper-bound' ? 'upper-bound' : 'estimate'
  store.save({ ...current, paidGenerationEstimate: record.paidGenerationEstimate, paidGenerationEstimateKind: record.paidGenerationEstimateKind })
}
