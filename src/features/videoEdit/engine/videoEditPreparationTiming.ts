/** Worker-local cumulative preparation counters; never part of the authored budget. */
const stages: Record<string, { ms: number; count: number }> = {}

export function recordVideoEditPreparation(stage: string, ms: number): void {
  const entry = stages[stage] ??= { ms: 0, count: 0 }
  entry.ms += ms; entry.count++
}

export function videoEditPreparationSnapshot(): Record<string, { ms: number; count: number }> {
  return Object.fromEntries(Object.entries(stages).map(([key, value]) => [key, { ...value }]))
}
