import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { expect, it } from 'vitest'

interface Processor {
  port: { onmessage: (event: { data: object }) => void }
  process: (inputs: never[], outputs: Float32Array[][]) => boolean
}
function processor(rate = 48000) {
  const messages: Array<{ type: string; generation: number; sourceFrame?: number; consumedFrames: number }> = []
  let instance!: Processor
  vm.runInNewContext(readFileSync('public/audio-edit-preview-worklet.js', 'utf8'), {
    sampleRate: rate,
    AudioWorkletProcessor: class { port = { postMessage: (message: typeof messages[number]) => messages.push(message) } },
    registerProcessor: (_name: string, Constructor: new () => Processor) => { instance = new Constructor() },
  })
  const send = (data: object) => instance.port.onmessage({ data })
  const render = (frames = 128) => {
    const result: number[] = []
    while (result.length < frames) {
      const pcm = new Float32Array(Math.min(128, frames - result.length))
      instance.process([], [[pcm]])
      result.push(...pcm)
    }
    return result
  }
  const pcm = (generation: number, sourceStartFrame: number, values: Float32Array) => send({ type: 'chunk', generation, sourceStartFrame, channels: 1, frameCount: values.length, pcm: values.buffer })
  const add = (generation: number, sourceStartFrame: number, value: number, frames = 4800) => pcm(generation, sourceStartFrame, new Float32Array(frames).fill(value))
  const scrub = (value: number, frames = Math.round(rate * 0.08)) => send({ type: 'scrub', generation: 0, channels: 1, pcm: new Float32Array(frames).fill(value).buffer })
  return { send, render, add, pcm, scrub, messages }
}
function maxJump(values: number[]) {
  let maximum = 0
  for (let index = 1; index < values.length; index++) maximum = Math.max(maximum, Math.abs(values[index] - values[index - 1]))
  return maximum
}

it('连续播放保持原样，删除点保持与导出相同的硬拼接且正确回报源位置', () => {
  const engine = processor()
  engine.send({ type: 'reset', generation: 1 })
  engine.add(1, 0, 0.25, 960)
  engine.add(1, 96000, 0.5, 960)
  engine.send({ type: 'playing', value: true })
  const result = engine.render(1920)
  expect(result.slice(240, 960)).toEqual(Array(720).fill(0.25))
  expect(result.slice(960, 1679)).toEqual(Array(719).fill(0.5))
  expect(result.at(-1)).toBeCloseTo(0, 7)
  expect(engine.messages.filter(message => message.type === 'position').at(-1)).toMatchObject({ sourceFrame: 96960, consumedFrames: 1920, generation: 1 })
})

it.each([44100, 48000, 96000])('常数信号在 %i Hz 开始、暂停、恢复、跳转和快速连切的跳变不超过 1/淡化帧数', rate => {
  const engine = processor(rate)
  const fade = Math.round(rate * 0.005)
  engine.add(0, 0, 1, rate)
  engine.send({ type: 'playing', value: true })
  const values = [0, ...engine.render(fade * 2)]
  engine.send({ type: 'playing', value: false })
  const pause = engine.render(fade * 2)
  values.push(...pause)
  expect(pause.slice(fade + 1).every(value => value === 0)).toBe(true)
  engine.send({ type: 'playing', value: true })
  values.push(...engine.render(fade * 2))
  for (let generation = 1; generation <= 20; generation++) {
    engine.send({ type: 'reset', generation })
    engine.add(generation - 1, 0, 20)
    engine.add(generation, generation * rate, generation % 2 ? -1 : 1, rate)
    values.push(...engine.render(generation % 3 ? Math.floor(fade / 3) : fade * 3))
    engine.send({ type: 'playing', value: generation % 2 === 0 })
    values.push(...engine.render(Math.floor(fade / 2)))
    engine.send({ type: 'playing', value: true })
  }
  values.push(...engine.render(fade * 3))
  expect(maxJump(values)).toBeLessThanOrEqual(1 / fade + 1e-6)
  expect(values.every(value => Math.abs(value) <= 1)).toBe(true)
})

