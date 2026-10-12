/**
 * The history persistence owner saves this projection. SQLite's retirement outbox
 * records media candidates in the SAME transaction that removes each history row.
 * The global collector alone decides when those files are no longer referenced.
 */
export function removeGenerationHistoryRecords<T extends { id: string }>(
  records: readonly T[],
  removedIds: ReadonlySet<string>,
): T[] {
  return records.filter(record => !removedIds.has(record.id))
}
