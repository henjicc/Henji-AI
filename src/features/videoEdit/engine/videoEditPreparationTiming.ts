/** Worker-local cumulative preparation counters; never part of the authored budget. */
const stages: Record<string, { ms: number; count: number }> = {}

export function recordVideoEditPreparation(stage: string, ms: number): void {
  const entry = stages[stage] ??= { ms: 0, count: 0 }
  entry.ms += ms; entry.count++
}

export function videoEditPreparationSnapshot(): Record<string, { ms: number; count: number }> {
  return Object.fromEntries(Object.entries(stages).map(([key, value]) => [key, { ...value }]))
}

/** 当前渲染调用期间的阶段增量；保留原有阶段名供诊断，不重新执行测量渲染。 */
export function videoEditPreparationDelta(before: ReturnType<typeof videoEditPreparationSnapshot>): Record<string, number> {
  return Object.fromEntries(Object.entries(stages).map(([key, value]) => [key, Math.max(0, value.ms - (before[key]?.ms ?? 0))]))
}
