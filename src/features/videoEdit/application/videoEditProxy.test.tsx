import { createVideoEditTestProject as createVideoEditProject } from './videoEditDocumentTestKit'
// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createApplicationCapabilitySession } from '@/features/application-control/applicationCapabilityService'
import { createApplicationCallerGrant } from '@/core/application-control/callerContext'
import { createApplicationHarness } from '@/tests/applicationHarness'
import { installHarnessNativeStorage, uninstallHarnessNativeStorage } from '@/tests/harnessNativeStorage'
import { getPlatform } from '@/platform/runtime'
import { appendVideoEditMedia, closeVideoEditProject, editVideoProject, listVideoEditInstances } from './videoEditService'
import { autoCreateVideoEditProxies, cancelVideoEditProxy, createVideoEditProxy, getVideoEditProxyPreference, getVideoEditProxySources, readVideoEditProxyState, refreshVideoEditProxies, resetVideoEditProxyPreferenceCache, setVideoEditProxyPreference, verifiedVideoEditProxySources } from './videoEditProxy'
import { VideoEditMutationExecutor } from './videoEditExecutors'
import type { VideoProxyResult } from '@/core/videoEdit/proxy'
import type { ApplicationPlannedStep } from '@/core/application-control'

const result: VideoProxyResult = { path: 'D:/cache/proxy.mp4', key: 'a'.repeat(64), contentIdentity: 'b'.repeat(64), preset: '720p', width: 1280, height: 720, bytes: 1234 }
beforeEach(() => {
  installHarnessNativeStorage(); localStorage.clear(); resetVideoEditProxyPreferenceCache(); vi.clearAllMocks()
  vi.spyOn(getPlatform().media, 'allowRoot').mockResolvedValue(undefined)
  vi.spyOn(getPlatform().videoProxy, 'create').mockResolvedValue(result)
  vi.spyOn(getPlatform().videoProxy, 'lookup').mockResolvedValue(result)
  vi.spyOn(getPlatform().videoProxy, 'cancel').mockResolvedValue(undefined)
  vi.spyOn(getPlatform().videoProxy, 'onProgress').mockReturnValue(() => undefined)
})
afterEach(async () => { for (const owner of listVideoEditInstances()) await closeVideoEditProject(owner.document.id); vi.restoreAllMocks(); uninstallHarnessNativeStorage() })
async function fixture(): Promise<{ owner: NonNullable<Awaited<ReturnType<typeof createVideoEditProject>>>; id: string; mediaId: string }> {
  const owner = (await createVideoEditProject())!
  const mediaId = 'proxy-source'
  appendVideoEditMedia(owner.document.id, { id: mediaId, name: '4K', kind: 'video', path: 'D:/original.mov', width: 3840, height: 2160, durationSeconds: 3, frameRate: { numerator: 30000, denominator: 1001 } })
  return { owner, id: owner.document.id, mediaId }
}
it('助手同源创建、状态通用读取、切换通用修改、权限与事务撤销；不改原片或内容历史', async () => {
  const { owner, id, mediaId } = await fixture(); const app = createApplicationHarness()
  const documentRef = { kind: 'video_edit.document', id }; const mediaRef = { kind: 'video_edit.media', id: `${id}:${mediaId}` }
  const before = owner.document; const history = owner.past.length
  try {
    const output = await app.requireResult('generate_video_edit_proxy', { documentRef, mediaRef, preset: '720p' })
    expect(output.verified).toBe(true); expect(output.resultRef).toEqual(mediaRef)
    const read = await app.read(mediaRef, ['video_edit.media.proxy_state']) as { properties: Record<string, unknown> }
    expect(read.properties['video_edit.media.proxy_state']).toEqual({ status: 'ready', progress: 1, error: '' })
    expect((await app.change(documentRef, { 'video_edit.document.proxy_preference': { enabled: true, autoCreate: true } })).ok).toBe(true)
    expect(getVideoEditProxySources(id)[mediaId]).toEqual(result)
    expect(owner.document).toBe(before); expect(owner.past).toHaveLength(history)
    expect((await app.change(documentRef, { 'video_edit.document.proxy_preference': { enabled: 'yes', autoCreate: false } })).ok).toBe(false)
  } finally { app.dispose() }
  const executor = new VideoEditMutationExecutor('video_edit.document')
  const step = { kind: 'mutation', entityType: 'video_edit.document', target: documentRef, expectedRevisions: {}, mutations: [{ propertyId: 'video_edit.document.proxy_preference', operation: 'set', value: { enabled: false, autoCreate: false } }] } satisfies Extract<ApplicationPlannedStep, { kind: 'mutation' }>
  const changed = await executor.apply(step); await executor.undo(changed.undoToken!)
  expect(getVideoEditProxyPreference(id)).toEqual({ enabled: true, autoCreate: true })
  const readOnly = createApplicationCapabilitySession(createApplicationCallerGrant({ callerId: 'proxy-reader', capabilityIds: ['generate_video_edit_proxy'], permissions: ['video_edit:read'], allowWrites: false, allowDestructive: false }))
  await expect(Promise.resolve().then(() => readOnly.execute({ id: 'generate_video_edit_proxy', version: 1, input: { documentRef, mediaRef } }, { requestId: 'proxy-denied', signal: new AbortController().signal }))).rejects.toThrow('PERMISSION_DENIED')
})
it('取消转发、进度可读、换源拒绝迟到代理、关闭拒绝迟到结果', async () => {
  const { id, mediaId } = await fixture()
  let finish: (value: VideoProxyResult) => void = () => undefined
  vi.mocked(getPlatform().videoProxy.create).mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  const pending = createVideoEditProxy(id, mediaId, '720p'); expect(readVideoEditProxyState(id, mediaId).status).toBe('generating')
  const listener = vi.mocked(getPlatform().videoProxy.onProgress).mock.calls.at(-1)![0]
  const request = vi.mocked(getPlatform().videoProxy.create).mock.calls.at(-1)![0]; listener({ requestId: request.requestId, progress: .4 })
  expect(readVideoEditProxyState(id, mediaId).progress).toBe(.4)
  cancelVideoEditProxy(id, mediaId); finish(result); await expect(pending).rejects.toThrow('已取消')
  expect(getPlatform().videoProxy.cancel).toHaveBeenCalledWith(request.requestId)
  vi.mocked(getPlatform().videoProxy.create).mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  const relink = createVideoEditProxy(id, mediaId, '720p')
  editVideoProject(id, document => ({ ...document, media: document.media.map(media => media.id === mediaId ? { ...media, path: 'D:/replacement.mov', sourceRevision: 'relinked' } : media) }))
  finish(result); await expect(relink).rejects.toThrow('已改变')
  expect(readVideoEditProxyState(id, mediaId).status).toBe('none')
  vi.mocked(getPlatform().videoProxy.create).mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  const closing = createVideoEditProxy(id, mediaId, '540p'); await closeVideoEditProject(id); finish(result)
  await expect(closing).rejects.toThrow('已关闭')
})
it('重新打开复用缓存，自动创建仅作用高于1080p的视频；原片重新定位淘汰代理', async () => {
  const { id, mediaId } = await fixture()
  await refreshVideoEditProxies(id)
  expect(readVideoEditProxyState(id, mediaId).status).toBe('ready')
  const low = 'low'
  appendVideoEditMedia(id, { id: low, name: 'HD', kind: 'video', path: 'D:/hd.mp4', width: 1920, height: 1080, durationSeconds: 2 })
  const sound = 'sound'
  appendVideoEditMedia(id, { id: sound, name: '声音', kind: 'audio', path: 'D:/a.wav', width: 0, height: 0, durationSeconds: 2 })
  await autoCreateVideoEditProxies(id, [mediaId, low, sound]); expect(getPlatform().videoProxy.create).not.toHaveBeenCalled()
  setVideoEditProxyPreference(id, { autoCreate: true }); await autoCreateVideoEditProxies(id, [mediaId, low, sound])
  expect(getPlatform().videoProxy.create).toHaveBeenCalledOnce()
  editVideoProject(id, document => ({ ...document, media: document.media.map(media => media.id === mediaId ? { ...media, sourceRevision: 'new' } : media) }))
  expect(readVideoEditProxyState(id, mediaId).status).toBe('none')
})

it('解码打开前重新核对内容身份与缓存淘汰，同路径原片改变后回到原片', async () => {
  const { owner, id, mediaId } = await fixture()
  // Cache restoration also works when only the monitor is mounted (no project-panel refresh).
  setVideoEditProxyPreference(id, { enabled: true })
  expect((await verifiedVideoEditProxySources(id))[mediaId]).toEqual(result)
  const before = owner.document
  vi.mocked(getPlatform().videoProxy.lookup).mockResolvedValueOnce({ ...result, key: 'c'.repeat(64), contentIdentity: 'd'.repeat(64) })
  expect(await verifiedVideoEditProxySources(id)).toEqual({})
  expect(readVideoEditProxyState(id, mediaId).status).toBe('none')
  expect(owner.document).toBe(before)
})
