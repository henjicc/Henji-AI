import type { McpOperationStore, OperationRecord } from './operationStore'

export const GENERATION_BUDGET = { cny: 50, windowMs: 10 * 60_000 } as const

/** 金额来自应用正式准备服务，不接受 Agent 自报价格；同步预留避免并行超支。 */
export function reserveGenerationBudget(store: McpOperationStore, record: OperationRecord, preparation: unknown, now = Date.now()): void {
  const current = store.get(record.operationId, record.callerId)
  if (current?.state !== 'prepared') return
  const result = preparation as { ok?: boolean; data?: { preparation?: { priceEstimate?: { comparableCnyAmount?: unknown } } }; error?: { message?: string } }
  if (result?.ok !== true) throw new Error(result?.error?.message ?? '生成参数校验未通过，请修正后再提交。')
  const amount = result.data?.preparation?.priceEstimate?.comparableCnyAmount
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0) throw new Error('费用暂不可估算，请先在生成页面核对价格后手动提交；不要盲目重试。')
  const since = now - GENERATION_BUDGET.windowMs
  const prior = current.generationEstimate
  const spent = store.generationSpendSince(since) - (prior && prior.reservedAt >= since ? prior.cny : 0)
  if (spent + amount > GENERATION_BUDGET.cny) throw new Error(`本次估价 ¥${amount.toFixed(2)}，最近 10 分钟已预留 ¥${spent.toFixed(2)}，超出自动生成额度 ¥${GENERATION_BUDGET.cny}。请停止批量请求，向用户说明费用；需要继续时可由用户在生成页面提交。`)
  record.generationEstimate = { cny: amount, reservedAt: now }
  store.save(record)
}
