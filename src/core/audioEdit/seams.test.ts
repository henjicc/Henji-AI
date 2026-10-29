import { describe, expect, it } from 'vitest'
import rawFixture from './__fixtures__/edited-seams.json'
import { applyAudioEditBreathPolicy } from './breaths'
import { applyAudioEditSuggestion } from './edits'
import { cleanAudioEditGaps, type AudioEditLevels } from './gaps'
import { audioEditSilenceSuggestions } from './silence'
import { buildProjectAudioEditTimeline, editedDurationFrames } from './timeline'
import type { AudioBreath } from '../audioAnalysis/breath/respiro'
import type { AudioEditBatchSettings, AudioEditCut, AudioEditProjectDocument } from './types'
import type { AudioEditGainRegion } from './regions'

interface RecordingWindow {
  durationFrames: number; seam?: [number, number]
  words: Array<[number, number, boolean, boolean, string]>
  cuts: AudioEditCut[]; gainRegions: AudioEditGainRegion[]
  breaths: AudioBreath[]; pauses: Array<{ startMs: number; endMs: number }>; levels: AudioEditLevels
}
const fixture = rawFixture as unknown as {
  sampleRate: number; batchSettings: AudioEditBatchSettings
  windows: Record<'commaSeam' | 'sentenceSeam' | 'rerun', RecordingWindow>
}
const seamWindows = [fixture.windows.commaSeam, fixture.windows.sentenceSeam]

/** 时间窗各自从零计时，保留整数采样帧与 10 ms 电平，避免裁剪改变接缝与字头的精度。 */
function recording(window: RecordingWindow): AudioEditProjectDocument {
  return {
    id: 'edited-seams', name: '口播接缝', referenceScript: '', createdAt: 0, updatedAt: 0, revision: 1,
    source: { mediaType: 'audio', sourcePath: 'fixture.wav', audioPath: 'fixture.wav', sampleRate: fixture.sampleRate, durationFrames: window.durationFrames, channels: 2 },
    transcript: window.words.map(([startFrame, endFrame, included, locked, punctuation], index) => ({
      id: `word:${index}`, text: `词${punctuation}`, startFrame, endFrame, included, locked, granularity: 'word',
    })),
    cuts: window.cuts, gainRegions: window.gainRegions, batchSettings: fixture.batchSettings, suggestions: [],
  }
}

const duration = (document: AudioEditProjectDocument): number => editedDurationFrames(buildProjectAudioEditTimeline(document))
const heard = (document: AudioEditProjectDocument, start: number, end: number): number => buildProjectAudioEditTimeline(document)
  .reduce((total, span) => total + Math.max(0, Math.min(end, span.sourceEndFrame) - Math.max(start, span.sourceStartFrame)), 0) / document.source.sampleRate
const seamLength = (document: AudioEditProjectDocument, window: RecordingWindow): number => heard(document, ...window.seam!)
const deleteBreaths = (document: AudioEditProjectDocument, window: RecordingWindow): AudioEditProjectDocument => cleanAudioEditGaps(
  applyAudioEditBreathPolicy(document, window.breaths, 'delete', undefined, window.pauses).document, window.breaths, window.levels,
).document
function compress(document: AudioEditProjectDocument, window: RecordingWindow): AudioEditProjectDocument {
  const pauses = window.pauses.map((pause) => ({ startFrame: Math.ceil(pause.startMs * fixture.sampleRate / 1000), endFrame: Math.floor(pause.endMs * fixture.sampleRate / 1000) }))
  const suggestions = audioEditSilenceSuggestions(document, pauses, document.batchSettings!)
  let next = { ...document, suggestions }
  for (const suggestion of suggestions) next = applyAudioEditSuggestion(next, suggestion.id)
  return next
}

describe('真实口播的脱敏时间轴回归', () => {
  it('重念接缝两侧及碎字尾巴合并处理，重跑不增剪切、不改时长', () => {
    for (const [index, window] of seamWindows.entries()) {
      const original = recording(window)
      // 已落盘样本含手写绕过方案，只在夹具副本里拿掉，才能还原原故障；另一用例保留这些剪切验证保护。
      const beforeWorkaround = { ...original, cuts: original.cuts!.filter((cut) => cut.reason !== 'manual') }
      expect(seamLength(beforeWorkaround, window)).toBeCloseTo([.8369161, .82][index], 7)
      const once = deleteBreaths(beforeWorkaround, window), twice = deleteBreaths(once, window)
      expect(seamLength(once, window)).toBe(.2)
      expect(duration(once)).toBeLessThan(duration(beforeWorkaround))
      expect(twice.cuts).toEqual(once.cuts)
      expect(twice.gainRegions).toEqual(once.gainRegions)
      expect(duration(twice)).toBe(duration(once))
    }
  })

  it('静音压缩沿用文档的保留长度，合并后不足原阈值的接缝也压到目标', () => {
    for (const window of seamWindows) {
      const original = recording(window)
      const beforeWorkaround = { ...original, cuts: original.cuts!.filter((cut) => cut.reason !== 'manual') }
      const once = compress(beforeWorkaround, window), twice = compress(once, window)
      expect(seamLength(once, window)).toBe(.35)
      expect(twice.cuts).toEqual(once.cuts)
      expect(duration(twice)).toBe(duration(once))
      const faster = compress({ ...beforeWorkaround, batchSettings: { ...fixture.batchSettings, retainedSilenceMs: 160 } }, window)
      expect(seamLength(faster, window)).toBe(.16)
    }
  })

  it('手改后不恢复旧自动删除，各窗口所有 manual 剪切逐字段保留', () => {
    for (const window of Object.values(fixture.windows)) {
      const original = recording(window)
      const manual = original.cuts!.filter((cut) => cut.reason === 'manual')
      expect(manual.length).toBeGreaterThan(0)
      const once = deleteBreaths(original, window), twice = deleteBreaths(once, window)
      expect(once.cuts!.filter((cut) => cut.reason === 'manual')).toEqual(manual)
      expect(once.cuts!.slice(0, original.cuts!.length)).toEqual(original.cuts)
      expect(duration(once)).toBeLessThanOrEqual(duration(original))
      expect(duration(twice)).toBe(duration(once))
      expect(twice.cuts).toEqual(once.cuts)
      const compressed = compress(original, window)
      expect(compressed.cuts!.filter((cut) => cut.reason === 'manual')).toEqual(manual)
    }
  })
})
