import { expect, it, vi } from 'vitest'
import { videoEditNestedAudio } from './videoEditNestedAudio'
it('按样本半开范围读取嵌套声音，逐秒分块且最后一块不越过子序列', async () => {
  const rate = 48000
  const mix = vi.fn(async (from: number, duration: number) => [Float32Array.from({ length: Math.round(duration * rate) }, (_, index) => Math.round(from * rate) + index)])
  const source = videoEditNestedAudio(rate, 2.5, mix)
  const ranges: Array<[number, number]> = []
  const values: number[] = []
  for await (const chunk of source.chunks(1 / rate, 3)) {
    ranges.push([chunk.timestamp, chunk.numberOfFrames]); const plane = new Float32Array(chunk.numberOfFrames)
    chunk.copyTo(plane, { planeIndex: 0, format: 'f32-planar' }); values.push(plane[0], plane.at(-1)!); chunk.close()
  }
  expect(ranges.map(range => range[1])).toEqual([rate, rate, rate / 2 - 1])
  expect(values).toEqual([1, rate, rate + 1, rate * 2, rate * 2 + 1, rate * 2.5 - 1])
})
