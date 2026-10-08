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
  modelDetails: {} as Partial<LocalModelInfo>,
}))

function model(id: LocalModelInfo['id'], status: LocalModelInfo['status']): LocalModelInfo {
  return { id, title: { zh: id, en: id }, purpose: { zh: '用途', en: 'purpose' }, license: 'MIT', sizeBytes: 1_000_000, status, progress: null, lastFailure: null }
}

function state(): LocalModelsState {
  return {
    revision: fake.revision,
    downloadSource: fake.downloadSource,
    models: [
      { ...model('face_detection_yunet', fake.ready.has('face_detection_yunet') ? 'ready' : 'not_downloaded'), ...fake.modelDetails },
      model('object_tracking_efficienttam', 'unavailable'),
      model('image_inpainting_migan', fake.ready.has('image_inpainting_migan') ? 'ready' : 'not_downloaded'),
      model('image_inpainting_lama', fake.ready.has('image_inpainting_lama') ? 'ready' : 'not_downloaded'),
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
  fake.modelDetails = {}
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

it.each(['image_inpainting_migan', 'image_inpainting_lama'])('新修补模型 %s 沿现有通用读改下载/删除，不新增同义工具', async id => {
  const ref = { kind: 'local_model.item', id }
  await change(ref, { 'local_model.item.downloaded': true })
  expect((await applicationReflectionHandlers.readEntity({ ref, propertyIds: ['local_model.item.status'] }, context())).properties).toEqual({ 'local_model.item.status': 'ready' })
  await change(ref, { 'local_model.item.downloaded': false })
  expect(fake.calls).toEqual([`ensure:${id}`, `remove:${id}`])
})

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

it('通用 read 返回已知下载进度与失败事实；100% 仍在下载，未知进度与清空原因不冒充成功', async () => {
  const read = async () => (await applicationReflectionHandlers.readEntity({ ref: yunet, propertyIds: ['local_model.item.status', 'local_model.item.progress_percent', 'local_model.item.last_failure'] }, context())).properties
  fake.modelDetails = { status: 'downloading', progress: { receivedBytes: 123, totalBytes: 500 }, lastFailure: null }
  expect(await read()).toEqual({ 'local_model.item.status': 'downloading', 'local_model.item.progress_percent': 25, 'local_model.item.last_failure': null })
  fake.modelDetails.progress = { receivedBytes: 550, totalBytes: 500 }
  expect(await read()).toMatchObject({ 'local_model.item.status': 'downloading', 'local_model.item.progress_percent': 100 })
  fake.modelDetails.progress = { receivedBytes: 10, totalBytes: 0 }
  expect(await read()).toMatchObject({ 'local_model.item.progress_percent': null })
  for (const lastFailure of ['network', 'checksum', 'disk', 'cancelled', 'unavailable'] as const) {
    fake.modelDetails = { status: 'not_downloaded', progress: null, lastFailure }
    expect(await read()).toMatchObject({ 'local_model.item.progress_percent': null, 'local_model.item.last_failure': lastFailure })
  }
  fake.modelDetails = { status: 'ready', progress: null, lastFailure: null }
  expect(await read()).toMatchObject({ 'local_model.item.progress_percent': null, 'local_model.item.last_failure': null })
  await expect(change(yunet, { 'local_model.item.last_failure': 'network' })).rejects.toThrow()
  await expect(change(yunet, { 'local_model.item.progress_percent': 100 })).rejects.toThrow()
  expect(fake.calls).toEqual([])
})
