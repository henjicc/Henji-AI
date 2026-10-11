import * as controlRegistry from './capabilities/applicationControlRegistry'
import { applicationReflectionHandlers } from './capabilities/applicationReflectionAdapter'
import { APPLICATION_CAPABILITY_CATALOG_VERSION } from '@/core/application-control/applicationCapabilities'
import { webcrypto } from 'node:crypto'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ApplicationControlExecutionEngine, ApplicationReflectionRegistry, type ApplicationExecutionContext } from '@/core/application-control'
import { explanationSessionSchema } from '@/core/creativeIntent/schema'
import { eraseExplanationBody, explanationBodyRef, registerExplanationBodyEditor } from '@/core/creativeIntent/semanticIntentEdits'
import { recordingFixtureSession } from '@/core/creativeIntent/fixtures/recordingFixtures'
import type { CreativeIntents } from '@/core/creativeIntent/persistence'
import { applicationCallerAccess, createApplicationCallerGrant } from '@/core/application-control/callerContext'
import { registerCreativeIntentHost } from './creativeIntentHost'
import { creativeExplanationRegistration, CreativeExplanationMutationExecutor } from './creativeIntentExplanation'
import { creativeIntentPrivateAccess } from './creativeIntentAuthorization'

beforeEach(() => { vi.stubGlobal('crypto', webcrypto) })
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })
it.each(['video_edit', 'image_edit'] as const)('%s 私密正文经统一授权、通用事务修改与一次撤销；删除后旧回执不可恢复', async domain => {
  const documentRef = { kind: `${domain}.document`, id: domain === 'image_edit' ? 'v3:private-image' : 'private-video' }
  const session = explanationSessionSchema.parse({ ...recordingFixtureSession(domain === 'image_edit' ? 'static' : 'animated'), ownerRef: { kind: domain === 'image_edit' ? 'image_edit.document' : 'document.video_edit', id: documentRef.id }, state: 'reviewing' })
  let head: CreativeIntents = { drafts: [], sessions: [session], resources: [] }, revision = 1
  const ref = explanationBodyRef(documentRef, session.id), registry = new ApplicationReflectionRegistry(APPLICATION_CAPABILITY_CATALOG_VERSION)
  const readResource = vi.fn(async () => { throw new Error('private page must not be read without consent') })
  const host = { documentRef, owner: {}, assertCurrent: () => {}, size: (): [number, number] => [1920, 1080], selected: () => undefined,
    checkpoint: () => () => async () => {}, read: () => head, commit: (next: CreativeIntents) => { head = next; revision++ }, save: async () => {}, prepare: async () => {}, configure: async () => {}, optimize: async () => {}, select: async () => {}, apply: async () => {}, recoverApplication: async () => {} }
  registerCreativeIntentHost({ domain, documents: () => [documentRef], revisions: () => ({ [domain]: revision }), open: () => host, readResource, digest: async () => session.sourceDigest })
  registry.register(creativeExplanationRegistration(domain))
  const engine = new ApplicationControlExecutionEngine(registry), executor = new CreativeExplanationMutationExecutor(domain)
  engine.registerMutationExecutor(executor)
  const release = registerExplanationBodyEditor(ref, {
    apply: async changes => { head = { ...head, sessions: [{ ...head.sessions[0], bindings: changes.bindings ?? head.sessions[0].bindings }] }; revision++ },
    restore: async before => { if (!head.sessions.some(s => s.id === before.id)) throw new Error('讲解已删除'); head = { ...head, sessions: [structuredClone(before)] }; revision++ },
  })
  const changes = [{ kind: 'set_properties', target: ref, properties: { [`${domain}.explanation_body.bindings`]: [] } }]
  try {
    expect(() => creativeIntentPrivateAccess('change_application_entities', { changes })).toThrow('PERMISSION_DENIED')
    expect(creativeIntentPrivateAccess('list_application_entities', { entityType: ref.kind })).toBeDefined()
    session.consent!.textUpload = true
    expect(() => creativeIntentPrivateAccess('change_application_entities', { changes: [{ ...changes[0], entityType: `${domain}.intent_draft` }] })).toThrow('PERMISSION_DENIED')
    const grant = createApplicationCallerGrant({ callerId: 'test', capabilityIds: ['change_application_entities'], permissions: [`${domain}:read`, `${domain}:write`], allowWrites: true, allowDestructive: false, privateAccess: creativeIntentPrivateAccess('change_application_entities', { changes }) })
    const context = applicationCallerAccess(grant, 'private-edit', new AbortController().signal)
    const before = structuredClone(head.sessions[0])
    const binding = { id: 'reference', utteranceIds: ['u'], wordIds: [], targetRefs: [], point: [.5, .5], evidenceSeqs: [], timelineSpans: [], confidence: 'confirmed', correctedByUser: true }
    const step = { kind: 'mutation' as const, target: ref, entityType: ref.kind, expectedRevisions: { [domain]: revision }, mutations: [{ propertyId: `${domain}.explanation_body.bindings`, operation: 'set' as const, value: [binding] }] }
    const denied: ApplicationExecutionContext = { ...context, acceptedDataClasses: new Set(['C0', 'C1']) }
    await expect(registry.readEntity(ref, undefined, denied)).rejects.toThrow('PERMISSION_DENIED')
    expect(readResource).not.toHaveBeenCalled()
    await expect(engine.plan({ summary: '校正讲解', transactionMode: 'atomic', steps: [step] }, denied)).rejects.toThrow('PERMISSION_DENIED')
    const plan = await engine.plan({ summary: '校正讲解', transactionMode: 'atomic', steps: [step] }, context)
    const result = await engine.commit({ planRef: plan.planRef, expectedRevisions: { [domain]: revision }, idempotencyKey: 'private-edit-once' }, context)
    expect(result.status).toBe('completed')
    if (result.status !== 'completed' || !result.undoRef) throw new Error(JSON.stringify(result))
    expect(head.sessions[0].bindings).toEqual([binding])
    expect((await registry.readEntity(ref, [`${domain}.explanation_body.bindings`], context)).properties).toMatchObject({ [`${domain}.explanation_body.bindings`]: [binding] })
    const undone = await engine.undo({ undoRef: result.undoRef, expectedRevisions: { [domain]: revision }, idempotencyKey: 'private-undo-once' }, context)
    expect(undone.status).toBe('completed'); expect(head.sessions[0]).toEqual(before)
    vi.spyOn(controlRegistry, 'getApplicationControlExecutionEngine').mockReturnValue(engine)
    vi.spyOn(controlRegistry, 'getApplicationReflectionRegistry').mockReturnValue(registry)
    const mutation = { kind: 'set_properties' as const, target: ref, entityType: ref.kind, properties: { [`${domain}.explanation_body.bindings`]: [binding] } }
    const applied = await applicationReflectionHandlers.changeEntities({ summary: '通过公共入口校正', changes: [mutation] }, { callerGrant: grant, requestId: 'public-edit', signal: new AbortController().signal })
    if (!applied.undoRef) throw new Error('missing public undo receipt')
    expect(creativeIntentPrivateAccess('undo_application_changes', { undoRef: applied.undoRef })).toBeDefined()
    head = { ...head, sessions: [] }
    eraseExplanationBody(ref)
    expect(creativeIntentPrivateAccess('undo_application_changes', { undoRef: applied.undoRef })).toBeUndefined()
    const failed = await engine.undo({ undoRef: applied.undoRef, expectedRevisions: { [domain]: revision }, idempotencyKey: 'private-deleted-undo' }, context)
    expect(failed.status).toBe('failed'); expect(head.sessions).toEqual([])
  } finally { release() }
})
