import { createVideoEditTestProject as createVideoEditProject } from './videoEditDocumentTestKit'
// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { installHarnessNativeStorage, uninstallHarnessNativeStorage } from '@/tests/harnessNativeStorage'
import { createApplicationHarness } from '@/tests/applicationHarness'
import { makeVideoEditItemClip } from '@/core/videoEdit/projectItems'
import { videoEditClipFrameBoundaryAtSource, videoEditClipSourceRange, videoEditClipSourceSecondsAt } from '@/core/videoEdit/clipSpeed'
import { videoEditTimeRemapSpeedAtSource } from '@/core/videoEdit/timeRemap'
import { closeAllVideoEdits, savedVideoEdit } from './videoEditDocumentTestKit'
import { editVideoProject, undoVideoEdit, type VideoEditInstance } from './videoEditService'

vi.mock('../engine/videoEditRenderSession', () => ({ VideoEditRenderSession: class {
  setTracks() {}
  async updateDocument() {}
  async present() { return { presented: true, bitmap: { close() {} } } }
  async dispose() {}
} }))
beforeEach(installHarnessNativeStorage)
afterEach(async () => { await closeAllVideoEdits(); vi.restoreAllMocks(); uninstallHarnessNativeStorage() })

/** 30fps：画面+声音链接的 4 秒片段 a（源 0–4 秒），后面紧跟 c；节拍标记在第 45 帧（1.5 秒）。 */
async function fixture() {
  const owner = await createVideoEditProject()
  editVideoProject(owner.document.id, document => {
    document.media.push({ id: 'media', name: '跑步', path: '/fixture/run.mp4', kind: 'video', width: 64, height: 64, durationSeconds: 20, hasAudio: true })
    document.items.push({ id: 'item', name: '跑步', kind: 'video', mediaId: 'media' })
    const sequence = document.sequences[0]
    const video = sequence.tracks.find(track => track.kind === 'video')!.index
    const audio = sequence.tracks.find(track => track.kind === 'audio')!.index
    const base = makeVideoEditItemClip(document, 'item', sequence.id, { frame: 0, track: video, duration: 120 })
    sequence.clips = [{ ...base, id: 'a', linkId: 'pair', sourceComponent: 'video' }, { ...base, id: 'a-audio', kind: 'audio', track: audio, linkId: 'pair', sourceComponent: 'audio' }, { ...base, id: 'c', start: 120, sourceInUs: 5_000_000 }]
    sequence.markers = [{ id: 'beat', frame: 45, name: '重音', type: 'beat', strength: 1 }]
    return document
  })
  return owner
}
const refs = (owner: VideoEditInstance) => ({ documentRef: { kind: 'video_edit.document', id: owner.document.id }, clipRef: { kind: 'video_edit.clip', id: `${owner.document.id}:a` } })

