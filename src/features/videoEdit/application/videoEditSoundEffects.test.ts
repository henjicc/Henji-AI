// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { getPlatform } from '@/platform/runtime'
import { installHarnessNativeStorage, uninstallHarnessNativeStorage } from '@/tests/harnessNativeStorage'
import type { SoundLibrarySoundLocation } from '@/platform/contracts/soundLibrary'
import { videoEditFps } from '@/core/videoEdit/time'
import { createLegacyTrackVideoEditProject, savedVideoEdit } from './videoEditDocumentTestKit'
import { closeVideoEditProject, editVideoSequence, getActiveVideoEditSequence, listVideoEditInstances, undoVideoEdit } from './videoEditService'
import { videoEditNativeMediaProbe } from './videoEditMediaProbe'
import { placeVideoEditSoundEffects } from './videoEditSoundEffects'

vi.mock('mediabunny', () => ({
  ALL_FORMATS: [], UrlSource: class {},
  Input: class {
    async getPrimaryVideoTrack() { return null }
    async getPrimaryAudioTrack() { return { codec: 'pcm-s16', canDecode: async () => true } }
    async getAudioTracks() { return [{ numberOfChannels: 2, sampleRate: 48000 }] }
    async computeDuration() { return 1.5 }
    dispose() {}
  },
}))
const sounds = vi.hoisted(() => new Map<string, SoundLibrarySoundLocation>())
vi.mock('@/commands/soundLibrary', () => ({ locateSoundLibrarySound: async (id: string) => { const sound = sounds.get(id); if (!sound) throw new Error('这个音效已不在登记的文件夹里，请重新检索。'); return sound } }))

function sound(id: string, hitSeconds: number, attackSeconds = hitSeconds / 2): SoundLibrarySoundLocation {
  return { id, folderId: 'f', relativePath: `${id}.wav`, label: id, english: id, chinese: null, path: `D:/音效/${id}.wav`, hasListening: false, features: { durationSeconds: 1.5, attackSeconds, hitSeconds, peakDbfs: -1, loudnessLufs: -14, brightnessHz: 3000 } }
}
beforeEach(() => {
  installHarnessNativeStorage(); sounds.clear()
  sounds.set('f:whoosh', sound('f:whoosh', 0.36)); sounds.set('f:ding', sound('f:ding', 0.05))
  vi.spyOn(getPlatform().system.fs, 'exists').mockResolvedValue(true)
  vi.spyOn(videoEditNativeMediaProbe, 'forcedBackend').mockResolvedValue('browser')
  vi.spyOn(getPlatform().system.paths, 'dirname').mockResolvedValue('D:/音效')
  vi.spyOn(getPlatform().assetLibrary, 'inspectFileContent').mockResolvedValue({ sizeBytes: 4096, fileModifiedAt: 1000, contentIdentity: 'a'.repeat(64) })
})
afterEach(async () => { for (const owner of listVideoEditInstances()) await closeVideoEditProject(owner.document.id); vi.restoreAllMocks(); uninstallHarnessNativeStorage() })

async function setup() {
  const owner = await createLegacyTrackVideoEditProject(), id = owner.document.id, sequence = getActiveVideoEditSequence(owner)
  editVideoSequence(id, sequence.id, value => ({ ...value, markers: [{ id: 'beat-1', frame: 45, name: '节拍', type: 'beat' }] }))
  return { owner, id, sequenceId: sequence.id, refs: { documentRef: { kind: 'video_edit.document' as const, id }, sequenceRef: { kind: 'video_edit.sequence' as const, id: `${id}:${sequence.id}` } } }
}
/** 从保存后的剪辑回算：片段起点 + (击中点 - 源入点) 就是听到击中的时刻。 */
function heardAt(owner: Awaited<ReturnType<typeof setup>>['owner'], clipRef: { id: string }, anchorSeconds: number): number {
  const sequence = savedVideoEdit(owner).sequences.find(value => value.id === owner.activeSequenceId)!
  const clip = sequence.clips.find(value => clipRef.id.endsWith(`:${value.id}`))!
  return clip.start / videoEditFps(sequence.frameRate) + anchorSeconds - clip.sourceInUs / 1e6
}

