import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { expect, it } from 'vitest'

interface Processor {
  port: { onmessage: (event: { data: object }) => void }
  process: (inputs: never[], outputs: Float32Array[][]) => boolean
}
function processor() {
  const messages: Array<{ type: string; generation: number; sourceFrame?: number; consumedFrames: number }> = []
  let instance!: Processor
  vm.runInNewContext(readFileSync('public/audio-edit-preview-worklet.js', 'utf8'), {
    sampleRate: 48000,
    AudioWorkletProcessor: class { port = { postMessage: (message: typeof messages[number]) => messages.push(message) } },
    registerProcessor: (_name: string, Constructor: new () => Processor) => { instance = new Constructor() },
  })
  const send = (data: object) => instance.port.onmessage({ data })
  const render = () => { const pcm = new Float32Array(128); instance.process([], [[pcm]]); return Array.from(pcm) }
  const add = (generation: number, sourceStartFrame: number, value: number, frames = 64) => send({ type: 'chunk', generation, sourceStartFrame, channels: 1, frameCount: frames, pcm: new Float32Array(frames).fill(value).buffer })
  return { send, render, add, messages }
}
it('concatenates retained PCM without inserting deleted audio and reports the source jump', () => {
  const engine = processor()
  engine.send({ type: 'reset', generation: 1 })
  engine.add(1, 0, 0.25)
  engine.add(1, 96000, 0.5)
  engine.send({ type: 'playing', value: true })
  expect(engine.render()).toEqual([...Array(64).fill(0.25), ...Array(64).fill(0.5)])
  expect(engine.messages.find((message) => message.type === 'position')).toMatchObject({ sourceFrame: 96064, consumedFrames: 128, generation: 1 })
})
it('recovers from starvation, rejects old generations and stays silent while paused', () => {
  const engine = processor()
  engine.send({ type: 'reset', generation: 1 })
  engine.send({ type: 'playing', value: true })
  engine.add(1, 0, 0.25)
  engine.render()
  engine.add(1, 64, 0.5, 128)
  expect(engine.render()).toEqual(Array(128).fill(0.5))
  engine.send({ type: 'reset', generation: 2 })
  engine.add(1, 100, 1)
  expect(engine.render()).toEqual(Array(128).fill(0))
  engine.add(2, 96000, 0.25, 128)
  engine.send({ type: 'playing', value: false })
  expect(engine.render()).toEqual(Array(128).fill(0))
  engine.send({ type: 'playing', value: true })
  expect(engine.render()).toEqual(Array(128).fill(0.25))
})
