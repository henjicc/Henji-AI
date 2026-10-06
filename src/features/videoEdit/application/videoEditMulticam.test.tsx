// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { installHarnessNativeStorage, uninstallHarnessNativeStorage } from '@/tests/harnessNativeStorage'
import { createApplicationHarness } from '@/tests/applicationHarness'
import { getPlatform } from '@/platform/runtime'
import { makeVideoEditItemClip } from '@/core/videoEdit/projectItems'
import { videoEditAudioOffset } from '@/core/videoEdit/multicamSync'
import { createVideoEditMulticamCapability } from '@/core/application-control/domains/videoEdit/videoEditMulticamCapabilities'
import { createVideoEditProject, editVideoProject, requireVideoEditInstance, undoVideoEdit, setVideoEditView } from './videoEditService'
import { closeAllVideoEdits, savedVideoEdit } from './videoEditDocumentTestKit'
import { autoSwitchVideoEditMulticam, createVideoEditMulticamSource, switchVideoEditMulticam, videoEditProgramMulticam } from './videoEditMulticam'
import { VideoEditMulticamView } from '../panels/VideoEditMulticamView'
import type { VideoEditComposition } from '@/core/videoEdit/document'

const boundary = vi.hoisted(() => ({ wait: undefined as Promise<void> | undefined, disposed: 0, noise: false }))
vi.mock('../engine/videoEditRenderSession', () => ({ VideoEditRenderSession: class {
  constructor(readonly document: VideoEditComposition) {}
  setTracks() {} async updateDocument() {} async present() { return { presented: true, bitmap: { close() {} } } }
  async mixAudio(start: number, duration: number) {
    await boundary.wait
    const original = this.document.clips[0]
    const itemId = original.kind === 'sequence' ? this.document.sequences?.find(sequence => sequence.id === this.document.items.find(item => item.id === original.itemId)?.sequenceId)?.multicam?.audioCameraId : original.itemId
    const second = itemId === 'b' || itemId === this.document.sequences?.at(-1)?.multicam?.cameras[1].id
    const level = second && start < 4 ? .8 : second ? .1 : .2
    const planes = [new Float32Array(Math.round(duration * 48000)).fill(level)]
    if (boundary.noise) for (let index = 0; index < planes[0].length; index++) {
      let value = Math.floor((start + index / 48000) * 1000 + 1e-6) + (second ? 1000 : 0)
      value = Math.imul(value ^ value >>> 16, 0x45d9f3b); value = Math.imul(value ^ value >>> 16, 0x45d9f3b)
      planes[0][index] = (value ^ value >>> 16) / 2 ** 31
    }
    return { sampleRate: 48000, numberOfChannels: 1, length: planes[0].length, getChannelData: (index: number) => planes[index] }
  }
  async renderBitmap() { return { bitmap: { width: 320, height: 180, close() {} } } }
  async dispose() { boundary.disposed++ }
} }))
vi.mock('./videoEditMulticamWorkerClient', () => ({ synchronizeVideoEditMulticam: async (a: Float32Array, b: Float32Array) => videoEditAudioOffset(a, b) }))
beforeEach(() => {
  installHarnessNativeStorage(); boundary.wait = undefined; boundary.disposed = 0; boundary.noise = false
  const api = getPlatform().audioEdit.loudness
  vi.spyOn(api, 'start').mockResolvedValue(undefined)
  vi.spyOn(api, 'append').mockResolvedValue(undefined)
  vi.spyOn(api, 'close').mockResolvedValue(undefined)
  vi.spyOn(api, 'detectActivity').mockResolvedValue([{ startSeconds: 0, endSeconds: 10 }])
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage() {} } as unknown as CanvasRenderingContext2D)
})
it('正式创建入口解码并降采样共同声音，求偏移后一次提交与撤销', async () => {
  const owner = await fixture(); boundary.noise = true
  const history = owner.past.length
  const result = await createVideoEditMulticamSource(owner.document.id, owner.activeSequenceId, { name: '声音同步', sync: 'audio', cameras: [{ itemId: 'a' }, { itemId: 'b' }] })
  expect(result.sequence.clips.map(clip => clip.start)).toEqual([0, 30]); expect(owner.past.length).toBe(history + 1)
  undoVideoEdit(owner.document.id); expect(owner.document.sequences).toHaveLength(1); expect(boundary.disposed).toBe(2)
})
afterEach(async () => { cleanup(); await closeAllVideoEdits(); vi.restoreAllMocks(); uninstallHarnessNativeStorage() })
async function fixture() {
  const owner = await createVideoEditProject()
  editVideoProject(owner.document.id, document => {
    document.media = ['a', 'b'].map(id => ({ id: `media-${id}`, name: id, path: `/fixture/${id}.mp4`, kind: 'video', width: 64, height: 64, durationSeconds: 10, hasAudio: true }))
    document.items = document.media.map(media => ({ id: media.name, name: media.name, kind: 'video', mediaId: media.id }))
    return document
  })
  return owner
}
async function placed() {
  const owner = await fixture(); const parentId = owner.activeSequenceId
  const created = await createVideoEditMulticamSource(owner.document.id, parentId, { name: '机位', sync: 'in_points', cameras: [{ itemId: 'a', speaker: '甲' }, { itemId: 'b', speaker: '乙' }] })
  const clip = makeVideoEditItemClip(owner.document, created.itemId, parentId, { frame: 0 })
  editVideoProject(owner.document.id, document => ({ ...document, sequences: document.sequences.map(sequence => sequence.id === parentId ? { ...sequence, clips: [clip] } : sequence) }))
  return { owner, parentId, clip, source: created.sequence }
}
it('创建、播放切点、换机位、自动切换分别一步撤销；失败不留半个序列', async () => {
  const { owner, parentId, clip, source } = await placed(); const before = structuredClone(owner.document); const history = owner.past.length
  switchVideoEditMulticam({ projectId: owner.document.id, sequenceId: parentId, clipId: clip.id }, source.multicam!.cameras[1].id, 30)
  expect(owner.past.length).toBe(history + 1); expect(owner.document.sequences[0].clips).toHaveLength(2)
  undoVideoEdit(owner.document.id); expect(owner.document.sequences).toEqual(before.sequences)
  const ids = await autoSwitchVideoEditMulticam({ projectId: owner.document.id, sequenceId: parentId, clipId: clip.id })
  expect(ids).toHaveLength(3); expect(owner.past.length).toBe(history + 1)
  expect(owner.document.sequences[0].clips.map(clip => clip.start)).toEqual([0, 60, 120])
  undoVideoEdit(owner.document.id); expect(owner.document.sequences).toEqual(before.sequences)
  await expect(createVideoEditMulticamSource(owner.document.id, parentId, { name: '失败', sync: 'audio', cameras: [{ itemId: 'a' }, { itemId: 'b' }] })).rejects.toThrow('静音')
  expect(owner.document.sequences).toEqual(before.sequences)
})
it('公共能力创建并保存回读，通用机位属性/说话人映射可写可撤销；外域和错机位拒绝', async () => {
  const owner = await fixture(); const app = createApplicationHarness(); const documentRef = { kind: 'video_edit.document', id: owner.document.id }
  try {
    const request = { documentRef, templateSequenceRef: { kind: 'video_edit.sequence', id: `${owner.document.id}:${owner.activeSequenceId}` }, name: '助手多机位', sync: 'in_points', cameras: ['a', 'b'].map(id => ({ itemRef: { kind: 'video_edit.item', id: `${owner.document.id}:${id}` } })) }
    const result = await app.requireResult('create_video_edit_multicam', request)
    expect(result).toMatchObject({ verification: { verified: true } }); expect(savedVideoEdit(owner).sequences).toEqual(owner.document.sequences)
    const created = createVideoEditMulticamCapability.outputSchema.parse(result)
    const effects = createVideoEditMulticamCapability.resolveObservedEffects!(createVideoEditMulticamCapability.inputSchema.parse(request), created)
    expect(effects.filter(effect => effect.effect === 'create')).toEqual([
      expect.objectContaining({ entityTypes: ['video_edit.sequence'], targetRefs: [created.sequenceRef], count: 1, verified: true }),
      expect.objectContaining({ entityTypes: ['video_edit.item'], targetRefs: [created.itemRef], count: 1, verified: true }),
      expect.objectContaining({ entityTypes: ['video_edit.clip'], targetRefs: created.clipRefs, count: 2, verified: true }),
    ])
    for (const effect of effects) {
      expect(createVideoEditMulticamCapability.control.impacts.some(impact => impact.effect === effect.effect && effect.entityTypes.every(type => impact.entityTypes.includes(type)))).toBe(true)
    }
    const source = owner.document.sequences.at(-1)!
    const clip = makeVideoEditItemClip(owner.document, owner.document.items.at(-1)!.id, owner.activeSequenceId, { frame: 0 })
    editVideoProject(owner.document.id, document => ({ ...document, sequences: document.sequences.map(sequence => sequence.id === owner.activeSequenceId ? { ...sequence, clips: [clip] } : sequence) }))
    const clipRef = { kind: 'video_edit.clip', id: `${owner.document.id}:${clip.id}` }; const property = 'video_edit.clip.multicam_camera_id'
    expect(await app.read(clipRef, [property])).toMatchObject({ properties: { [property]: source.multicam!.cameras[0].id } })
    expect(await app.change(clipRef, { [property]: source.multicam!.cameras[1].id })).toMatchObject({ ok: true })
    expect(await app.read(clipRef, [property])).toMatchObject({ properties: { [property]: source.multicam!.cameras[1].id } })
    expect(await app.change(clipRef, { [property]: 'foreign' })).toMatchObject({ ok: false })
    const multicam = { ...source.multicam!, cameras: source.multicam!.cameras.map((camera, index) => ({ ...camera, speaker: index ? '乙' : '甲' })) }
    expect(await app.change({ kind: 'video_edit.sequence', id: `${owner.document.id}:${source.id}` }, { 'video_edit.sequence.multicam': multicam })).toMatchObject({ ok: true })
    const auto = await app.requireResult('auto_switch_video_edit_multicam', { documentRef, clipRef, speech: [{ startSeconds: 0, endSeconds: 5, speaker: '甲' }] })
    expect(auto).toMatchObject({ verification: { verified: true } })
    expect(await app.call('create_video_edit_multicam', { documentRef, templateSequenceRef: { kind: 'video_edit.sequence', id: `foreign:${owner.activeSequenceId}` }, name: '错域', sync: 'in_points', cameras: ['a', 'b'].map(id => ({ itemRef: { kind: 'video_edit.item', id: `${owner.document.id}:${id}` } })) })).toMatchObject({ ok: false })
  } finally { app.dispose() }
})
it('异步分析拒绝迟到结果，取消释放声音会话与渲染器', async () => {
  const { owner, parentId, clip } = await placed(); const target = { projectId: owner.document.id, sequenceId: parentId, clipId: clip.id }
  let release!: () => void; boundary.wait = new Promise<void>(resolve => { release = resolve })
  const signal = new AbortController(); const analyzing = autoSwitchVideoEditMulticam(target, {}, signal.signal)
  signal.abort(); release()
  await expect(analyzing).rejects.toThrow(); expect(boundary.disposed).toBeGreaterThan(0)
  boundary.wait = new Promise<void>(resolve => { release = resolve })
  const stale = autoSwitchVideoEditMulticam(target)
  editVideoProject(owner.document.id, document => ({ ...document, sequences: document.sequences.map(sequence => sequence.id === parentId ? { ...sequence, name: '后续修改' } : sequence) }))
  release(); await expect(stale).rejects.toThrow('已有修改')
  expect(owner.document.sequences[0].clips).toHaveLength(1)
})
it('多机位网格单击和1–9只在本监视器命中；播放中保留播放并写切点', async () => {
  const { owner, source } = await placed()
  render(<VideoEditMulticamView instance={owner} onError={vi.fn()} />)
  const grid = screen.getByRole('group', { name: '多机位监视器' })
  fireEvent.keyDown(grid, { key: '2' }); expect(owner.document.sequences[0].clips[0].multicamCameraId).toBe(source.multicam!.cameras[1].id)
  setVideoEditView(owner.document.id, { playing: true, frame: 90 })
  fireEvent.click(screen.getByRole('button', { name: '切换到机位1 机位 1' }))
  expect(owner.document.sequences[0].clips).toHaveLength(2); expect(requireVideoEditInstance(owner.document.id).playing).toBe(true)
  const count = owner.past.length; fireEvent.keyDown(grid, { key: '9' }); expect(owner.past.length).toBe(count)
  editVideoProject(owner.document.id, document => {
    const parent = document.sequences[0]
    parent.tracks.push({ id: 'title-track', name: '标题', index: 2, kind: 'video', enabled: true, muted: false, solo: false, locked: false })
    document.items.push({ id: 'title-item', name: '标题', kind: 'text' })
    parent.clips.push(makeVideoEditItemClip(document, 'title-item', parent.id, { frame: 0, track: 2, duration: 300 }))
    return document
  })
  expect(videoEditProgramMulticam(owner)?.source.id).toBe(source.id)
})
