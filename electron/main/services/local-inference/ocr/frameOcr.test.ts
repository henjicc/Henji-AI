import { expect, it, vi } from 'vitest'
import { FrameOcr, withOcrImageBudget } from './frameOcr'
import sharp from 'sharp'
import type { LocalModelRunner } from '../analysis'
it('OCR 独占任务限额在成功与失败后恢复，不改变后续字幕或修图任务的 Sharp 预算', async () => {
  const initial = sharp.concurrency()
  try {
    sharp.concurrency(6)
    expect(await withOcrImageBudget(async () => sharp.concurrency())).toBe(2)
    expect(sharp.concurrency()).toBe(6)
    await expect(withOcrImageBudget(async () => { throw new Error('cancelled') })).rejects.toThrow('cancelled')
    expect(sharp.concurrency()).toBe(6)
    sharp.concurrency(1)
    expect(await withOcrImageBudget(async () => sharp.concurrency())).toBe(1)
    expect(sharp.concurrency()).toBe(1)
  } finally { sharp.concurrency(initial) }
})
it('变化块外的行直接复用，相同裁片哈希命中；改字和取消不返回旧识别', async () => {
  let right = 300
  const detector: LocalModelRunner = { provider: 'cpu', run: async feeds => {
    const [, , h, w] = feeds.x.dims, data = new Float32Array(w * h)
    for (const top of [80, 240]) for (let y = top; y < top + 20; y++) for (let x = 100; x < right; x++) data[y * w + x] = .99
    return { output: { data, dims: [1, 1, h, w] } }
  } }
  const run = vi.fn(async (feeds: Parameters<LocalModelRunner['run']>[0]) => {
    const n = feeds.x.dims[0], data = new Float32Array(n * 6)
    for (let i = 0; i < n; i++) { data[i * 6 + 1] = .99; data[i * 6 + 3] = .99 }
    return { output: { data, dims: [n, 2, 3] } }
  })
  const ocr = new FrameOcr(detector, { provider: 'cpu', run }, ['a']), signal = new AbortController().signal
  const rgb = new Uint8Array(800 * 448 * 3).fill(255)
  expect((await ocr.run(rgb, 800, 448, signal)).recognizedLines).toBe(2)
  expect(run).toHaveBeenCalledTimes(1)
  expect((await ocr.run(rgb, 800, 448, signal, [[0, 0, .05, .05]]))).toMatchObject({ recognizedLines: 0, reusedLines: 2 })
  expect((await ocr.run(rgb, 800, 448, signal))).toMatchObject({ recognizedLines: 0, reusedLines: 2 })
  rgb[(90 * 800 + 150) * 3] = 0
  expect((await ocr.run(rgb, 800, 448, signal, [[.1, .1, .4, .2]]))).toMatchObject({ recognizedLines: 1, reusedLines: 1 })
  const controller = new AbortController(); controller.abort(new Error('cancelled'))
  await expect(ocr.run(rgb, 800, 448, controller.signal)).rejects.toThrow('cancelled')
  expect(run).toHaveBeenCalledTimes(2)
  right = 600
  const extended = await ocr.run(rgb, 800, 448, signal, [[.5, .16, .3, .1]])
  expect(extended).toMatchObject({ recognizedLines: 1, reusedLines: 1 })
  expect(extended.lines).toHaveLength(2)
  expect(extended.lines[0].box[2]).toBeGreaterThan(.5)
})
