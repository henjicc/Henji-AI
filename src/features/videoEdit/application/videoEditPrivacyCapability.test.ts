// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import path from 'node:path'
import { installHarnessNativeStorage, uninstallHarnessNativeStorage } from '@/tests/harnessNativeStorage'
import { createApplicationHarness } from '@/tests/applicationHarness'
import { createVideoEditTestProject, failVideoEditSaves, savedVideoEdit } from './videoEditDocumentTestKit'
import { appendVideoEditMedia, appendVideoEditClip, getActiveVideoEditSequence, listVideoEditInstances, closeVideoEditProject, undoVideoEdit, editVideoSequence } from './videoEditService'
import { getPlatform } from '@/platform'
import { privacyCandidateSchema } from '@/core/screenRecording/privacy'
import { ocrPrivacyRequestSchema } from '@/platform/contracts/ocrPrivacy'
beforeEach(() => installHarnessNativeStorage())
afterEach(async () => { failVideoEditSaves(false); for (const owner of listVideoEditInstances()) await closeVideoEditProject(owner.document.id); vi.restoreAllMocks(); uninstallHarnessNativeStorage() })
async function setup() {
  const owner = await createVideoEditTestProject(), id = owner.document.id
  appendVideoEditMedia(id, { id: 'screen', name: '屏幕', path: path.resolve(path.sep, 'fixture', 'screen.mp4'), kind: 'video', width: 1920, height: 1080, durationSeconds: 2 })
  const track = getActiveVideoEditSequence(owner).tracks.find(t => t.kind === 'video')!.index
  appendVideoEditClip(id, 'screen', { frame: 0, track }); const clip = getActiveVideoEditSequence(owner).clips[0]
  const candidate = privacyCandidateSchema.parse({ id: 'private', mediaId: 'screen', kind: 'secret', hint: '••••', fingerprint: 'a'.repeat(64), startUs: 100000, endUs: 1500000, status: 'pending', samples: [{ monoUs: 100000, box: [.1, .2, .4, .1], confidence: .99 }] })
  vi.spyOn(getPlatform().smartRegions, 'detectSensitiveText').mockImplementation(async request => { ocrPrivacyRequestSchema.parse(request); return { privacy: { candidates: [candidate], warnings: [] }, frames: 20, inferredFrames: 1 } })
  return { id, owner, clip, input: { documentRef: { kind: 'video_edit.document', id }, clipRef: { kind: 'video_edit.clip', id: `${id}:${clip.id}` } } }
}
it('剪辑正式能力生成未启用效果→通用读改确认→保存回读→一步撤销', async () => {
  const { id, owner, input } = await setup(), app = createApplicationHarness(), history = owner.past.length
  try {
    const result = await app.requireResult('detect_video_edit_sensitive_text', input)
    expect(getPlatform().smartRegions.detectSensitiveText).toHaveBeenCalledWith(expect.objectContaining({ startUs: 0, endUs: 2000000 }))
    expect(result).toMatchObject({ verified: true }); expect(owner.past).toHaveLength(history + 1)
    const effect = getActiveVideoEditSequence(owner).clips[0].effects![0]
    expect(effect.enabled).toBe(false); expect(savedVideoEdit(id).sequences[0].clips[0].effects![0].enabled).toBe(false)
    const ref = (result.effectRefs as { kind: string; id: string }[])[0]
    expect((await app.read(ref, ['video_edit.effect.enabled'])).properties).toMatchObject({ 'video_edit.effect.enabled': false })
    expect((await app.change(ref, { 'video_edit.effect.enabled': true })).ok).toBe(true)
    expect(getActiveVideoEditSequence(owner).clips[0].effects![0].enabled).toBe(true)
    undoVideoEdit(id); expect(getActiveVideoEditSequence(owner).clips[0].effects![0].enabled).toBe(false)
    undoVideoEdit(id); expect(getActiveVideoEditSequence(owner).clips[0].effects).toBeUndefined()
  } finally { app.dispose() }
})
it('锁轨不推理；并发改动拒绝迟到结果；保存失败保留未确认效果供保存恢复', async () => {
  const { id, owner, clip, input } = await setup(), app = createApplicationHarness()
  try {
    const sequenceId = getActiveVideoEditSequence(owner).id
    editVideoSequence(id, sequenceId, sequence => ({ ...sequence, tracks: sequence.tracks.map(t => t.index === clip.track ? { ...t, locked: true } : t) }))
    expect((await app.call('detect_video_edit_sensitive_text', input)).ok).toBe(false); expect(getPlatform().smartRegions.detectSensitiveText).not.toHaveBeenCalled()
    editVideoSequence(id, sequenceId, sequence => ({ ...sequence, tracks: sequence.tracks.map(t => ({ ...t, locked: false })) }))
    const detected = vi.mocked(getPlatform().smartRegions.detectSensitiveText)
    const response = await detected.getMockImplementation()!({ requestId: crypto.randomUUID(), source: path.resolve(path.sep, 'fixture', 'screen.mp4'), mediaId: 'screen', startUs: 0, endUs: 1, originUs: 0 })
    detected.mockImplementationOnce(async () => { editVideoSequence(id, sequenceId, s => ({ ...s, name: '并发修改' })); return response })
    expect((await app.call('detect_video_edit_sensitive_text', input)).ok).toBe(false)
    expect(getActiveVideoEditSequence(owner).clips[0].effects).toBeUndefined()
    failVideoEditSaves(true)
    expect((await app.call('detect_video_edit_sensitive_text', input)).ok).toBe(false)
    expect(getActiveVideoEditSequence(owner).clips[0].effects![0].enabled).toBe(false)
  } finally { app.dispose() }
})
