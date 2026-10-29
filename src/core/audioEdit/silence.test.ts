import { expect, it } from 'vitest'
import { applyAudioEditSuggestion, DEFAULT_AUDIO_EDIT_SETTINGS } from './edits'
import { audioEditSilenceSuggestions } from './silence'
import { buildProjectAudioEditTimeline, editedDurationFrames } from './timeline'
import type { AudioEditProjectDocument } from './types'

function recording(): AudioEditProjectDocument {
  return {
    id: 'seam', name: '接缝', referenceScript: '', suggestions: [], createdAt: 0, updatedAt: 0, revision: 1,
    source: { mediaType: 'audio', sourcePath: 'voice.wav', audioPath: 'voice.wav', sampleRate: 1000, durationFrames: 3000, channels: 1 },
    transcript: [{ id: 'left', text: '词，', startFrame: 0, endFrame: 500, included: true, locked: false, granularity: 'word' },
      { id: 'right', text: '词', startFrame: 2000, endFrame: 3000, included: true, locked: false, granularity: 'word' }],
    cuts: [{ id: 'manual-seam', startFrame: 800, endFrame: 1600, reason: 'manual', enabled: true },
      { id: 'manual-mute', startFrame: 500, endFrame: 800, reason: 'manual', enabled: true, mode: 'mute' }],
    batchSettings: { ...DEFAULT_AUDIO_EDIT_SETTINGS, retainedSilenceMs: 200 },
  }
}
const pauses = [{ startFrame: 500, endFrame: 800 }, { startFrame: 1600, endFrame: 2000 }]

it('源停顿各自不足阈值，删除后相邻就按总长压缩，静音仍占时长，manual 不变', () => {
  const before = recording()
  const suggestions = audioEditSilenceSuggestions(before, pauses, before.batchSettings!)
  expect(suggestions).toHaveLength(1)
  const once = applyAudioEditSuggestion({ ...before, suggestions }, suggestions[0].id)
  expect(editedDurationFrames(buildProjectAudioEditTimeline(once))).toBe(1700)
  expect(once.cuts!.slice(0, before.cuts!.length)).toEqual(before.cuts)
  expect(audioEditSilenceSuggestions(once, pauses, before.batchSettings!)).toEqual([])
  expect(applyAudioEditSuggestion(once, suggestions[0].id)).toBe(once)
})

it('实际仍有声音隔着的两段静音不能相加，选区和锁定不能被跨过', () => {
  const before = recording()
  expect(audioEditSilenceSuggestions({ ...before, cuts: [] }, pauses, before.batchSettings!)).toEqual([])
  expect(audioEditSilenceSuggestions(before, pauses, before.batchSettings!, { startFrame: 600, endFrame: 2200 })).toEqual([])
  const locked = { ...before, transcript: [...before.transcript, { ...before.transcript[0], id: 'locked', startFrame: 1000, endFrame: 1100, locked: true }] }
  expect(audioEditSilenceSuggestions(locked, pauses, before.batchSettings!)).toEqual([])
})

it('开头结尾以成片位置判断，不能因源录音开头已删除而误压开场留白', () => {
  const before = recording()
  const edge = { ...before, transcript: [], cuts: [{ id: 'head', startFrame: 0, endFrame: 500, reason: 'manual' as const, enabled: true }] }
  expect(audioEditSilenceSuggestions(edge, [{ startFrame: 500, endFrame: 1700 }], before.batchSettings!)).toEqual([])
  expect(audioEditSilenceSuggestions(edge, [{ startFrame: 500, endFrame: 1700 }], { ...before.batchSettings!, trimEdges: true })).toHaveLength(1)
})
