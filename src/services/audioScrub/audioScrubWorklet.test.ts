import fs from 'node:fs'
import vm from 'node:vm'
import { expect, it } from 'vitest'

const RATE = 48000
const BLOCK = RATE / 4
const TOTAL = RATE * 60
interface Processor { port: { onmessage: (event: { data: object }) => void }; process(inputs: never[], outputs: Float32Array[][]): boolean }
type Message = { type: string; index?: number; indices?: number[] }
/**
 * 三种声源：探针（左声道恒为 1 读出音量包络，右声道 = 源秒数 / 100 读出正在播放的源位置；没有波形细节，接缝位置不确定，
 * 只用来看音量与大致位置）、谐波音（基频 220Hz，检查音高）与确定的伪随机噪声（检查原速接续是否逐样本等于原声）。
 */
type Kind = 'probe' | 'tone' | 'noise' | 'clicks'
function sample(kind: Kind, channel: number, k: number): number {
  if (kind === 'probe') return channel === 0 ? 1 : k / RATE / 100
  if (kind === 'clicks') { const i = k % Math.round(RATE * 0.037); return Math.min(1, i / 5) * Math.exp(-i / (RATE * 0.015)) * Math.sin(2 * Math.PI * 2000 * i / RATE) * 0.8 }
  if (kind === 'noise') { const x = Math.sin(k * 12.9898 + channel * 78.233) * 43758.5453; return (x - Math.floor(x)) - 0.5 }
  let value = 0
  for (let harmonic = 1; harmonic <= 6; harmonic++) value += Math.sin(2 * Math.PI * 220 * harmonic * k / RATE) / harmonic
  return value * 0.25
}

function harness(options: { kind?: Kind; loaded?: (index: number) => boolean } = {}) {
  const kind = options.kind ?? 'probe'
  const posted: Message[] = []
  let Constructor!: new () => Processor
  const context = vm.createContext({ sampleRate: RATE, currentFrame: 0, AudioWorkletProcessor: class { port = { postMessage: (message: Message) => posted.push(message), onmessage: null } }, registerProcessor: (_name: string, value: typeof Constructor) => { Constructor = value } })
  vm.runInContext(fs.readFileSync(new URL('./audioScrubWorklet.js', import.meta.url), 'utf8'), context)
  const processor = new Constructor() as Processor & { segments: Array<{ fade: number; fadeTarget: number }> }
  const send = (data: object) => processor.port.onmessage({ data })
  const concurrent: number[] = []
  const block = (index: number) => [0, 1].map(channel => Float32Array.from({ length: BLOCK }, (_, i) => sample(kind, channel, index * BLOCK + i)))
  send({ type: 'config', key: 1, sampleRate: RATE, channels: 2, blockFrames: BLOCK, frames: TOTAL })
  for (let index = 70; index < 110; index++) if (options.loaded?.(index) ?? true) send({ type: 'block', key: 1, index, planes: block(index) })
  const left: number[] = [], right: number[] = []
  let frame = 0
  const queue: Array<{ at: number } & Record<string, unknown>> = []
  /** 渲染到 ms 毫秒（量子对齐），期间按时刻送出 ops（没送完的留到下一次 run）。 */
  const run = (until: number, ops: Array<{ at: number } & Record<string, unknown>> = []) => {
    queue.push(...ops)
    queue.sort((a, b) => a.at - b.at)
    while (frame < until / 1000 * RATE) {
      context.currentFrame = frame
      while (queue.length && queue[0].at <= frame / RATE * 1000) send(queue.shift()!)
      const out = [new Float32Array(128), new Float32Array(128)]
      processor.process([], [out])
      left.push(...out[0]); right.push(...out[1])
      concurrent.push(processor.segments.filter(segment => segment.fade > 0 || segment.fadeTarget > 0).length)
      frame += 128
    }
  }
  const index = (ms: number) => Math.round(ms / 1000 * RATE)
  const gain = (ms: number) => left[index(ms)]
  const position = (ms: number) => right[index(ms)] / left[index(ms)] * 100
  /** 以 ms 为中心、span 毫秒内的平均播放速度（相对原速）。 */
  const speed = (ms: number, span: number) => (position(ms + span / 2) - position(ms - span / 2)) / (span / 1000)
  const maxStep = () => { let max = 0; for (let i = 1; i < left.length; i++) max = Math.max(max, Math.abs(left[i] - left[i - 1])); return max }
  return { send, run, gain, position, speed, maxStep, posted, left, right, block, index, concurrent }
}
/** 60Hz 指针事件：从 start 秒起以 speed 倍速拖动 [from, to) 毫秒；fps 给出时按帧取整（剪辑时间线）。 */
function drag(from: number, to: number, start: number, speed: number, fps = 0) {
  const ops = []
  for (let t = from; t < to; t += 1000 / 60) {
    const seconds = start + speed * (t - from) / 1000
    ops.push({ at: t, type: 'move', position: (fps ? Math.round(seconds * fps) / fps : seconds) * RATE, quantum: fps ? RATE / fps : 0 })
  }
  return ops
}
/** YIN 基频（Hz）。 */
function pitch(signal: number[], start: number, size = 1200): number {
  const maxLag = Math.floor(RATE / 80), minLag = Math.floor(RATE / 600)
  const cmnd = new Float64Array(maxLag + 2)
  let running = 0
  for (let lag = 1; lag <= maxLag + 1; lag++) {
    let sum = 0
    for (let i = 0; i < size; i++) { const d = signal[start + i] - signal[start + i + lag]; sum += d * d }
    running += sum; cmnd[lag] = sum * lag / (running || 1)
  }
  let best = minLag
  for (let lag = minLag; lag <= maxLag; lag++) if (cmnd[lag] < 0.15) { while (lag < maxLag && cmnd[lag + 1] < cmnd[lag]) lag++; best = lag; break }
  const a = cmnd[best - 1], b = cmnd[best], c = cmnd[best + 1]
  return RATE / (best + 0.5 * (a - c) / (a - 2 * b + c))
}

