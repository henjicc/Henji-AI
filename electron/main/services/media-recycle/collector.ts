import fs from 'node:fs/promises'
import { setImmediate as yieldToIO } from 'node:timers/promises'
import { canonicalPath, fileIdentity, localMediaPath, within } from './paths'

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
  freedBytes: number
  retained: Record<string, number>
}
export interface MediaCollectorOptions {
  store: RecycleStore
  roots(): Promise<string[]>
  providers: readonly MediaReferenceProvider[]
  /** Rechecked immediately before unlink; persistent writes invalidate a scan. */
  revision(): string
  log(phase: 'start' | 'completed' | 'failed', summary: RecycleSummary, error?: unknown): void
  providerTimeoutMs?: number
}

/** Mark all roots before sweeping. Failure is NOT an empty reference set. */
export async function collectUnreferencedMedia(options: MediaCollectorOptions, signal: AbortSignal): Promise<RecycleSummary> {
  const summary: RecycleSummary = { candidates: options.store.count?.() ?? 0, deleted: 0, freedBytes: 0, retained: {} }
  const retain = (reason: string): void => { summary.retained[reason] = (summary.retained[reason] ?? 0) + 1 }
  options.log('start', summary)
  try {
    if (!options.providers.length) throw new Error('No media reference providers')
    let revision = options.revision()
    const references = new Set<string>()
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
          const key = await canonicalPath(value)
          if (key) references.add(key)
        }
      } catch (error) { retain(`provider:${provider.id}`); throw error }
      finally { clearTimeout(timer); signal.removeEventListener('abort', cancel) }
    }
    const roots = await Promise.all((await options.roots()).map(async root => await canonicalPath(root)))
    for await (const candidate of options.store.candidates()) {
      signal.throwIfAborted()
      if (!options.store.count) summary.candidates++
      const protectors = await Promise.all((candidate.protectedBy ?? []).map(canonicalPath))
      if (protectors.some(key => key && references.has(key))) { retain('referenced'); continue }
      let kept = false
      for (const value of candidate.paths) {
        await yieldToIO()
        signal.throwIfAborted()
        if (revision !== options.revision()) { retain('changed-during-scan'); kept = true; break }
        try {
          const local = localMediaPath(value)
          const key = await canonicalPath(value)
          if (!local || !key || !roots.some(root => root && within(root, key))) { retain('external'); continue }
          const sources = await Promise.all((candidate.derivedFrom?.[value] ?? []).map(canonicalPath))
          if (references.has(key) || references.has(options.store.protector?.(key) ?? '') || sources.some(source => source && references.has(source))) { retain('referenced'); kept = true; continue }
          const expected = options.store.identity(key)
          if (!expected) { retain('unowned'); continue }
          const stat = await fs.lstat(local)
          if (!stat.isFile() || stat.isSymbolicLink() || fileIdentity(stat) !== expected) { retain('identity-changed'); kept = true; continue }
          signal.throwIfAborted()
          // No awaits between final revision check and submitting the filesystem unlink.
          if (revision !== options.revision()) { retain('changed-during-scan'); kept = true; break }
          await fs.unlink(local)
          summary.deleted++
          summary.freedBytes += stat.size
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') { kept = true; retain('delete-failed') }
        }
      }
      signal.throwIfAborted()
      if (!kept) {
        if (revision !== options.revision()) { retain('changed-during-scan'); continue }
        options.store.forget(candidate.id)
        revision = options.revision()
      }
    }
    options.log('completed', summary)
  } catch (error) { options.log('failed', summary, error) }
  return summary
}
