import { describe, expect, it } from 'vitest'
import { drawWaveform, waveformSegments, type WaveformPalette } from './waveformDraw'
import type { WaveformData } from '@/services/waveform/waveformDataService'

const palette: WaveformPalette = { wave: '#wave', wavePlayed: '#played', waveCut: '#cut', clipWave: '#clip', line: '#line', lineStrong: '#strong' }

/** Records fills by colour together with the clip rectangles active at that moment. */
function recorder(): { context: CanvasRenderingContext2D; fills: Array<{ color: string; alpha: number; clip: number[][] }>; strokes: string[]; rects: Array<{ color: string; y: number }>; arcs: number } {
  const fills: Array<{ color: string; alpha: number; clip: number[][] }> = []
  const strokes: string[] = []
  const rects: Array<{ color: string; y: number }> = []
  let pending: number[][] = []
  let clip: number[][] = []
  const stack: number[][][] = []
  let arcs = 0
  const context = {
    fillStyle: '', strokeStyle: '', globalAlpha: 1, lineWidth: 1, lineJoin: 'miter',
    clearRect: () => undefined,
    fillRect(_x: number, y: number) { rects.push({ color: this.fillStyle, y }) },
    save: () => { stack.push(clip) }, restore: () => { clip = stack.pop() ?? [] },
    beginPath: () => { pending = [] }, rect: (x: number, y: number, w: number, h: number) => { pending.push([x, y, w, h]) },
    clip: () => { clip = pending },
    moveTo: () => undefined, lineTo: () => undefined, closePath: () => undefined, arc: () => { arcs++ },
    fill() { fills.push({ color: this.fillStyle, alpha: this.globalAlpha, clip }) },
    stroke() { strokes.push(this.strokeStyle) },
  }
  return { context: context as unknown as CanvasRenderingContext2D, fills, strokes, rects, get arcs() { return arcs } }
}
function data(frameCount = 48000): WaveformData {
  const buckets = Math.ceil(frameCount / 128)
  return {
    key: 'k', ref: { source: 'a.wav', channels: 2 }, gain: 2,
    pyramid: { version: 'v', sampleRate: 48000, frameCount, startSeconds: 0, endSeconds: frameCount / 48000, amplitudeScale: 1, peakMax: 0.5, channelCount: 2, levels: [{ samplesPerBucket: 128, bucketCount: buckets, peak: [new Uint16Array(buckets).fill(30000), new Uint16Array(buckets).fill(20000)], rms: [new Uint16Array(buckets).fill(9000), new Uint16Array(buckets).fill(6000)] }] },
  }
}

describe('waveform drawing', () => {
  it('splits the width into exclusive played / rest / cut segments, cuts taking priority', () => {
    expect(waveformSegments(100, 0, 1000, 500, [[200, 300], [250, 400]])).toEqual([
      { from: 0, to: 20, kind: 'played' }, { from: 20, to: 30, kind: 'cut' }, { from: 30, to: 40, kind: 'cut' },
      { from: 40, to: 50, kind: 'played' }, { from: 50, to: 100, kind: 'rest' },
    ])
    expect(waveformSegments(100, 0, 1000, undefined, undefined)).toEqual([{ from: 0, to: 100, kind: 'rest' }])
  })
  it('standard tier draws a translucent peak layer and an opaque RMS layer per lane and colour, from theme tokens', () => {
    const { context, fills, rects } = recorder()
    const mode = drawWaveform(context, { width: 200, height: 80, pixelRatio: 1, data: data(), startFrame: 0, endFrame: 48000, tier: 'standard', tone: 'neutral', palette, playedFrame: 24000, cutRanges: [[0, 4800]] })
    expect(mode).toBe('peaks')
    expect(rects.filter(rect => rect.color === '#line').map(rect => rect.y)).toEqual([20, 60])
    // 2 lanes × 3 colours × (peak + RMS)
    expect(fills).toHaveLength(12)
    expect(new Set(fills.map(fill => fill.color))).toEqual(new Set(['#played', '#wave', '#cut']))
    expect(fills.filter(fill => fill.color === '#wave').map(fill => fill.alpha)).toEqual([0.45, 1, 0.45, 1])
  })
  it('mini tier draws peaks only; clip tone has no played colouring and uses the clip colour', () => {
    const mini = recorder()
    drawWaveform(mini.context, { width: 100, height: 20, pixelRatio: 1, data: data(), lanes: [0], startFrame: 0, endFrame: 48000, tier: 'mini', tone: 'neutral', palette, playedFrame: 24000 })
    expect(mini.fills.map(fill => [fill.color, fill.alpha])).toEqual([['#played', 0.45], ['#wave', 0.45]])
    const clip = recorder()
    drawWaveform(clip.context, { width: 100, height: 20, pixelRatio: 1, data: data(), lanes: [1], startFrame: 0, endFrame: 48000, tier: 'standard', tone: 'clip', palette, playedFrame: 24000 })
    expect(clip.fills.map(fill => [fill.color, fill.alpha])).toEqual([['#clip', 0.38], ['#clip', 0.85]])
    expect(clip.rects.some(rect => rect.color === '#line')).toBe(false)
  })
  it('switches to raw samples below level 0 and to sample points when samples are at least 2 CSS px apart', () => {
    const detail = { key: 'd', firstFrame: 1000, frameCount: 4096, channels: [new Float32Array(4096).fill(0.25), new Float32Array(4096).fill(-0.25)] }
    const samples = recorder()
    expect(drawWaveform(samples.context, { width: 200, height: 40, pixelRatio: 1, data: data(), startFrame: 1000, endFrame: 3000, tier: 'standard', tone: 'neutral', palette, detail })).toBe('samples')
    const points = recorder()
    expect(drawWaveform(points.context, { width: 800, height: 40, pixelRatio: 2, data: data(), startFrame: 1000, endFrame: 1040, tier: 'standard', tone: 'neutral', palette, detail })).toBe('points')
    expect(points.rects.some(rect => rect.color === '#strong')).toBe(true)
    expect(points.strokes).toContain('#played'); expect(points.strokes).toContain('#wave')
    expect(points.arcs).toBeGreaterThan(0)
    // A detail window that does not cover the view keeps the pyramid drawing.
    expect(drawWaveform(recorder().context, { width: 200, height: 40, pixelRatio: 1, data: data(), startFrame: 6000, endFrame: 6100, tier: 'standard', tone: 'neutral', palette, detail })).toBe('peaks')
    expect(drawWaveform(recorder().context, { width: 200, height: 40, pixelRatio: 1, startFrame: 0, endFrame: 10, tier: 'standard', tone: 'neutral', palette })).toBe('empty')
  })
})
