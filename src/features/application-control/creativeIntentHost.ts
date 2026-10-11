import type { ApplicationRef } from '@/core/application-control'
import type { MotionDraft } from '@/core/creativeIntent/contracts'
import type { MotionIntent } from '@/core/creativeIntent/recipe'
import type { CreativeIntents, StoredCreativeIntentResource } from '@/core/creativeIntent/persistence'
export type IntentDomain = 'video_edit' | 'image_edit'
export type IntentEntity = 'intent_draft' | 'intent_take' | 'intent_pin' | 'intent_candidate'
export const INTENT_ENTITIES: readonly IntentEntity[] = ['intent_draft', 'intent_take', 'intent_pin', 'intent_candidate']
export function intentRef(documentRef: ApplicationRef, type: IntentEntity, draftId: string, childId?: string): ApplicationRef {
  return { kind: `${documentRef.kind.split('.')[0]}.${type}`, id: `${documentRef.id}:${encodeURIComponent(draftId)}${childId === undefined ? '' : `:${encodeURIComponent(childId)}`}` }
}
export function splitIntentRef(ref: ApplicationRef) {
  const domain = ref.kind.split('.')[0] as IntentDomain
  if (!['video_edit', 'image_edit'].includes(domain)) throw new Error('请使用超级关键帧目录返回的完整引用。')
  const parts = ref.id.split(':'); const count = domain === 'image_edit' ? 2 : 1
  const expectedParts = count + (ref.kind === `${domain}.intent_draft` ? 1 : 2)
  if (!INTENT_ENTITIES.some(type => ref.kind === `${domain}.${type}`) || parts.length !== expectedParts || parts.some(part => !part)) throw new Error('草稿或子项引用无效，请重新读取目录。')
  return { domain, documentRef: { kind: `${domain}.document`, id: parts.slice(0, count).join(':') }, draftId: decodeURIComponent(parts[count]), childId: parts[count + 1] === undefined ? undefined : decodeURIComponent(parts[count + 1]) }
}

export interface CreativeIntentHost {
  documentRef: ApplicationRef; owner: object; assertCurrent(): void
  size(): [number, number]; selected(draft: MotionDraft): string | undefined
  checkpoint(): () => () => Promise<void>
  read(): CreativeIntents; commit(head: CreativeIntents): void; save(): Promise<void>
  prepare(draft: MotionDraft): Promise<void>
  configure(values: { fidelity?: number; pinSampleId?: string; unpinId?: string; selectedTakeIds?: string[] }): Promise<void>
  optimize(signal?: AbortSignal): Promise<void>; select(resourceId: string): Promise<void>; apply(): Promise<void>
}
export interface CreativeIntentHostProvider {
  domain: IntentDomain; documents(): ApplicationRef[]; revisions(): Record<string, number>
  open(ref: ApplicationRef): CreativeIntentHost
  readResource(resource: StoredCreativeIntentResource): Promise<unknown>
  digest(value: unknown): Promise<string>
  configureMotion?(id: string, values: { intent: MotionIntent; selectedTakeIds: string[] }): Promise<void>
}
const providers = new Map<IntentDomain, CreativeIntentHostProvider>()
export function registerCreativeIntentHost(provider: CreativeIntentHostProvider): void { providers.set(provider.domain, provider) }
export function intentProvider(domain: IntentDomain): CreativeIntentHostProvider { const provider = providers.get(domain); if (!provider) throw new Error('原稿宿主尚未就绪'); return provider }
export function intentRevisions(domain: IntentDomain): Record<string, number> { return intentProvider(domain).revisions() }
export function intentDocuments(domain: IntentDomain): ApplicationRef[] { return intentProvider(domain).documents() }
export function intentHost(ref: ApplicationRef): CreativeIntentHost { return intentProvider(ref.kind.split('.')[0] as IntentDomain).open(ref) }
export function intentRecord(ref: ApplicationRef) {
  const identity = splitIntentRef(ref), host = intentHost(identity.documentRef), head = host.read()
  const draft = head.drafts.find(d => d.id === identity.draftId)
  if (!draft) throw new Error('原稿已不存在，请重新读取超级关键帧目录。')
  const item = ref.kind.endsWith('intent_take') ? draft.takes.find(t => t.id === identity.childId) : ref.kind.endsWith('intent_pin') ? draft.pins.find(p => p.id === identity.childId) : ref.kind.endsWith('intent_candidate') ? draft.candidateRefs.find(c => c.resourceId === identity.childId) : draft
  if (!item) throw new Error('原稿子项已变化，请重新读取候选、示范或钉住点。')
  return { ...identity, host, head, draft, item, ref }
}
