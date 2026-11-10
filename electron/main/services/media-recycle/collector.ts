import fs from 'node:fs/promises'
import { setImmediate as yieldToIO } from 'node:timers/promises'
import { canonicalPath, createPathCanonicalizer, fileIdentity, localMediaPath, within } from './paths'
import { MediaRecycleStopped } from './lifecycle'

export interface MediaReferenceProvider {
  id: string
  collect(signal: AbortSignal): Promise<Iterable<string>>
}
export interface RecycleCandidate { id: number; paths: string[]; protectedBy?: string[]; derivedFrom?: Record<string, string[]> }
export interface RecycleStore {
  count?(): number
  candidates(): AsyncIterable<RecycleCandidate>
  identity(path: string): string | undefined
  protector?(path: string): string | undefined
  forget(id: number): void
}
export interface RecycleSummary {
  candidates: number
  deleted: number
  recycledBytes: number
  retained: Record<string, number>
}
export interface MediaCollectorOptions {
  store: RecycleStore
  roots(): Promise<string[]>
  providers: readonly MediaReferenceProvider[]
  /** 普查之后本次运行里主进程刚写出或交出去的文件，界面可能正拿着还没存盘。 */
  claimed?(file: string): boolean
  trashItem(file: string): Promise<void>
  log(phase: 'start' | 'completed' | 'deferred' | 'failed', summary: RecycleSummary, error?: unknown): void
  providerTimeoutMs?: number
  referencesReady?(references: ReadonlySet<string>): void
}

/** Mark all roots before sweeping. Failure is NOT an empty reference set. */
export async function collectUnreferencedMedia(options: MediaCollectorOptions, signal: AbortSignal): Promise<RecycleSummary> {
  const summary: RecycleSummary = { candidates: options.store.count?.() ?? 0, deleted: 0, recycledBytes: 0, retained: {} }
  const retain = (reason: string): void => { summary.retained[reason] = (summary.retained[reason] ?? 0) + 1 }
  options.log('start', summary)
  try {
    if (!options.providers.length) throw new Error('No media reference providers')
    const references = new Set<string>()
    const canonicalize = createPathCanonicalizer()
    const trashed = new Set<string>()
    for (const provider of options.providers) {
      signal.throwIfAborted()
      const controller = new AbortController()
      const cancel = (): void => controller.abort(signal.reason)
      signal.addEventListener('abort', cancel, { once: true })
      let timer: ReturnType<typeof setTimeout> | undefined
      try {
        const paths = await Promise.race([
          provider.collect(controller.signal),
          new Promise<never>((_, reject) => {
            controller.signal.addEventListener('abort', () => reject(controller.signal.reason ?? new Error('Reference collection cancelled')), { once: true })
            timer = setTimeout(() => { controller.abort(); reject(new Error(`Provider timeout: ${provider.id}`)) }, options.providerTimeoutMs ?? 120_000)
          }),
        ])
        for (const value of paths) {
          signal.throwIfAborted()
          const key = await canonicalize(value)
          if (key) references.add(key)
        }
      } catch (error) { if (!signal.aborted) retain(`provider:${provider.id}`); throw error }
      finally { clearTimeout(timer); signal.removeEventListener('abort', cancel) }
    }
    signal.throwIfAborted()
    options.referencesReady?.(references)
    const roots = await Promise.all((await options.roots()).map(async root => await canonicalPath(root)))
    signal.throwIfAborted()
    for await (const candidate of options.store.candidates()) {
      await yieldToIO()
      signal.throwIfAborted()
      if (!options.store.count) summary.candidates++
      const protectors = await Promise.all((candidate.protectedBy ?? []).map(canonicalPath))
      if (protectors.some(key => key && references.has(key))) { retain('referenced'); continue }
      // 有任何一个文件留下，整条候选原地不动，下次启动重新普查。
      let kept = false
      for (const value of candidate.paths) {
        signal.throwIfAborted()
        try {
          const local = localMediaPath(value)
          const key = await canonicalize(value)
          if (!local || !key || !roots.some(root => root && within(root, key))) { retain('external'); continue }
          if (trashed.has(key)) continue
          const sources = await Promise.all((candidate.derivedFrom?.[value] ?? []).map(canonicalize))
          if (references.has(key) || references.has(options.store.protector?.(key) ?? '') || sources.some(source => source && references.has(source))) { retain('referenced'); kept = true; continue }
          const expected = options.store.identity(key)
          if (!expected) { retain('unowned'); continue }
          // 缓存只加速候选筛选，真正回收前重新解析别名和派生源，避免目录链接变化导致误删。
          const currentKey = await canonicalPath(value)
          const currentSources = await Promise.all((candidate.derivedFrom?.[value] ?? []).map(canonicalPath))
          if (currentKey !== key) { retain('identity-changed'); kept = true; continue }
          if (currentSources.some(source => source && references.has(source))) { retain('referenced'); kept = true; continue }
          const stat = await fs.lstat(local)
          if (!stat.isFile() || stat.isSymbolicLink() || fileIdentity(stat) !== expected) { retain('identity-changed'); kept = true; continue }
          signal.throwIfAborted()
          if (options.claimed?.(local) || options.claimed?.(key)) { retain('claimed'); kept = true; continue }
          await options.trashItem(local)
          trashed.add(key)
          summary.deleted++
          summary.recycledBytes += stat.size
        } catch (error) {
          if (signal.aborted) throw signal.reason
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') { kept = true; retain('delete-failed') }
        }
      }
      signal.throwIfAborted()
      if (!kept) options.store.forget(candidate.id)
    }
    options.log('completed', summary)
  } catch (error) {
    if (error === signal.reason && error instanceof MediaRecycleStopped) options.log('deferred', summary)
    else options.log('failed', summary, error)
  }
  return summary
}
