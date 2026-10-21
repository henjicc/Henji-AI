// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import path from 'node:path'
import { steadyMusicAnalysis } from '@/core/audioAnalysis/music/musicTestFixtures'
import type { MusicAnalysis } from '@/core/audioAnalysis/music/musicAnalysis'
import { installHarnessNativeStorage, uninstallHarnessNativeStorage } from '@/tests/harnessNativeStorage'
import { createApplicationHarness } from '@/tests/applicationHarness'
import { videoEditFps } from '@/core/videoEdit/time'
import { createVideoEditTestProject, savedVideoEdit } from './videoEditDocumentTestKit'
import { appendVideoEditClip, appendVideoEditMedia, closeVideoEditProject, editVideoSequence, getActiveVideoEditSequence, listVideoEditInstances, undoVideoEdit } from './videoEditService'

const boundary = vi.hoisted(() => ({ analysis: undefined as MusicAnalysis | undefined, calls: 0 }))
vi.mock('@/commands/musicAnalysis', () => ({ analyzeMusicStructure: async () => {
  boundary.calls++
  return { analysis: boundary.analysis!, analysisIdentity: `music-v1:beat_this:${'a'.repeat(64)}`, cached: false, model: 'used', timings: null }
} }))
beforeEach(() => { installHarnessNativeStorage(); boundary.analysis = steadyMusicAnalysis(); boundary.calls = 0 })
afterEach(async () => { for (const owner of listVideoEditInstances()) await closeVideoEditProject(owner.document.id); vi.restoreAllMocks(); uninstallHarnessNativeStorage() })

async function setup() {
  const owner = await createVideoEditTestProject(), id = owner.document.id
  const seconds = boundary.analysis!.durationSeconds
  appendVideoEditMedia(id, { id: 'song', name: '配乐', path: path.resolve(path.sep, 'fixture', 'song.mp3'), kind: 'audio', width: 0, height: 0, durationSeconds: seconds, hasAudio: true })
  const track = getActiveVideoEditSequence(owner).tracks.find(t => t.kind === 'audio')!.index
  appendVideoEditClip(id, 'song', { frame: 30, track })
  const sequence = getActiveVideoEditSequence(owner), clip = sequence.clips[0], fps = videoEditFps(sequence.frameRate)
  const refs = { documentRef: { kind: 'video_edit.document', id }, sequenceRef: { kind: 'video_edit.sequence', id: `${id}:${sequence.id}` }, clipRef: { kind: 'video_edit.clip', id: `${id}:${clip.id}` } }
  return { owner, id, sequenceId: sequence.id, clip, fps, refs }
}
const remixed = (owner: Awaited<ReturnType<typeof setup>>['owner']) => getActiveVideoEditSequence(owner).clips.filter(clip => clip.remix).sort((a, b) => a.start - b.start)

it('经公共能力重构到目标帧数：子片段首尾相接、接缝有过渡、可读回，一步撤销恢复原片段', async () => {
  const { owner, id, clip, fps, refs } = await setup(), app = createApplicationHarness(), history = owner.past.length
  try {
    const result = await app.requireResult('remix_video_edit_music', { ...refs, target: { kind: 'seconds', seconds: 90 } }) as { targetFrames: number; resultRefs: Array<{ id: string }>; seams: Array<{ frame: number; confidence: number }>; verification: { verified: boolean }; startFrame: number }
    expect(result.verification.verified).toBe(true)
    expect(result.targetFrames).toBe(Math.round(90 * fps))
    const clips = remixed(owner)
    expect(clips.map(value => `${id}:${value.id}`)).toEqual(result.resultRefs.map(ref => ref.id))
    expect(clips[0].start).toBe(30)
    expect(clips.at(-1)!.start + clips.at(-1)!.duration - 30).toBe(result.targetFrames)
    expect(result.seams.map(seam => seam.frame)).toEqual(clips.slice(1).map(value => value.start))
    const saved = savedVideoEdit(owner).sequences[0]
    expect(saved.clips.filter(value => value.remix?.id === clips[0].remix!.id)).toHaveLength(clips.length)
    expect(saved.transitions?.filter(transition => transition.kind === 'constant_power' && transition.alignment === 'end')).toHaveLength(clips.length - 1)
    const read = await app.requireResult('read_application_entity', { ref: { kind: 'video_edit.clip', id: `${id}:${clips[1].id}` }, propertyIds: ['video_edit.clip.remix'] })
    expect(JSON.stringify(read)).toContain('seamConfidence')
    const media = await app.requireResult('read_application_entity', { ref: { kind: 'video_edit.media', id: `${id}:song` }, propertyIds: ['video_edit.media.music_structure'] })
    expect(JSON.stringify(media)).toContain('"beatsPerBar":4')
    expect(owner.past).toHaveLength(history + 1)
    undoVideoEdit(id)
    expect(getActiveVideoEditSequence(owner).clips.map(value => value.id)).toEqual([clip.id])
    expect(getActiveVideoEditSequence(owner).transitions ?? []).toHaveLength(0)
  } finally { app.dispose() }
})

