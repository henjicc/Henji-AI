import { describe, expect, it } from 'vitest'
import { AUDIO_EDIT_SPLICE_QUIET_HALF_SECONDS, AUDIO_EDIT_SPLICE_SPEECH_HALF_SECONDS, AudioEditSpliceRenderer, audioEditCrossfadeGains } from './spliceCrossfade'
import type { AudioEditTimelineSpan } from './types'

const RATE = 48000

function spansOf(...ranges: Array<[number, number, boolean?]>): AudioEditTimelineSpan[] {
  let output = 0
  return ranges.map(([start, end, muted]) => {
    const span = { sourceStartFrame: start, sourceEndFrame: end, outputStartFrame: output, outputEndFrame: output + end - start, ...(muted ? { muted: true } : {}) }
    output += end - start
    return span
  })
}

function rendererOf(source: Float32Array, channels: number, spans: AudioEditTimelineSpan[]) {
  const frames = source.length / channels
  return new AudioEditSpliceRenderer(spans, { sampleRate: RATE, channels, durationFrames: frames }, {
    async read(start, count) {
      const output = new Float32Array(count * channels)
      for (let frame = Math.max(0, start); frame < Math.min(frames, start + count); frame++) {
        for (let channel = 0; channel < channels; channel++) output[(frame - start) * channels + channel] = source[frame * channels + channel]
      }
      return output
    },
  })
}

async function renderAll(renderer: AudioEditSpliceRenderer, spans: AudioEditTimelineSpan[], channels: number, chunk = Infinity): Promise<Float32Array> {
  const total = spans.reduce((sum, span) => sum + span.sourceEndFrame - span.sourceStartFrame, 0)
  const output = new Float32Array(total * channels)
  for (const [index, span] of spans.entries()) {
    const length = span.sourceEndFrame - span.sourceStartFrame
    for (let local = 0; local < length; local += Math.min(chunk, length)) {
      output.set(await renderer.render(index, local, Math.min(length, local + chunk)), (span.outputStartFrame + local) * channels)
    }
  }
  return output
}

/** 两段不同相位的正弦：硬接时拼接点有明显跳变 */
const sine = (frames: number, amplitude: number, phaseAt = 0) => Float32Array.from({ length: frames }, (_, i) => amplitude * Math.sin(2 * Math.PI * 220 * i / RATE + (i >= phaseAt ? 2 : 0)))

