import { describe, expect, it } from 'vitest'
import { planMusicRemix, type MusicRemixGranularity, type MusicRemixRequest } from './musicRemixPlan'
import { steadyMusicAnalysis } from './musicTestFixtures'

const analysis = steadyMusicAnalysis()
const full = (patch: Partial<MusicRemixRequest>): MusicRemixRequest => ({ analysis, sourceStartSeconds: 0, sourceEndSeconds: analysis.durationSeconds, targetSeconds: analysis.durationSeconds, repetition: 0.5, granularity: 'bar', seed: 0, ...patch })
function ready(request: MusicRemixRequest) {
  const plan = planMusicRemix(request)
  if (!plan.ok) throw new Error(`${plan.code}: ${plan.message}`)
  return plan
}
/** 计划内每段包含的拍数（首尾段含前奏与尾奏外的拍）。 */
const runLengths = (plan: ReturnType<typeof ready>): number[] => plan.segments.map(segment => segment.lastBeat - segment.firstBeat + 1)

describe('planMusicRemix', () => {
  it.each([0.45, 0.7, 1.6, 2.4])('reaches %s× length, anchored to the original start and end', ratio => {
    const target = analysis.durationSeconds * ratio
    const plan = ready(full({ targetSeconds: target }))
    expect(plan.durationSeconds).toBeGreaterThanOrEqual(target - 1e-9)
    // 多出的不超过两小节（最短可行结果之外最多再多一小节）。
    expect(plan.overshootSeconds).toBeLessThanOrEqual(2 * 4 * 0.5 + 1e-9)
    expect(plan.segments[0].sourceStartSeconds).toBe(0)
    expect(plan.segments[0].firstBeat).toBe(0)
    expect(plan.segments.at(-1)!.sourceEndSeconds).toBe(analysis.durationSeconds)
    expect(plan.segments.at(-1)!.lastBeat).toBe(analysis.beats.length - 1)
    expect(plan.segments.reduce((sum, segment) => sum + segment.sourceEndSeconds - segment.sourceStartSeconds, 0)).toBeCloseTo(plan.durationSeconds, 9)
    if (ratio > 1) expect(plan.seams.some(seam => seam.kind === 'repeat')).toBe(true)
    if (ratio < 1) expect(plan.seams.some(seam => seam.kind === 'skip')).toBe(true)
  })

  it('only jumps between beats at the same bar position and keeps the beat grid continuous', () => {
    for (const granularity of ['beat', 'bar', 'phrase'] as const) {
      const plan = ready(full({ targetSeconds: analysis.durationSeconds * 1.8, granularity }))
      for (const seam of plan.seams) expect(analysis.barPositions[seam.toBeat]).toBe(analysis.barPositions[seam.fromBeat + 1])
      plan.segments.slice(1).forEach((segment, k) => {
        // 跳入的那一拍落在原本下一拍应在的时刻：前一段在“下一拍”处结束。
        const previous = plan.segments[k]
        expect(previous.sourceEndSeconds).toBe(analysis.beats[previous.lastBeat + 1])
        expect(segment.sourceStartSeconds).toBe(analysis.beats[segment.firstBeat])
      })
    }
  })

  it('never jumps into the intro or out of the outro', () => {
    const plan = ready(full({ targetSeconds: analysis.durationSeconds * 0.5 }))
    const introEnd = analysis.sections[1].startBeat, outroStart = analysis.sections.at(-1)!.startBeat
    for (const seam of plan.seams) {
      expect(seam.toBeat).toBeGreaterThanOrEqual(introEnd)
      expect(seam.fromBeat + 1).toBeLessThanOrEqual(outroStart)
    }
  })

  it('coarser granularity raises the shortest allowed run and never adds seams', () => {
    // 粒度越粗，两次跳转之间的最短距离（下限）越长、可跳位置越少：拍 ⊇ 小节线 ⊇ 乐句起点。
    const minimum: Record<MusicRemixGranularity, number> = { beat: 2, bar: 4, phrase: 16 }
    for (const ratio of [0.55, 1.7, 2.3]) {
      let previousSeams = Infinity
      for (const granularity of ['beat', 'bar', 'phrase'] as const) {
        const plan = ready(full({ targetSeconds: analysis.durationSeconds * ratio, granularity }))
        for (const run of runLengths(plan).slice(0, -1)) expect(run).toBeGreaterThanOrEqual(minimum[granularity])
        if (granularity !== 'beat') for (const seam of plan.seams) expect(analysis.barPositions[seam.toBeat]).toBe(0)
        if (granularity === 'phrase') for (const seam of plan.seams) expect((seam.toBeat - analysis.sections.filter(section => section.startBeat <= seam.toBeat).at(-1)!.startBeat) % 16).toBe(0)
        expect(plan.seams.length).toBeLessThanOrEqual(previousSeams)
        previousSeams = plan.seams.length
      }
    }
  })

  it('more repetition allows shorter loops (monotonic in the loop penalty)', () => {
    const loopPenalty = (loops: number[]): number => loops.reduce((sum, loop) => sum + Math.max(0, 1 - loop / (32 * 4)), 0)
    for (const granularity of ['beat', 'bar'] as const) {
      let previous = -Infinity
      for (const repetition of [0, 0.25, 0.5, 0.75, 1]) {
        const plan = ready(full({ targetSeconds: analysis.durationSeconds * 2.2, repetition, granularity }))
        const penalty = loopPenalty(plan.loopBeats)
        expect(penalty).toBeGreaterThanOrEqual(previous - 1e-9)
        previous = penalty
      }
    }
  })

  it('is deterministic for a seed and varies with another seed', () => {
    const a = ready(full({ targetSeconds: 90, seed: 0 })), b = ready(full({ targetSeconds: 90, seed: 0 }))
    expect(a).toEqual(b)
    const variants = new Set([1, 2, 3, 4, 5, 6].map(seed => JSON.stringify(ready(full({ targetSeconds: 90, seed })).seams.map(seam => [seam.fromBeat, seam.toBeat]))))
    expect(variants.size).toBeGreaterThan(1)
  })

  it('refuses free-rhythm music, too-short excerpts and impossible targets with actionable facts', () => {
    expect(planMusicRemix(full({ analysis: { ...analysis, suitable: false, unsuitableReason: '节奏是自由的' } }))).toMatchObject({ ok: false, code: 'not_rhythmic', message: '节奏是自由的' })
    expect(planMusicRemix(full({ sourceEndSeconds: 5 }))).toMatchObject({ ok: false, code: 'too_short' })
    const short = planMusicRemix(full({ targetSeconds: 3 }))
    expect(short).toMatchObject({ ok: false, code: 'target_too_short' })
    expect(short.ok === false && short.minSeconds).toBeGreaterThan(3)
    expect(planMusicRemix(full({ targetSeconds: analysis.durationSeconds * 20 }))).toMatchObject({ ok: false, code: 'target_too_long' })
  })

  it('remixes only the clip source range', () => {
    const start = analysis.beats[64] - 0.1, end = analysis.beats[200] + 0.2
    const plan = ready(full({ sourceStartSeconds: start, sourceEndSeconds: end, targetSeconds: (end - start) * 1.5 }))
    expect(plan.segments[0].sourceStartSeconds).toBe(start)
    expect(plan.segments.at(-1)!.sourceEndSeconds).toBe(end)
    for (const segment of plan.segments) {
      expect(segment.sourceStartSeconds).toBeGreaterThanOrEqual(start)
      expect(segment.sourceEndSeconds).toBeLessThanOrEqual(end)
    }
  })

  it('plans a three-minute song quickly', () => {
    const long = steadyMusicAnalysis('IABABCABABCABO')
    const started = performance.now()
    ready(full({ analysis: long, sourceEndSeconds: long.durationSeconds, targetSeconds: long.durationSeconds * 2 }))
    expect(performance.now() - started).toBeLessThan(2000)
  })
})