it.each([0, 60, 30])('跟着指针走（帧取整 %i）：原速片段，向前接着放、向后一块块往回铺，停住后很快静音', fps => {
  const h = harness()
  h.run(1700, [{ at: 0, type: 'rest', position: 20 * RATE }, ...drag(0, 700, 20, 1, fps), ...drag(700, 1300, 20.7, -0.5, fps)])
  // 1x 段：连续原速播放，紧跟指针
  for (const ms of [200, 400, 600]) {
    expect(h.gain(ms)).toBe(1)
    expect(h.speed(ms, 2)).toBeCloseTo(1, 2)
    expect(Math.abs(h.position(ms) - (20 + ms / 1000))).toBeLessThan(0.02 + (fps ? 0.5 / fps : 0))
  }
  // 倒拖 0.5x：发声时都是正着的原速片段，位置跟着指针往回走，每块从上一块之前开始（不重放）
  const starts: number[] = []
  let lastStart = -Infinity
  for (let ms = 760; ms < 1290; ms += 1) {
    if (h.gain(ms) !== 1 || h.gain(ms - 1) !== 1 || h.gain(ms + 1) !== 1) continue
    expect(h.speed(ms, 1)).toBeCloseTo(1, 2)
    expect(Math.abs(h.position(ms) - (20.7 - 0.5 * (ms - 700) / 1000))).toBeLessThan(0.08)
    if (h.gain(ms - 4) < 1 && ms - lastStart > 10) { starts.push(h.position(ms)); lastStart = ms }
  }
  expect(starts.length).toBeGreaterThan(3)
  for (let index = 1; index < starts.length; index++) expect(starts[index]).toBeLessThan(starts[index - 1])
  // 指针在 1300ms 停住：约 60ms 内静音（按帧取整时要等过下一帧该到的时间）
  expect(h.gain(1300 + 60 + (fps ? 1.9 * 1000 / (fps * 0.5) : 0))).toBe(0)
  // 起、停、换向、拼接都没有包络突变（最陡也慢于 1ms 满幅），同时发声最多两段
  expect(h.maxStep()).toBeLessThan(1 / 48)
  expect(Math.max(...h.concurrent)).toBeLessThanOrEqual(2)
})

it('慢拖是一段段干脆的原速声音：不重复、不叠在一起，指针追上停下的位置再接着放', () => {
  const h = harness()
  h.run(1300, [{ at: 0, type: 'rest', position: 20 * RATE }, ...drag(0, 1200, 20, 0.3)])
  const heard: number[] = []
  for (let i = h.index(20); i < h.index(1150); i++) if (h.left[i] === 1) heard.push(h.right[i] / h.left[i] * 100)
  // 听到的位置单调前进（没有回放），总共听到的源时长不超过指针走过的距离
  for (let index = 1; index < heard.length; index++) expect(heard[index]).toBeGreaterThan(heard[index - 1])
  expect(heard.at(-1)! - 20).toBeLessThan(0.3 * 1.15 + 0.1)
  // 片段之间有静音（不是一直响），每段至少几十毫秒
  let pieces = 0
  for (let i = h.index(20); i < h.index(1150); i++) if (h.left[i - 1] === 0 && h.left[i] > 0) pieces++
  expect(pieces).toBeGreaterThan(2)
  // 两段同时发声只在几毫秒的交叉淡化里
  let overlap = 0, longest = 0
  for (const count of h.concurrent) { overlap = count >= 2 ? overlap + 1 : 0; longest = Math.max(longest, overlap) }
  expect(longest * 128 / RATE).toBeLessThanOrEqual(0.006)
})

