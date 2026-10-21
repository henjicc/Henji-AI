import { describe, expect, it } from 'vitest'
import { planMusicRemix } from '../audioAnalysis/music/musicRemixPlan'
import { steadyMusicAnalysis } from '../audioAnalysis/music/musicTestFixtures'
import { videoEditSequenceSchema, type VideoEditClip, type VideoEditSequence } from './document'
import { applyMusicRemixToSequence, layoutMusicRemix, MUSIC_REMIX_SEAM_LEAD_SECONDS, videoEditSourceTimeFromSeconds } from './musicRemix'
import { videoEditTransitionWindow } from './transitions'

const analysis = steadyMusicAnalysis()
function plan(targetSeconds: number) {
  const result = planMusicRemix({ analysis, sourceStartSeconds: 0, sourceEndSeconds: analysis.durationSeconds, targetSeconds, repetition: 0.5, granularity: 'bar', seed: 0, marginSeconds: 1 / 24 })
  if (!result.ok) throw new Error(result.message)
  return result
}
const sourceSeconds = (clip: Pick<VideoEditClip, 'sourceInUs' | 'sourceRemainder'>): number => (clip.sourceInUs + clip.sourceRemainder.numerator / clip.sourceRemainder.denominator) / 1e6

function sequenceWith(clips: VideoEditClip[]): VideoEditSequence {
  return {
    id: 'seq', name: '序列', width: 1920, height: 1080, frameRate: { numerator: 24, denominator: 1 }, pixelAspectRatio: { numerator: 1, denominator: 1 }, sampleRate: 48000, channels: 2,
    tracks: [{ id: 'v1', name: 'V1', index: 0, kind: 'video', locked: false, enabled: true, muted: false, solo: false }, { id: 'a1', name: 'A1', index: 1, kind: 'audio', locked: false, enabled: true, muted: false, solo: false }],
    clips, annotations: [],
  } as VideoEditSequence
}
const music: VideoEditClip = { id: 'music', itemId: 'item', name: '配乐', kind: 'audio', track: 1, start: 48, duration: 24 * 60, sourceInUs: 0, sourceRemainder: { numerator: 0, denominator: 1 }, x: 0.5, y: 0.5, scale: 1, rotation: 0, opacity: 1, volume: 0.8, text: '', fadeInFrames: 12 } as VideoEditClip

describe('music remix timeline layout', () => {
  it.each([24, 25, 30, 60])('fills exactly the target frames at %s fps and keeps every jumped-in beat on the original grid', fps => {
    for (const ratio of [0.6, 1.7]) {
      const targetFrames = Math.round(analysis.durationSeconds * ratio * fps)
      const result = plan(targetFrames / fps)
      const layout = layoutMusicRemix(result, fps, targetFrames)
      expect(layout.pieces.reduce((sum, piece) => sum + piece.durationFrames, 0)).toBe(targetFrames)
      layout.pieces.forEach((piece, k) => {
        if (k === 0) { expect(piece.startFrame).toBe(0); expect(piece.sourceInSeconds).toBe(0); return }
        const segment = result.segments[k]
        // 跳入的第一拍在时间线上的时刻 = 理想时刻（误差为零）；切点在起音之前 30 ms ± 半帧。
        expect(piece.startFrame / fps + (segment.sourceStartSeconds - piece.sourceInSeconds)).toBeCloseTo(segment.timelineSeconds, 9)
        const lead = segment.sourceStartSeconds - piece.sourceInSeconds
        expect(lead).toBeGreaterThanOrEqual(MUSIC_REMIX_SEAM_LEAD_SECONDS - 0.5 / fps - 1e-9)
        expect(lead).toBeLessThanOrEqual(MUSIC_REMIX_SEAM_LEAD_SECONDS + 0.5 / fps + 1e-9)
        expect(piece.seamConfidence).toBe(result.seams[k - 1].confidence)
      })
      expect(layout.trimmedSeconds).toBeGreaterThanOrEqual(0)
      expect(layout.trimmedSeconds).toBeCloseTo(result.overshootSeconds, 0)
      if (layout.trimmedSeconds > 0.05) expect(layout.tailFadeFrames).toBeGreaterThan(0)
    }
  })

  it('replaces the clip with sub-clips joined by end-aligned constant-power crossfades in one sequence edit', () => {
    const fps = 24, targetFrames = 24 * 100
    const result = plan(targetFrames / fps)
    const layout = layoutMusicRemix(result, fps, targetFrames)
    let next = 0
    const applied = applyMusicRemixToSequence({ sequence: sequenceWith([music]), replaceClipIds: ['music'], startFrame: music.start, layout, remix: { id: 'remix-1', targetFrames, repetition: 0.5, granularity: 'bar', seed: 0, analysisIdentity: 'sha:1', sourceInUs: 0, sourceOutUs: 60_000_000 }, newId: () => `id-${next++}` })
    expect(applied.sequence.clips.some(clip => clip.id === 'music')).toBe(false)
    expect(applied.clips).toHaveLength(layout.pieces.length)
    expect(applied.clips[0]).toMatchObject({ start: 48, fadeInFrames: 12, groupId: 'remix-1', remix: { id: 'remix-1', segment: 0 } })
    expect(applied.clips.at(-1)!.start + applied.clips.at(-1)!.duration).toBe(48 + targetFrames)
    applied.clips.forEach((clip, k) => {
      expect(sourceSeconds(clip)).toBeCloseTo(layout.pieces[k].sourceInSeconds, 6)
      expect(clip.volume).toBeCloseTo(0.8 * 10 ** (layout.pieces[k].gainDb / 20), 9)
    })
    expect(applied.transitions).toHaveLength(applied.clips.length - 1)
    for (const transition of applied.transitions) {
      const window = videoEditTransitionWindow(applied.sequence, transition)
      // 过渡整段在切点之前。
      expect(window.end).toBe(window.cut)
      expect(transition.kind).toBe('constant_power')
    }
    expect(() => videoEditSequenceSchema.parse(applied.sequence)).not.toThrow()
  })

  it('refuses to cover another clip on the same track and names it', () => {
    const fps = 24, targetFrames = 24 * 100
    const layout = layoutMusicRemix(plan(targetFrames / fps), fps, targetFrames)
    const blocker = { ...music, id: 'sfx', name: '音效', start: 48 + 24 * 70, duration: 24 }
    expect(() => applyMusicRemixToSequence({ sequence: sequenceWith([music, blocker]), replaceClipIds: ['music'], startFrame: 48, layout, remix: { id: 'r', targetFrames, repetition: 0.5, granularity: 'bar', seed: 0, analysisIdentity: 'x', sourceInUs: 0, sourceOutUs: 1 }, newId: () => crypto.randomUUID() })).toThrow('音效')
  })

  it('converts seconds to microseconds with a sub-microsecond remainder', () => {
    expect(videoEditSourceTimeFromSeconds(2.00000125)).toEqual({ sourceInUs: 2000001, sourceRemainder: { numerator: 250, denominator: 1000 } })
  })
})
