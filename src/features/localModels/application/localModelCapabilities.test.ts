// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest'
import { createApplicationHarness } from '@/tests/applicationHarness'
import { createApplicationCallerGrant } from '@/core/application-control/callerContext'
import { createApplicationCapabilitySession } from '@/features/application-control/applicationCapabilityService'
import type { LocalModelInfo } from '@/platform/contracts/localModels'

const fake = vi.hoisted(() => ({ status: 'downloading' as LocalModelInfo['status'], failure: null as LocalModelInfo['lastFailure'], revision: 1, calls: [] as string[] }))
vi.mock('@/commands/localModels', async importOriginal => ({
  ...await importOriginal<typeof import('@/commands/localModels')>(),
  getLocalModelsState: async () => ({ revision: fake.revision, downloadSource: 'auto', models: [{ id: 'face_detection_yunet', title: { zh: '人脸检测', en: 'Face' }, purpose: { zh: '人脸', en: 'Face' }, license: 'MIT', sizeBytes: 1000,
    status: fake.status, progress: fake.status === 'downloading' ? { receivedBytes: 100, totalBytes: 1000 } : null, lastFailure: fake.failure,
  }] }),
  cancelLocalModelDownload: async (id: string) => {
    fake.calls.push(`cancel:${id}`)
    if (fake.status !== 'downloading') return false
    fake.status = 'not_downloaded'; fake.failure = 'cancelled'; fake.revision++
    return true
  },
  removeLocalModel: async () => { fake.calls.push('remove') },
}))

const ref = { kind: 'local_model.item', id: 'face_detection_yunet' }
beforeEach(() => { fake.status = 'downloading'; fake.failure = null; fake.revision = 1; fake.calls = [] })

it('公共能力取消并回读状态，不使用删除；重复取消与已下载模型如实返回', async () => {
  const app = createApplicationHarness()
  try {
    const before = await app.read(ref)
    const result = await app.call('cancel_local_model_download', { modelRef: ref }, before.revisions as Record<string, number>)
    expect(result, JSON.stringify(result)).toMatchObject({ ok: true, data: { cancelled: true, status: 'not_downloaded', verification: { verified: true } } })
    expect((await app.read(ref, ['local_model.item.status', 'local_model.item.last_failure'])).properties).toEqual({ 'local_model.item.status': 'not_downloaded', 'local_model.item.last_failure': 'cancelled' })
    expect(fake.calls).toEqual(['cancel:face_detection_yunet'])
    const again = await app.call('cancel_local_model_download', { modelRef: ref }, { local_models: fake.revision })
    expect(again).toMatchObject({ ok: true, data: { cancelled: false } })
    fake.status = 'ready'; fake.failure = null; fake.revision++
    expect(await app.call('cancel_local_model_download', { modelRef: ref }, { local_models: fake.revision })).toMatchObject({ ok: true, data: { cancelled: false, status: 'ready' } })
    expect(fake.calls).not.toContain('remove')
  } finally { app.dispose() }
})

it('权限、并发基线及非法模型拒绝时不触发取消，文件夹导航有意不公开', async () => {
  const app = createApplicationHarness()
  try {
    const denied = createApplicationCapabilitySession(createApplicationCallerGrant({ callerId: 'reader', capabilityIds: ['cancel_local_model_download'], permissions: ['settings:read'], allowWrites: false, allowDestructive: false }))
    await expect(denied.execute({ id: 'cancel_local_model_download', version: 1, input: { modelRef: ref } }, { requestId: 'denied', signal: new AbortController().signal })).rejects.toThrow('PERMISSION_DENIED')
    expect(await app.call('cancel_local_model_download', { modelRef: ref }, { local_models: 0 })).toMatchObject({ ok: false })
    const invalid = await app.call('cancel_local_model_download', { modelRef: { ...ref, id: 'missing' } }, { local_models: fake.revision })
    expect(invalid).toMatchObject({ ok: false }); expect(JSON.stringify(invalid)).toContain('list_application_entities')
    expect(fake.calls).toEqual([])
    expect(() => app.call('open_local_model_folder', { modelRef: ref })).toThrow('能力未公开')
  } finally { app.dispose() }
})
