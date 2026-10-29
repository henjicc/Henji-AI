import type { ApplicationRef } from '@/core/application-control'
import { onExplanationBodyErased } from '@/core/creativeIntent/semanticIntentEdits'

const privateUndos = new Map<string, { refs: ApplicationRef[]; release: () => void }>()
export function forgetExplanationUndoAccess(undoRef: string): void {
  const record = privateUndos.get(undoRef)
  privateUndos.delete(undoRef)
  record?.release()
}
/** Called only with the actual generic transaction's undoRef and original targets. */
export function rememberExplanationUndoAccess(undoRef: string, refs: readonly ApplicationRef[], release: () => void): void {
  const bodies = refs.filter(ref => ref.kind.endsWith('.explanation_body'))
  if (bodies.length) privateUndos.set(undoRef, { refs: structuredClone(bodies), release })
  while (privateUndos.size > 256) {
    const oldest = privateUndos.keys().next().value
    if (oldest === undefined) break
    forgetExplanationUndoAccess(oldest)
  }
}
onExplanationBodyErased(ref => {
  for (const [undoRef, { refs }] of privateUndos) if (refs.some(body => body.kind === ref.kind && body.id === ref.id)) forgetExplanationUndoAccess(undoRef)
})
