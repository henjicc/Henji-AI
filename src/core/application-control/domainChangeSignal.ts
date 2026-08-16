export type ApplicationDomainChangeScope = 'assets'

const revisions: Record<ApplicationDomainChangeScope, number> = { assets: 0 }
const listeners = new Set<(scope: ApplicationDomainChangeScope) => void>()

/** 由领域唯一写入口在真实持久化成功后发出；失败操作不得推进。 */
export function notifyApplicationDomainChanged(scope: ApplicationDomainChangeScope): void {
  revisions[scope] += 1
  for (const listener of listeners) listener(scope)
}

export function getApplicationDomainChangeRevision(scope: ApplicationDomainChangeScope): number {
  return revisions[scope]
}

export function subscribeApplicationDomainChanges(
  listener: (scope: ApplicationDomainChangeScope) => void,
): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
