import type { MediaContentQueryProgress, MediaContentQueryProgressUpdate } from '@/core/media/contentIndex'
import { isVideoEditContentCurrent } from './videoEditDocumentAlgorithm'
import { publishVideoEdit, subscribeVideoEdit, type VideoEditInstance } from './videoEditService'

interface Entry { itemId: string; value: MediaContentQueryProgress; settled: boolean; requiredPermissions: readonly string[] }
const entries = new WeakMap<VideoEditInstance, Map<string, Entry>>()

export function readVideoEditContentQueries(owner: VideoEditInstance, itemId: string, permissions?: ReadonlySet<string>): MediaContentQueryProgress[] {
  return structuredClone([...(entries.get(owner)?.values() ?? [])].filter(entry => entry.itemId === itemId && (!permissions || entry.requiredPermissions.every(permission => permissions.has(permission)))).map(entry => entry.value))
}

/** The original read owns this task. No detached operation, new IPC, or persisted task truth. */
export function beginVideoEditContentQuery(owner: VideoEditInstance, itemId: string, outerSignal: AbortSignal, requiredPermissions: readonly string[]) {
  outerSignal.throwIfAborted()
  let retained = entries.get(owner)
  if (!retained) { retained = new Map(); entries.set(owner, retained) }
  if ([...retained.values()].filter(entry => !entry.settled).length >= 8) throw new Error('此剪辑已有八项内容查询，请等待原查询结束或取消完成后重试。')
  while (retained.size >= 8) {
    const completed = [...retained].find(([, entry]) => entry.settled)!
    retained.delete(completed[0])
  }
  const id = crypto.randomUUID(); const version = owner.contentVersion
  const controller = new AbortController()
  const entry: Entry = { itemId, settled: false, requiredPermissions: [...requiredPermissions], value: { id, state: 'running', phase: 'checking_source', message: '核对原素材', completedUnits: 0, totalUnits: null, phaseProgress: null, updatedAt: new Date().toISOString() } }
  retained.set(id, entry)
  let lastPublished = 0
  const publish = (immediate = true): void => {
    entry.value.updatedAt = new Date().toISOString()
    const now = performance.now()
    if (!immediate && now - lastPublished < 100) return
    lastPublished = now; publishVideoEdit()
  }
  const abort = (): void => controller.abort(outerSignal.reason)
  const markCancelled = (): void => {
    if (entry.value.state !== 'running') return
    entry.value.state = 'cancelled'; entry.value.message = '内容查询已取消，可重新查询。'
    publish()
  }
  outerSignal.addEventListener('abort', abort, { once: true })
  controller.signal.addEventListener('abort', markCancelled, { once: true })
  const unsubscribe = subscribeVideoEdit(() => {
    if (!isVideoEditContentCurrent(owner, version)) controller.abort(new Error('查询期间关联内容已改变或剪辑已关闭，请重新查询。'))
  })
  publish()
  return {
    signal: controller.signal,
    report(update: MediaContentQueryProgressUpdate): void {
      if (entry.value.state !== 'running') return
      const samePhase = entry.value.phase === update.phase
      const completedUnits = update.completedUnits ?? (samePhase ? entry.value.completedUnits : 0)
      const totalUnits = update.totalUnits === undefined ? samePhase ? entry.value.totalUnits : null : update.totalUnits
      const measured = update.phaseProgress ?? (totalUnits && totalUnits > 0 ? completedUnits / totalUnits : null)
      const phaseProgress = measured !== null && Number.isFinite(measured) ? Math.min(1, Math.max(0, measured)) : null
      entry.value = { ...entry.value, ...update, completedUnits, totalUnits, phaseProgress }
      publish(!samePhase || totalUnits !== null && completedUnits === totalUnits)
    },
    finish(outcome: 'completed' | 'failed', error?: unknown): void {
      unsubscribe(); outerSignal.removeEventListener('abort', abort); controller.signal.removeEventListener('abort', markCancelled)
      entry.settled = true
      if (entry.value.state !== 'running') return
      if (outcome === 'failed') {
        entry.value.state = 'failed'; entry.value.message = '内容查询未完成，请检查原因后重新查询。'
        entry.value.error = (error instanceof Error ? error.message : String(error)).slice(0, 2000)
      } else {
        entry.value.state = 'completed'; entry.value.phase = 'finished'; entry.value.message = '内容查询完成'
        entry.value.completedUnits = 1; entry.value.totalUnits = 1; entry.value.phaseProgress = 1
      }
      publish()
    },
  }
}