it('左右声道同一位置、同一接缝、同一包络：左右相同的声源输出左右逐样本相同', () => {
  const h = harness({ kind: 'noise' })
  // 让两个声道相同：重新送块
  for (let index = 70; index < 110; index++) { const plane = h.block(index)[0]; h.send({ type: 'block', key: 1, index, planes: [plane, plane] }) }
  h.run(2000, [{ at: 0, type: 'rest', position: 20 * RATE }, ...drag(0, 500, 20, 0.4), ...drag(500, 900, 20.2, 4), ...drag(900, 1500, 21.8, -0.7, 60)])
  expect(h.left.some(value => value !== 0)).toBe(true)
  for (let i = 0; i < h.left.length; i++) if (h.left[i] !== h.right[i]) throw new Error(`第 ${i} 个样本左右不同`)
})

it('瞬态不被抹平：拖动时音头的起音时间与原声相同', () => {
  const h = harness({ kind: 'clicks' })
  h.run(1500, [{ at: 0, type: 'rest', position: 20 * RATE }, ...drag(0, 400, 20, 1), ...drag(400, 900, 20.4, 0.5), ...drag(900, 1400, 20.65, 2.5, 60)])
  const rise = (signal: number[], at: number) => {
    let peak = 0; for (let k = at; k < at + 240; k++) peak = Math.max(peak, Math.abs(signal[k]))
    let a = at, b = at
    while (Math.abs(signal[a]) < 0.1 * peak) a++
    while (Math.abs(signal[b]) < 0.9 * peak) b++
    return b - a
  }
  const attacks: number[] = []
  for (let i = h.index(10); i < h.index(1400); i++) if (Math.abs(h.left[i - 1]) < 1e-4 && Math.abs(h.left[i]) >= 1e-4 && h.concurrent[Math.floor(i / 128)] === 1) { attacks.push(rise(h.left, i)); i += 960 }
  const source = Array.from({ length: 2000 }, (_, i) => sample('clicks', 0, i + Math.round(RATE * 0.037) - 10))
  expect(attacks.length).toBeGreaterThan(10)
  attacks.sort((a, b) => a - b)
  // 音头与原声一样陡（几个样本内升到峰值）；其余是片段在两个音头之间起音（2ms 淡入叠着衰减的尾巴），也不超过 5ms
  const sharp = attacks.filter(value => value <= rise(source, 0) + 1).length
  expect(sharp / attacks.length).toBeGreaterThan(0.8)
  expect(attacks.at(-1)!).toBeLessThanOrEqual(0.005 * RATE)
})

it.each([0, 60])('按原速拖动（帧取整 %i）时自然接续：输出逐样本等于原声', fps => {
  const h = harness({ kind: 'noise' })
  h.run(800, [{ at: 0, type: 'rest', position: 20 * RATE }, ...drag(0, 800, 20, 1, fps)])
  const from = h.index(250), to = h.index(700)
  // 找输出与原声对齐的偏移（播放位置落后指针的时间），该偏移下残差为零
  let best = 0, bestError = Infinity
  for (let shift = -1200; shift <= 1200; shift++) {
    let error = 0
    for (let i = from; i < to; i += 97) error += (h.left[i] - sample('noise', 0, 20 * RATE + i + shift)) ** 2
    if (error < bestError) { bestError = error; best = shift }
  }
  let residual = 0
  for (let i = from; i < to; i++) residual = Math.max(residual, Math.abs(h.left[i] - Math.fround(sample('noise', 0, 20 * RATE + i + best))))
  expect(residual).toBeLessThan(1e-6)
  expect(Math.abs(best) / RATE).toBeLessThan(0.02)
})

