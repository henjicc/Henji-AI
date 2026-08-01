import type { ApplicationChangePlan, ApplicationTransactionResult } from '../transactions'

export interface StoredApplicationPlan {
  plan: ApplicationChangePlan
  committed: boolean
}

interface IdempotencyResult {
  operationRef: string
  result: ApplicationTransactionResult
}

export class ApplicationExecutionPlanStore {
  private readonly plans = new Map<string, StoredApplicationPlan>()
  private readonly idempotencyResults = new Map<string, IdempotencyResult>()

  constructor(
    private readonly maxPlans: number,
    private readonly maxIdempotencyResults: number
  ) {}

  savePlan(plan: ApplicationChangePlan): void {
    this.plans.set(plan.planRef, { plan, committed: false })
    this.trim(this.plans, this.maxPlans)
  }

  getPlan(planRef: string): StoredApplicationPlan | undefined {
    return this.plans.get(planRef)
  }

  markCommitted(planRef: string): void {
    const stored = this.plans.get(planRef)
    if (stored) stored.committed = true
  }

  getIdempotent(key: string, operationRef: string): ApplicationTransactionResult | undefined {
    const stored = this.idempotencyResults.get(key)
    if (!stored) return undefined
    if (stored.operationRef !== operationRef) throw new Error('IDEMPOTENCY_KEY_REUSED')
    return stored.result
  }

  saveIdempotent(key: string, operationRef: string, result: ApplicationTransactionResult): void {
    this.idempotencyResults.set(key, { operationRef, result })
    this.trim(this.idempotencyResults, this.maxIdempotencyResults)
  }

  private trim<TKey, TValue>(map: Map<TKey, TValue>, limit: number): void {
    while (map.size > limit) {
      const oldest = map.keys().next().value as TKey | undefined
      if (oldest === undefined) break
      map.delete(oldest)
    }
  }
}
