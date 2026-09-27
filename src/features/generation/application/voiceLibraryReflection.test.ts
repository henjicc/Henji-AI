import { describe, expect, it, vi } from 'vitest'
import { ApplicationReflectionRegistry, ApplicationControlExecutionEngine } from '@/core/application-control'
import { APPLICATION_CAPABILITY_CATALOG_VERSION } from '@/core/application-control/applicationCapabilities'
import { voiceLibraryService } from '@/services/voiceLibrary/VoiceLibraryService'
import { createVoiceLibraryReflectionRegistration, VoiceLibraryCollectionExecutor } from './voiceLibraryReflection'

vi.mock('@/services/database/DatabaseService', () => ({ databaseService: { init: vi.fn(), getSetting: vi.fn().mockResolvedValue(null), setSetting: vi.fn().mockResolvedValue(undefined) } }))

describe('voice library application reflection', () => {
  it('discovers, reads, removes and restores the same persisted voice through the generic transaction engine', async () => {
    const voice = { providerId: 'volcengine-speech', modelId: 'voice-model', voiceId: 'henjiVoiceFixture', voiceName: '解说声音', status: 'ready' as const, previewPath: 'C:/private/preview.mp3' }
    await voiceLibraryService.upsertVoice(voice)
    const registry = new ApplicationReflectionRegistry(APPLICATION_CAPABILITY_CATALOG_VERSION)
    registry.register(createVoiceLibraryReflectionRegistration())
    const context = { requestId: 'fixture', exposure: 'assistant' as const, permissions: new Set(['generation:read', 'generation:write']), acceptedDataClasses: new Set(['C0', 'C1'] as const) }
    expect(registry.describe({ entityTypes: ['generation.voice'] }, context).entities).toHaveLength(1)
    const listed = await registry.listEntities('generation.voice', { limit: 20 }, context)
    const ref = listed.refs[0]
    const before = await registry.readEntity(ref, undefined, context)
    expect(before.properties).toMatchObject({ 'generation.voice.voice_id': voice.voiceId, 'generation.voice.status': 'ready' })
    expect(JSON.stringify(before)).not.toContain(voice.previewPath)
    const noPermission = await registry.readEntity(ref, undefined, { ...context, permissions: new Set() })
    expect(noPermission.properties).toEqual({})
    const engine = new ApplicationControlExecutionEngine(registry, { now: () => new Date(), createOpaqueRef: kind => `${kind}:${crypto.randomUUID()}` })
    engine.registerCollectionExecutor(new VoiceLibraryCollectionExecutor())
    const plan = await engine.plan({ summary: '移除本地音色', transactionMode: 'compensatable', steps: [{
      kind: 'collection', parent: { kind: 'generation.model', id: voice.modelId }, entityType: 'generation.voice', expectedRevisions: before.revisions, operation: { kind: 'remove', targets: [ref] },
    }] }, context)
    const removed = await engine.commit({ planRef: plan.planRef, expectedRevisions: before.revisions, idempotencyKey: 'remove-voice-fixture-001' }, context)
    expect(removed.status).toBe('completed')
    expect(await voiceLibraryService.listVoices()).toHaveLength(0)
    if (removed.status !== 'completed' || !removed.undoRef) throw new Error('undo missing')
    const restored = await engine.undo({ undoRef: removed.undoRef, expectedRevisions: removed.resultingRevisions, idempotencyKey: 'restore-voice-fixture-001' }, context)
    expect(restored.status).toBe('completed')
    expect((await registry.readEntity(ref, undefined, context)).properties['generation.voice.voice_id']).toBe(voice.voiceId)
  })
})
