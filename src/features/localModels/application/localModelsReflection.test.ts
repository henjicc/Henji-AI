// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest'

import { createApplicationCallerGrant } from '@/core/application-control/callerContext'
import type { LocalModelDownloadSource, LocalModelInfo, LocalModelsState } from '@/platform/contracts/localModels'

import { applicationReflectionHandlers } from '../../application-control/capabilities/applicationReflectionAdapter'

/** 假的主进程服务：真相源只有这里，断言一律从它读。 */
const fake = vi.hoisted(() => ({
  revision: 1,
  downloadSource: 'auto' as LocalModelDownloadSource,
  ready: new Set<string>(),
  calls: [] as string[],
}))

function model(id: LocalModelInfo['id'], status: LocalModelInfo['status']): LocalModelInfo {
  return { id, title: { zh: id, en: id }, purpose: { zh: '用途', en: 'purpose' }, license: 'MIT', sizeBytes: 1_000_000, status, progress: null, lastFailure: null }
}

function state(): LocalModelsState {
  return {
    revision: fake.revision,
    downloadSource: fake.downloadSource,
    models: [
      model('face_detection_yunet', fake.ready.has('face_detection_yunet') ? 'ready' : 'not_downloaded'),
      model('object_tracking_efficienttam', 'unavailable'),
    ],
  }
}

vi.mock('@/platform', () => ({ getPlatform: () => ({ localModels: {
  getState: async () => state(),
  ensure: async (id: string) => { fake.calls.push(`ensure:${id}`); fake.ready.add(id); fake.revision += 1; return { id, directory: 'x', files: [] } },
  remove: async (id: string) => { fake.calls.push(`remove:${id}`); fake.ready.delete(id); fake.revision += 1 },
  setDownloadSource: async (source: LocalModelDownloadSource) => { fake.downloadSource = source; fake.revision += 1 },
  onProgress: () => () => undefined,
} }) }))

beforeEach(() => {
  fake.revision = 1
  fake.downloadSource = 'auto'
  fake.ready.clear()
  fake.calls = []
})

const context = () => ({
  callerGrant: createApplicationCallerGrant({ callerId: 'external-agent', capabilityIds: ['change_application_entities', 'read_application_entity'], permissions: ['application:write', 'settings:read', 'settings:write'], allowWrites: true, allowDestructive: false }),
  signal: new AbortController().signal,
  requestId: crypto.randomUUID(),
  expectedRevisions: { local_models: fake.revision },
})

const yunet = { kind: 'local_model.item', id: 'face_detection_yunet' }

async function change(target: { kind: string; id: string }, properties: Record<string, unknown>) {
  return applicationReflectionHandlers.changeEntities({ summary: '本地模型', changes: [{ kind: 'set_properties', target, entityType: target.kind, properties }] }, context())
}

it('通过通用 change 下载并删除本地模型，下载服务状态随之变化', async () => {
  await change(yunet, { 'local_model.item.downloaded': true })
  expect(fake.ready.has('face_detection_yunet')).toBe(true)
  expect(state().models[0]!.status).toBe('ready')

  await change(yunet, { 'local_model.item.downloaded': false })
  expect(fake.ready.has('face_detection_yunet')).toBe(false)
  expect(fake.calls).toEqual(['ensure:face_detection_yunet', 'remove:face_detection_yunet'])
})

it('通过通用 change 把下载源改为国内，读回一致', async () => {
  await change({ kind: 'local_model.settings', id: 'singleton' }, { 'local_model.settings.download_source': 'domestic' })
  expect(fake.downloadSource).toBe('domestic')
})

it('暂不可下载的模型拒绝写入并说明原因，不调用下载', async () => {
  await expect(change({ kind: 'local_model.item', id: 'object_tracking_efficienttam' }, { 'local_model.item.downloaded': true })).rejects.toThrow()
  expect(fake.calls).toEqual([])
})