describe('剪切点交叉淡化', () => {
  it('等功率：两侧增益平方和为 1，中点各约 0.707', () => {
    for (const k of [0, 50, 99, 150, 199]) {
      const [a, b] = audioEditCrossfadeGains(k, 100)
      expect(a * a + b * b).toBeCloseTo(1, 6)
    }
    expect(audioEditCrossfadeGains(99.5, 100)[0]).toBeCloseTo(Math.SQRT1_2, 6)
  })

  it('落在安静处的拼接两侧各 20 ms，贴着说话的各 5 ms；时间线长度不变', async () => {
    const quiet = sine(RATE, 0.001)
    const loud = sine(RATE, 0.5)
    const spans = spansOf([0, 12000], [30000, 48000])
    expect((await rendererOf(quiet, 1, spans).plan(0)).halfFrames).toBe(Math.round(RATE * AUDIO_EDIT_SPLICE_QUIET_HALF_SECONDS))
    expect((await rendererOf(loud, 1, spans).plan(0))).toEqual({ kind: 'crossfade', halfFrames: Math.round(RATE * AUDIO_EDIT_SPLICE_SPEECH_HALF_SECONDS) })
    expect(await renderAll(rendererOf(loud, 1, spans), spans, 1)).toHaveLength(30000)
  })

  it('借用被删部分的声音：拼接点不再跳变，远离拼接点的样本原样保留', async () => {
    const source = sine(RATE, 0.5, 20000)
    const spans = spansOf([0, 12000], [30000, 48000])
    const output = await renderAll(rendererOf(source, 1, spans), spans, 1)
    const hardJump = Math.abs(source[30000] - source[11999])
    const jump = Math.max(...Array.from({ length: 600 }, (_, i) => Math.abs(output[11700 + i + 1] - output[11700 + i])))
    expect(jump).toBeLessThan(hardJump / 5)
    expect(output.slice(0, 11000)).toEqual(source.slice(0, 11000))
    expect(output.slice(13000, 18000)).toEqual(source.slice(31000, 36000))
  })

  it('任意分块渲染与整段渲染逐样本一致（试听分块读、导出按秒写）', async () => {
    const source = Float32Array.from({ length: 96000 }, (_, i) => Math.sin(i / 7) * 0.4 + Math.sin(i / 31) * 0.2)
    const spans = spansOf([0, 9000], [12000, 12500], [20000, 30000, true], [30000, 47000])
    const whole = await renderAll(rendererOf(source, 2, spans), spans, 2)
    for (const chunk of [1, 37, 240, 1000]) expect(await renderAll(rendererOf(source, 2, spans), spans, 2, chunk)).toEqual(whole)
  })

  it('进出静音只淡入淡出，不把静音区的声音借出来；连续且同为静音的边界不处理', async () => {
    const source = sine(RATE, 0.5)
    const spans = spansOf([0, 10000], [10000, 20000, true], [20000, 30000])
    const renderer = rendererOf(source, 1, spans)
    expect(await renderer.plan(0)).toEqual({ kind: 'fade', halfFrames: Math.round(RATE * AUDIO_EDIT_SPLICE_SPEECH_HALF_SECONDS) })
    const output = await renderAll(renderer, spans, 1)
    expect(output.slice(10000, 20000).every((value) => value === 0)).toBe(true)
    expect(Math.abs(output[9999])).toBeLessThan(0.01)
    expect(await rendererOf(source, 1, spansOf([0, 10000, true], [10000, 20000, true])).plan(0)).toEqual({ kind: 'none', halfFrames: 0 })
  })

  it('从片段中间开始读：不等远处拼接点两侧的声音，结尾的判断在后台提前开始', async () => {
    const source = sine(RATE * 2, 0.5)
    const spans = spansOf([0, 12000], [30000, 60000], [70000, 90000])
    const reads: number[] = []
    let releaseFar!: () => void
    const far = new Promise<void>(resolve => { releaseFar = resolve })
    const renderer = new AudioEditSpliceRenderer(spans, { sampleRate: RATE, channels: 1, durationFrames: source.length }, {
      async read(start, count) {
        reads.push(start)
        // 远处两个拼接点（12000/30000、60000/70000）附近的声音迟迟读不回来
        if (Math.abs(start - 12000) < 2000 || Math.abs(start - 30000) < 2000 || Math.abs(start - 60000) < 2000 || Math.abs(start - 70000) < 2000) await far
        return source.slice(Math.max(0, start), start + count)
      },
    })
    const middle = await renderer.render(1, 10000, 11000)
    expect(middle).toEqual(source.slice(40000, 41000))
    // 结尾拼接点的判断已在后台发起，开头拼接点不在这一段的范围里，不读
    expect(reads.some(start => Math.abs(start - 60000) < 2000)).toBe(true)
    expect(reads.some(start => Math.abs(start - 12000) < 2000)).toBe(false)
    releaseFar()
    const whole = await renderAll(rendererOf(source, 1, spans), spans, 1)
    const tail = await renderer.render(1, 29000, 30000)
    expect(tail).toEqual(whole.slice(12000 + 29000, 12000 + 30000))
  })

  it('短片段与文件边界：淡化不超过片段一半，也不借文件以外的声音', async () => {
    const source = sine(RATE, 0.5)
    const spans = spansOf([100, 104], [30000, 30003], [47990, 48000])
    const renderer = rendererOf(source, 1, spans)
    expect((await renderer.plan(0)).halfFrames).toBeLessThanOrEqual(1)
    expect((await renderer.plan(1)).halfFrames).toBeLessThanOrEqual(1)
    const output = await renderAll(renderer, spans, 1)
    expect(output).toHaveLength(17)
    expect(output.every(Number.isFinite)).toBe(true)
  })
})
