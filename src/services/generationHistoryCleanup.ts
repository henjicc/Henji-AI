/**
 * Remove history records only. The history persistence owner saves this projection.
 *
 * Asset-library membership is not proof that a file is unused: documents (including
 * unsaved canvases), other tasks and presets can share the same result/source/edit
 * state. Until an authoritative application-wide reference check and atomic reclaim
 * operation exist, retain every file and its caches. Never infer ownership from a
 * missing record, an incomplete query, or a failed read.
 */
export function removeGenerationHistoryRecords<T extends { id: string }>(
  records: readonly T[],
  removedIds: ReadonlySet<string>,
): T[] {
  return records.filter(record => !removedIds.has(record.id))
}
