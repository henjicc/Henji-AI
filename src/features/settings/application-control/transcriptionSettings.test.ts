// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RuntimeContext } from '@henjicc/ai-sdk'
import { createTimestampedAsrService } from '../../../../electron/main/services/audio-edit/timestamped-asr'
import { applicationReflectionHandlers } from '@/features/application-control/capabilities/applicationReflectionAdapter'
import { modelDefaultsManager, ModelDefaultsManager } from '../modelDefaultsManager'
import { useSettingsStore } from '@/stores/settingsStore'
import { applyApplicationSettingsChange, getSettingsRegistryRevision, planApplicationSettingsChange } from './settingsApplicationService'

vi.mock('../../../../electron/main/services/keystore', () => ({ getAiProviderApiKey: () => undefined }))
vi.mock('../../../../electron/main/services/logging', () => ({ createMainLogger: () => ({ info: vi.fn(), error: vi.fn() }) }))
vi.mock('../../../../electron/main/services/ai-runtime/sdk-runtime', () => ({ sdkRuntimeContext: { transport: { fetch: async () => { throw new Error('REAL_NETWORK_FORBIDDEN') } }, credentials: { get: () => undefined } } }))

describe('默认转写模型的正式通用设置链路', () => {
  let original: ReturnType<typeof modelDefaultsManager.getSnapshot>
  let keys: Record<string, boolean>
  beforeEach(() => {
    original = modelDefaultsManager.getSnapshot()
    keys = useSettingsStore.getState().providerKeyStatus
    useSettingsStore.getState().setProviderKeyStatuses({ ...keys, bailian: true })
  })
  afterEach(() => {
    modelDefaultsManager.setDefaultModel('transcription', '')
    modelDefaultsManager.setProvider(original.providerId)
    if (original.models.transcription) modelDefaultsManager.setDefaultModel('transcription', original.models.transcription)
    useSettingsStore.getState().setProviderKeyStatuses(keys)
  })
  const context = (requestId: string) => ({ requestId, signal: new AbortController().signal, expectedRevisions: { settings: getSettingsRegistryRevision() } })
  it('describe → change → read → 原管理器重开，UI 真相源与候选一致', async () => {
    const ref = { kind: 'settings.registry', id: 'singleton' }
    const propertyId = 'transcription.default_model'
    const modelId = 'bailian.speech-recognition.qwen3-asr-flash-filetrans'
    const described = await applicationReflectionHandlers.describeEntities({ domains: ['settings'], entityTypes: [], refs: [ref] }, context('describe-transcription'))
    expect(described.propertyAvailability[0]?.properties).toContainEqual(expect.objectContaining({ propertyId, writable: true }))
    await applicationReflectionHandlers.changeEntities({ summary: '选择默认转写模型', changes: [{ kind: 'set_properties', target: ref, entityType: ref.kind, properties: { [propertyId]: modelId } }] }, context('change-transcription'))
    const read = await applicationReflectionHandlers.readEntity({ ref, propertyIds: [propertyId] }, context('read-transcription'))
    expect(read.properties[propertyId]).toBe(modelId)
    expect(modelDefaultsManager.getSnapshot().models.transcription).toBe(modelId)
    expect(modelDefaultsManager.listTranscriptionModels().some((entry) => entry.descriptor.id === modelId)).toBe(true)
    const reopened = new ModelDefaultsManager(localStorage)
    expect(reopened.resolveTranscriptionModelId()).toBe(modelId)
    const fetch = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes('/uploads?action=getPolicy')) return new Response(JSON.stringify({ data: { upload_host: 'https://oss.invalid/', upload_dir: 'tmp/fixture', policy: 'fixture', signature: 'fixture', oss_access_key_id: 'fixture', x_oss_object_acl: 'private', x_oss_forbid_overwrite: 'true', max_file_size_mb: 10 } }))
      if (url.endsWith('/services/audio/asr/transcription')) {
        const body = JSON.parse(String(init?.body)) as { model: string; parameters: { enable_words: boolean } }
        expect(body.model).toBe('qwen3-asr-flash-filetrans')
        expect(body.parameters.enable_words).toBe(true)
        return new Response(JSON.stringify({ output: { task_id: 'settings-fixture', task_status: 'SUCCEEDED', results: [{ subtask_status: 'SUCCEEDED', transcription_url: 'https://result.invalid/' }] } }))
      }
      if (url === 'https://result.invalid/') return new Response(JSON.stringify({ transcripts: [{ sentences: [{ text: '好', begin_time: 0, end_time: 500, words: [{ text: '好', begin_time: 0, end_time: 500 }] }] }] }))
      throw new Error(`UNEXPECTED_FIXTURE_REQUEST:${url}`)
    })
    const runtime: RuntimeContext = { credentials: { get: () => 'fixture-key' }, transport: { fetch, uploadFile: async () => new Response('', { status: 200 }) }, media: { read: async () => { throw new Error('必须使用本地流式上传') } } }
    const service = createTimestampedAsrService(runtime, (providerId) => useSettingsStore.getState().providerKeyStatus[providerId] === true)
    const plan = service.prepare({ modelId: reopened.resolveTranscriptionModelId(), audioPath: 'recording.wav', durationMs: 500 })
    // 设置随后改变也不能切换已经开始的收费模型。
    modelDefaultsManager.setDefaultModel('transcription', 'bailian.speech-recognition.fun-asr')
    expect(await service.execute(plan, context('execute-transcription'))).toMatchObject({ unit: 'ms', granularity: 'character', words: [{ text: '好', startMs: 0, endMs: 500 }] })
  })
  it('通用主供应商修改为转写清空提供 cascade；事务失败恢复原选择', async () => {
    const ref = { kind: 'settings.registry', id: 'singleton' }
    const modelId = 'bailian.speech-recognition.fun-asr'
    modelDefaultsManager.setDefaultModel('transcription', modelId)
    const nextProvider = original.providerId === 'fal' ? 'kie' : 'fal'
    await expect(applicationReflectionHandlers.changeEntities({ summary: '供应商与无效模型', changes: [{ kind: 'set_properties', target: ref, entityType: ref.kind, properties: { 'general.primary_provider': nextProvider, 'transcription.default_model': 'bailian.speech-recognition.qwen3-asr-flash' } }] }, context('invalid-transcription'))).rejects.toThrow()
    expect(modelDefaultsManager.getSnapshot().models.transcription).toBe(modelId)
    const result = await applicationReflectionHandlers.changeEntities({ summary: '更换供应商', changes: [{ kind: 'set_properties', target: ref, entityType: ref.kind, properties: { 'general.primary_provider': nextProvider } }] }, context('provider-cascade-transcription'))
    expect(JSON.stringify(result)).toContain('transcription.default_model')
    expect(modelDefaultsManager.getSnapshot().models.transcription).toBe('')
  })
  it('凭据撤销后，失败事务和供应商切换撤销都保留原显式失效选择', async () => {
    const ref = { kind: 'settings.registry', id: 'singleton' }
    const modelId = 'bailian.speech-recognition.fun-asr'
    modelDefaultsManager.setDefaultModel('transcription', modelId)
    useSettingsStore.getState().setProviderKeyStatuses({ ...keys, bailian: false })
    const nextProvider = original.providerId === 'fal' ? 'kie' : 'fal'
    await expect(applicationReflectionHandlers.changeEntities({ summary: '失效选择下失败事务', changes: [{ kind: 'set_properties', target: ref, entityType: ref.kind, properties: { 'general.primary_provider': nextProvider, 'transcription.default_model': 'bailian.speech-recognition.qwen3-asr-flash-filetrans' } }] }, context('inactive-transcription-rollback'))).rejects.toThrow()
    expect(modelDefaultsManager.getSnapshot()).toMatchObject({ providerId: original.providerId, models: { transcription: modelId } })
    const plan = planApplicationSettingsChange([{ id: 'general.primary_provider', value: nextProvider }])
    const changed = applyApplicationSettingsChange(plan.planRef)
    expect(modelDefaultsManager.getSnapshot().models.transcription).toBe('')
    applyApplicationSettingsChange(changed.undoRef)
    expect(modelDefaultsManager.getSnapshot().models.transcription).toBe(modelId)
    expect(() => modelDefaultsManager.resolveTranscriptionModelId()).toThrow('ASR_MODEL_UNAVAILABLE')
  })
})
