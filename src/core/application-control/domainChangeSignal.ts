export type ApplicationDomainChangeScope = 'assets' | 'canvas' | 'camera_stage'

const revisions: Record<ApplicationDomainChangeScope, number> = { assets: 0, canvas: 0, camera_stage: 0 }
const listeners = new Set<(scope: ApplicationDomainChangeScope) => void>()

/** 由领域在权威状态发生变化时发出；不能把通知当作保存成功的回执。 */
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