it('击中点精确对齐到帧与节拍标记，裁掉的只是不足一帧的开头；同一音效只导入一次，一步撤销', async () => {
  const { owner, id, refs } = await setup(); const history = owner.past.length
  const fps = videoEditFps(getActiveVideoEditSequence(owner).frameRate)
  const result = await placeVideoEditSoundEffects({ ...refs, placements: [
    { soundRef: { kind: 'sound_library.sound', id: 'f:whoosh' }, at: { kind: 'frame', frame: 30 }, anchor: 'hit', offsetFrames: 0 },
    { soundRef: { kind: 'sound_library.sound', id: 'f:whoosh' }, at: { kind: 'marker', markerRef: { kind: 'video_edit.marker', id: `${id}:beat-1` } }, anchor: 'hit', offsetFrames: 0 },
  ] })
  expect(result.verification.verified).toBe(true)
  for (const [index, frame] of [30, 45].entries()) {
    expect(heardAt(owner, result.placements[index].clipRef, 0.36)).toBeCloseTo(frame / fps, 5)
    expect(result.placements[index].trimmedHeadSeconds).toBeLessThan(1 / fps)
  }
  const saved = savedVideoEdit(owner)
  expect(saved.media.filter(media => media.path === 'D:/音效/f:whoosh.wav')).toHaveLength(1)
  expect(saved.sequences[0].clips.filter(clip => clip.audioRole === 'sound_effect')).toHaveLength(2)
  expect(owner.past).toHaveLength(history + 1)
  undoVideoEdit(id)
  expect(getActiveVideoEditSequence(owner).clips.some(clip => clip.audioRole === 'sound_effect')).toBe(false)
})

it('目标离开头比击中点还近时从 0 帧起并裁更多开头；起音点、推后帧数、增益与片段出点切点生效，同区间自动换轨', async () => {
  const { owner, refs } = await setup()
  const result = await placeVideoEditSoundEffects({ ...refs, placements: [
    { soundRef: { kind: 'sound_library.sound', id: 'f:whoosh' }, at: { kind: 'frame', frame: 3 }, anchor: 'hit', offsetFrames: 0 },
    { soundRef: { kind: 'sound_library.sound', id: 'f:ding' }, at: { kind: 'frame', frame: 3 }, anchor: 'attack', offsetFrames: 2, gainDb: -6 },
  ] })
  const fps = videoEditFps(getActiveVideoEditSequence(owner).frameRate)
  expect(result.placements[0]).toMatchObject({ startFrame: 0 }); expect(result.placements[0].trimmedHeadSeconds).toBeCloseTo(0.36 - 3 / fps, 5)
  expect(heardAt(owner, result.placements[1].clipRef, 0.025)).toBeCloseTo(5 / fps, 5)
  expect(result.placements[0].trackRef).not.toEqual(result.placements[1].trackRef)
  const clip = savedVideoEdit(owner).sequences[0].clips.find(value => result.placements[1].clipRef.id.endsWith(value.id))!
  expect(clip.gainDb).toBe(-6); expect(clip.volume).toBe(1)
  const first = savedVideoEdit(owner).sequences[0].clips.find(value => result.placements[0].clipRef.id.endsWith(value.id))!
  const cut = await placeVideoEditSoundEffects({ ...refs, placements: [{ soundRef: { kind: 'sound_library.sound', id: 'f:ding' }, at: { kind: 'cut', clipRef: result.placements[0].clipRef, edge: 'end' }, anchor: 'hit', offsetFrames: 0 }] })
  expect(heardAt(owner, cut.placements[0].clipRef, 0.05)).toBeCloseTo((first.start + first.duration) / fps, 5)
})

it('音效不在库里、标记不存在时在改动前拒绝并说明，剪辑不变', async () => {
  const { owner, id, refs } = await setup(); const before = owner.document
  await expect(placeVideoEditSoundEffects({ ...refs, placements: [{ soundRef: { kind: 'sound_library.sound', id: 'f:gone' }, at: { kind: 'frame', frame: 1 }, anchor: 'hit', offsetFrames: 0 }] })).rejects.toThrow('重新检索')
  await expect(placeVideoEditSoundEffects({ ...refs, placements: [{ soundRef: { kind: 'sound_library.sound', id: 'f:ding' }, at: { kind: 'marker', markerRef: { kind: 'video_edit.marker', id: `${id}:nope` } }, anchor: 'hit', offsetFrames: 0 }] })).rejects.toThrow('没有这个标记')
  expect(owner.document).toBe(before)
})