it('慢拖、快拖、倒拖时输出都是原声音高，接缝按波形对齐', () => {
  const h = harness({ kind: 'tone' })
  h.run(2800, [{ at: 0, type: 'rest', position: 20 * RATE }, ...drag(0, 600, 20, 0.4, 60), ...drag(600, 1200, 20.24, 3, 60), ...drag(1200, 1800, 22.04, -1, 60), ...drag(1800, 2200, 21.44, 0.25), ...drag(2200, 2550, 21.54, 8)])
  const deviations: number[] = []
  for (let ms = 100; ms < 2520; ms += 10) {
    const start = h.index(ms)
    // 只看完整发声的窗（窗内每 2.5ms 都在响）：片段之间的静音与淡入淡出不算音高
    let sounding = true
    for (let piece = start; piece < start + 1200 + 600 && sounding; piece += 120) sounding = h.left.slice(piece, piece + 120).reduce((sum, value) => sum + value * value, 0) / 120 > 0.01
    if (!sounding) continue
    deviations.push(Math.abs(1200 * Math.log2(pitch(h.left, start) / 220)))
  }
  expect(deviations.length).toBeGreaterThan(60)
  deviations.sort((a, b) => a - b)
  expect(deviations[Math.floor(deviations.length * 0.95)]).toBeLessThan(2) // 音分
})

it('快甩：一段段原速声音跟上指针，声音不断', () => {
  const h = harness()
  h.run(700, [{ at: 0, type: 'rest', position: 20 * RATE }, ...drag(0, 500, 20, 10)])
  for (let ms = 60; ms < 500; ms += 1) expect(h.gain(ms)).toBeGreaterThan(0.6)
  expect(Math.abs(20 + 10 * 0.48 - h.position(480))).toBeLessThan(0.2)
  expect(h.maxStep()).toBeLessThan(1 / 48)
})

it('单步播放约 0.1 秒原速声音，按住方向键接连单步时连续播放', () => {
  const h = harness()
  h.run(400, [{ at: 50, type: 'step', position: 20 * RATE, frames: 0.1 * RATE }])
  const audible = h.left.filter(value => value > 0.1).length / RATE * 1000
  expect(audible).toBeGreaterThan(85); expect(audible).toBeLessThan(105)
  // 消息在 50ms 后的第一个量子边界生效：60ms 时已原速播放约 9ms
  expect(h.position(60) - 20).toBeGreaterThan(0.008); expect(h.position(60) - 20).toBeLessThan(0.0105)
  expect(h.speed(90, 20)).toBeCloseTo(1, 2)
  expect(h.gain(300)).toBe(0)
  const held = harness()
  held.run(800, Array.from({ length: 15 }, (_, k) => ({ at: 50 + k * 33, type: 'step', position: (20 + k / 60) * RATE, frames: 0.1 * RATE })))
  for (let ms = 60; ms < 560; ms += 5) expect(held.gain(ms)).toBeGreaterThan(0.3)
  expect(held.maxStep()).toBeLessThan(1 / 48)
})

it('读到还没送来的块先淡出静音并报缺块，块到了再淡入；停止后很快收声', () => {
  const missing = new Set([82, 83])
  const h = harness({ loaded: index => !missing.has(index) })
  h.run(600, [{ at: 0, type: 'rest', position: 20.4 * RATE }, ...drag(0, 1200, 20.4, 1)])
  expect(h.posted.filter(message => message.type === 'miss').map(message => message.index)).toEqual([82, 83])
  expect(h.gain(250)).toBe(0) // 播放位置在 20.65 秒（第 82 块）时静音
  h.send({ type: 'block', key: 1, index: 82, planes: h.block(82) })
  h.send({ type: 'block', key: 1, index: 83, planes: h.block(83) })
  h.run(800)
  expect(h.gain(700)).toBe(1)
  h.run(1000, [{ at: 900, type: 'stop' }])
  expect(h.gain(912)).toBe(0)
  expect(h.maxStep()).toBeLessThan(1 / 48)
})

it('换来源（key 变化）丢掉旧块；旧来源迟到的块不被收下', () => {
  const h = harness()
  h.send({ type: 'config', key: 2, sampleRate: RATE, channels: 2, blockFrames: BLOCK, frames: TOTAL })
  h.send({ type: 'block', key: 1, index: 80, planes: h.block(80) })
  h.run(300, [{ at: 0, type: 'rest', position: 20 * RATE }, ...drag(0, 300, 20, 1)])
  expect(h.left.every(value => value === 0)).toBe(true)
  expect(h.posted.some(message => message.type === 'miss' && message.index === 80)).toBe(true)
})