it('跳转先消耗旧队列淡出；新数据迟到时保持静音，旧代次位置不冒充新位置', () => {
  const engine = processor()
  engine.add(0, 0, 1)
  engine.send({ type: 'playing', value: true })
  engine.render(512)
  engine.send({ type: 'reset', generation: 1 })
  const tail = engine.render(512)
  expect(tail[0]).toBeGreaterThan(0.99)
  expect(tail.slice(241)).toEqual(Array(271).fill(0))
  expect(engine.messages.some(message => message.type === 'position' && message.generation === 1)).toBe(false)
  engine.add(0, 2000, 20)
  expect(engine.render()).toEqual(Array(128).fill(0))
  engine.add(1, 48000, -1)
  const head = engine.render(512)
  expect(maxJump([...tail, ...head])).toBeLessThan(1 / 240 + 1e-6)
  expect(head.at(-1)).toBe(-1)
})

it('欠载和短块尾部提前淡出，恢复不会满幅切入', () => {
  const engine = processor()
  engine.send({ type: 'playing', value: true })
  const values = [0]
  for (const frames of [1000, 80, 500, 1, 239]) {
    engine.add(0, 0, frames % 2 ? -1 : 1, frames)
    values.push(...engine.render(frames + 256))
  }
  expect(maxJump(values)).toBeLessThan(1 / 240 + 1e-6)
  expect(engine.messages.filter(message => message.type === 'starved')).toHaveLength(5)
})

it('正弦信号切换的跳变低于正常最大斜率的 1.2 倍，稳态样本逐一不变', () => {
  const engine = processor()
  const signal = Float32Array.from({ length: 4800 }, (_, i) => 0.8 * Math.sin(i * 2 * Math.PI * 440 / 48000))
  engine.pcm(0, 0, signal)
  engine.send({ type: 'playing', value: true })
  const first = engine.render(2400)
  expect(first.slice(240)).toEqual(Array.from(signal.slice(240, 2400)))
  engine.send({ type: 'playing', value: false })
  const tail = engine.render(512)
  engine.send({ type: 'reset', generation: 1 })
  engine.pcm(1, 96000, signal)
  engine.send({ type: 'playing', value: true })
  expect(maxJump([0, ...first, ...tail, ...engine.render(5120)])).toBeLessThan(maxJump(Array.from(signal)) * 1.2)
})

it('80ms 擦洗段首尾各 5ms，交叉淡化同相信号不增幅、反相信号无突变', () => {
  const engine = processor()
  engine.scrub(1)
  const grain = engine.render(4096)
  expect(grain.slice(240, 3599)).toEqual(Array(3359).fill(1))
  expect(grain.slice(3840)).toEqual(Array(256).fill(0))
  const values = [0, ...grain]
  for (const value of [1, 1, -1, 1, -1]) {
    engine.scrub(value)
    values.push(...engine.render(1920))
  }
  engine.send({ type: 'scrub-stop' })
  values.push(...engine.render(512))
  // 反相交叉淡化每帧最多从 +1 向 -1 走 2/240。
  expect(maxJump(values)).toBeLessThanOrEqual(2 / 240 + 1e-6)
  expect(Math.max(...values.map(Math.abs))).toBeLessThanOrEqual(1)
  expect(values.slice(-128)).toEqual(Array(128).fill(0))
})

it('播放中拒绝擦洗，擦洗转播放沿同一输出平滑交接', () => {
  const engine = processor()
  engine.scrub(1)
  const values = engine.render(1000)
  engine.add(0, 0, -1)
  engine.send({ type: 'playing', value: true })
  engine.scrub(20)
  values.push(...engine.render(1000))
  expect(maxJump(values)).toBeLessThanOrEqual(2 / 240 + 1e-6)
  expect(values.at(-1)).toBe(-1)
})