it('速度坡道吸附节拍：坡道中心的画面不动，音画同曲线、帧混合、后续片段波纹跟随，保存回读且一步撤销', async () => {
  const owner = await fixture(); const app = createApplicationHarness()
  try {
    const before = structuredClone(owner.document.sequences[0]); const history = owner.past.length
    const sourceAtBeat = videoEditClipSourceSecondsAt(before.clips[0], 45, 30)
    const result = await app.call('ramp_video_edit_clip_speed', { ...refs(owner), ramps: [{ atSeconds: 1.4, speedPercent: 25, holdSeconds: .5, easeInSeconds: .2 }], snap: 'beat' })
    expect(result, JSON.stringify(result)).toMatchObject({ ok: true, data: { snappedSeconds: [1.5], verification: { verified: true } } })
    const after = owner.document.sequences[0]; const clip = (id: string) => after.clips.find(value => value.id === id)!
    const a = clip('a')
    expect(a.timeRemap).toBeDefined(); expect(a.speed).toBeUndefined(); expect(a.frameInterpolation).toBe('blend'); expect(a.preservePitch).toBe(true)
    expect(clip('a-audio').timeRemap).toEqual(a.timeRemap)
    // 素材不变（结尾按整帧向下取），慢放让片段变长，后续片段跟着后移。
    expect(videoEditClipSourceRange(a, 30).to).toBeLessThanOrEqual(4); expect(videoEditClipSourceRange(a, 30).to).toBeGreaterThan(4 - 2 / 30)
    expect(a.duration).toBeGreaterThan(130); expect(clip('c').start).toBe(a.duration)
    // 坡道中心那一刻的源画面在曲线上是 25%，并且落在原来的节拍附近（缓入前的内容不变）。
    expect(videoEditTimeRemapSpeedAtSource(a.timeRemap!, sourceAtBeat)).toBeCloseTo(.25, 3)
    expect(videoEditClipFrameBoundaryAtSource(a, .5, 30)).toBeCloseTo(15, 1)
    expect(owner.past.length).toBe(history + 1)
    expect(savedVideoEdit(owner).sequences[0]).toEqual(after)
    const read = (await app.read({ kind: 'video_edit.clip', id: `${owner.document.id}:a` }, ['video_edit.clip.time_remap', 'video_edit.clip.frame_interpolation'])) as { properties: Record<string, unknown> }
    expect(read.properties['video_edit.clip.frame_interpolation']).toBe('blend')
    expect(read.properties['video_edit.clip.time_remap']).toEqual(a.timeRemap)
    undoVideoEdit(owner.document.id)
    expect(owner.document.sequences[0]).toEqual(before)
  } finally { app.dispose() }
})

it('通用属性写曲线与 null：时长随曲线变化、与常数速度互斥；没有节拍标记时吸附给出改道', async () => {
  const owner = await fixture(); const app = createApplicationHarness()
  try {
    const target = { kind: 'video_edit.clip', id: `${owner.document.id}:a` }
    const remap = { points: [{ offsetUs: 0, speed: 2, interpolation: 'linear' }] }
    expect(await app.change(target, { 'video_edit.clip.time_remap': remap, 'video_edit.clip.pitch_semitones': -5 })).toMatchObject({ ok: true })
    let a = owner.document.sequences[0].clips.find(value => value.id === 'a')!
    expect(a.duration).toBe(60); expect(a.pitchSemitones).toBe(-5)
    expect(await app.change(target, { 'video_edit.clip.speed_percent': 50 })).toMatchObject({ ok: true })
    a = owner.document.sequences[0].clips.find(value => value.id === 'a')!
    expect(a.timeRemap).toBeUndefined(); expect(a.speed).toEqual({ numerator: 1, denominator: 2 })
    editVideoProject(owner.document.id, document => { document.sequences[0].markers = []; return document })
    const refused = await app.call('ramp_video_edit_clip_speed', { ...refs(owner), ramps: [{ atSeconds: 1, speedPercent: 50 }], snap: 'beat' })
    expect(JSON.stringify(refused)).toContain('analyze_video_edit_beats')
  } finally { app.dispose() }
})

it('序列开着帧混合时，片段选帧采样会明确记下；序列默认帧采样时选帧采样不写出（省略即跟随序列）', async () => {
  const owner = await fixture(); const id = owner.document.id
  const clip = () => owner.document.sequences[0].clips.find(value => value.id === 'a')!
  const { executeVideoEditTimelineEdit } = await import('./videoEditTimeline')
  const setInterpolation = (frameInterpolation: 'nearest' | 'blend'): void => { executeVideoEditTimelineEdit(id, owner.document.sequences[0].id, { kind: 'speed', clipIds: ['a'], linked: { links: false, groups: false }, change: { frameInterpolation } }) }
  setInterpolation('blend'); expect(clip().frameInterpolation).toBe('blend')
  setInterpolation('nearest'); expect(clip().frameInterpolation).toBeUndefined()
  editVideoProject(id, document => ({ ...document, sequences: document.sequences.map((sequence, index) => index ? sequence : { ...sequence, frameBlend: true }) }))
  setInterpolation('nearest'); expect(clip().frameInterpolation).toBe('nearest')
})
