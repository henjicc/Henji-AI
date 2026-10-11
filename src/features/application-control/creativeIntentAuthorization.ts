import { z } from 'zod'
import type { ApplicationCallerGrant } from '@/core/application-control/callerContext'
import { CREATIVE_INTENT_CAPABILITIES } from '@/core/application-control/domains/creativeIntent/creativeIntentCapabilities'
import { applicationRefSchema } from '@/core/application-control/identifiers'
import { intentHost, intentRecord } from './creativeIntentHost'
import { explanationBodyRecord } from './creativeIntentExplanation'
import type { ApplicationRef } from '@/core/application-control'
import { onExplanationBodyErased } from '@/core/creativeIntent/semanticIntentEdits'

const privateUndos = new Map<string, ApplicationRef[]>()
/** Called only with the actual generic transaction's undoRef and original targets. */
export function rememberExplanationUndoAccess(undoRef: string, refs: readonly ApplicationRef[]): void {
  const bodies = refs.filter(ref => ref.kind.endsWith('.explanation_body'))
  if (bodies.length) privateUndos.set(undoRef, structuredClone(bodies))
}
onExplanationBodyErased(ref => {
  for (const [undoRef, refs] of privateUndos) if (refs.some(body => body.kind === ref.kind && body.id === ref.id)) privateUndos.delete(undoRef)
})

/** Connection permissions and resource consent are independent, conjunctive checks. */
export function creativeIntentPrivateAccess(capabilityId: string, input: unknown): ApplicationCallerGrant['privateAccess'] {
  if (['describe_application_entities', 'list_application_entities'].includes(capabilityId)) {
    const request = z.object({ entityType: z.string().optional(), entityTypes: z.array(z.string()).optional() }).passthrough().parse(input)
    const types = request.entityTypes ?? (request.entityType ? [request.entityType] : [])
    if (!types.length || !types.every(type => ['video_edit.explanation_body', 'image_edit.explanation_body'].includes(type))) return undefined
    // Discovery returns only descriptors and stable references. A separate read/write
    // invocation still needs the actual session's consent; this grant is never reused.
    return { assertCurrent: () => {} }
  }
  if (capabilityId === 'undo_application_changes') {
    const { undoRef } = z.object({ undoRef: z.string() }).parse(input), refs = privateUndos.get(undoRef)
    if (!refs) return undefined
    return creativeIntentPrivateAccess('change_application_entities', { changes: refs.map(target => ({ target })) })
  }
  if (['read_application_entity', 'change_application_entities'].includes(capabilityId)) {
    const request = z.object({ ref: applicationRefSchema.optional(), changes: z.array(z.object({ target: applicationRefSchema.optional(), entityType: z.string().optional() }).passthrough()).optional() }).passthrough().parse(input)
    const refs = [request.ref, ...request.changes?.map(change => change.target) ?? []].filter((ref): ref is NonNullable<typeof ref> => Boolean(ref?.kind.endsWith('.explanation_body')))
    if (!refs.length) return undefined
    if (request.changes?.some(change => !change.target?.kind.endsWith('.explanation_body') || change.entityType && change.entityType !== change.target.kind)) throw new Error('PERMISSION_DENIED:私密讲解修改必须使用一致的正文引用并单独提交。')
    const sessions = refs.map(ref => { const record = explanationBodyRecord(ref); if (!record.session.consent?.textUpload) throw new Error('PERMISSION_DENIED:请先在讲解面板确认文字外发。'); return { ref, digest: record.session.sourceDigest, consent: JSON.stringify(record.session.consent) } })
    return { assertCurrent: () => { for (const baseline of sessions) {
      const record = explanationBodyRecord(baseline.ref); record.host.assertCurrent()
      if (record.session.sourceDigest !== baseline.digest || JSON.stringify(record.session.consent) !== baseline.consent) throw new Error('PERMISSION_DENIED:讲解外发授权已变化。')
    } } }
  }
  const capability = CREATIVE_INTENT_CAPABILITIES.find(value => value.id === capabilityId && value.dataClasses.includes('C2'))
  if (!capability) return undefined
  const parsed = z.object({ documentRef: applicationRefSchema.optional(), draftRef: applicationRefSchema.optional(), sessionId: z.string() }).parse(input)
  const host = parsed.documentRef ? intentHost(parsed.documentRef) : parsed.draftRef ? intentRecord(parsed.draftRef).host : undefined
  if (!host || host.documentRef.kind !== `${capability.domain}.document`) throw new Error('PERMISSION_DENIED:讲解必须来自目标原稿的文档。')
  const session = host.read().sessions.find(value => value.id === parsed.sessionId)
  if (!session?.consent?.textUpload) throw new Error('PERMISSION_DENIED:请先在录制宿主确认讲解文字外发。')
  const baseline = JSON.stringify(session)
  return { assertCurrent: () => {
    host.assertCurrent()
    if (JSON.stringify(host.read().sessions.find(value => value.id === parsed.sessionId)) !== baseline) {
      throw new Error('PERMISSION_DENIED:讲解或授权已变化，请重新读取授权范围。')
    }
  } }
}