it('对已重构的子片段再次调用：按记录的原始源范围用新参数重算并替换整组，对齐到其他片段结尾', async () => {
  const { owner, id, fps, refs, sequenceId } = await setup(), app = createApplicationHarness()
  try {
    await app.requireResult('remix_video_edit_music', { ...refs, target: { kind: 'seconds', seconds: 200 }, granularity: 'beat' })
    const first = remixed(owner)
    expect(first.every(value => value.remix!.sourceInUs === 0)).toBe(true)
    // 画面轨道上放一段素材当作“序列结尾”。
    appendVideoEditMedia(id, { id: 'shot', name: '镜头', path: path.resolve(path.sep, 'fixture', 'shot.mp4'), kind: 'video', width: 1920, height: 1080, durationSeconds: 300, hasAudio: false })
    const videoTrack = getActiveVideoEditSequence(owner).tracks.find(t => t.kind === 'video')!.index
    appendVideoEditClip(id, 'shot', { frame: 0, track: videoTrack })
    editVideoSequence(id, sequenceId, sequence => ({ ...sequence, clips: sequence.clips.map(value => value.kind === 'video' ? { ...value, duration: Math.round(120 * fps) } : value) }))
    const result = await app.requireResult('remix_video_edit_music', { ...refs, clipRef: { kind: 'video_edit.clip', id: `${id}:${first[2].id}` }, target: { kind: 'sequence_end' }, granularity: 'phrase', repetition: 0 }) as { targetFrames: number }
    const second = remixed(owner)
    expect(result.targetFrames).toBe(Math.round(120 * fps) - 30)
    expect(new Set(second.map(value => value.remix!.id))).toEqual(new Set([first[0].remix!.id]))
    expect(second.every(value => value.remix!.granularity === 'phrase' && value.remix!.sourceOutUs === first[0].remix!.sourceOutUs)).toBe(true)
    expect(second.some(value => first.some(old => old.id === value.id))).toBe(false)
    expect(second.at(-1)!.start + second.at(-1)!.duration).toBe(Math.round(120 * fps))
  } finally { app.dispose() }
})

it('拒绝时说明原因与可行范围，剪辑不变：自由节奏、目标太短、链接画面', async () => {
  const { owner, id, refs, clip, sequenceId } = await setup(), app = createApplicationHarness(), before = owner.contentVersion
  try {
    boundary.analysis = { ...steadyMusicAnalysis(), suitable: false, unsuitableReason: '节奏是自由的（速度时快时慢或没有稳定拍子）' }
    const free = await app.call('remix_video_edit_music', { ...refs, target: { kind: 'seconds', seconds: 60 } })
    expect(free.ok).toBe(false); expect(JSON.stringify(free)).toContain('节奏是自由的')
    boundary.analysis = steadyMusicAnalysis()
    const short = await app.call('remix_video_edit_music', { ...refs, target: { kind: 'seconds', seconds: 3 } })
    expect(short.ok).toBe(false); expect(JSON.stringify(short)).toContain('可行的最短时长约')
    editVideoSequence(id, sequenceId, sequence => ({ ...sequence, clips: sequence.clips.map(value => value.id === clip.id ? { ...value, linkId: 'link' } : value) }))
    const linked = await app.call('remix_video_edit_music', { ...refs, target: { kind: 'seconds', seconds: 60 } })
    expect(linked.ok).toBe(false); expect(JSON.stringify(linked)).toContain('取消链接')
    expect(owner.contentVersion).toBe(before + 1)
    expect(remixed(owner)).toHaveLength(0)
  } finally { app.dispose() }
})
