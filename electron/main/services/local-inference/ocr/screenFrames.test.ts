import { expect, it, vi } from 'vitest'
import { frameSelection, screenOcrFrames } from './screenFrames'
import { ffmpegFrames } from '../frameReader'
import { analysisFfmpegArgs, rawFrames } from '../frameReader'
import type { OcrPrivacyJob } from './protocol'
vi.mock('../frameReader', async importOriginal => ({ ...await importOriginal<typeof import('../frameReader')>(), ffmpegFrames: vi.fn() }))
const job: OcrPrivacyJob = { id: 'test', models: [], providers: ['cpu'], dictionaryPath: 'dict', mediaId: 'm', source: 'video', ffmpegPath: 'ffmpeg', display: { width: 640, height: 448 }, fps: 10, startUs: 0, endUs: 1000000, durationSeconds: 1, seekSeconds: 0 }
it('差异索引压缩保持时间轴，FFmpeg 不补回被选掉的帧', () => {
  expect(frameSelection([0, 1, 2, 8, 10, 11])).toBe('between(n,0,2)+eq(n,8)+between(n,10,11)')
  expect(analysisFfmpegArgs(job, job.display, 'eq(n,0)')).toEqual(expect.arrayContaining(['-fps_mode', 'passthrough']))
  const args = analysisFfmpegArgs(job, job.display, 'eq(n,0)')
  expect(args.indexOf('-t')).toBeLessThan(args.indexOf('-i'))
})
it('小幅编码噪声不反复取原图；变化相对上次接受帧累计，不漏渐变文字；跳过帧复用同一引用', async () => {
  const raw = new Uint8Array(640 * 448 * 3).fill(255), frames = [raw, raw.slice(), raw.slice(), raw.slice()]
  frames[1][0] = 252; frames[2][0] = 249; frames[3][0] = 246
  vi.mocked(ffmpegFrames).mockImplementation(async function* (_ffmpeg, _job, _size, _signal, selection) { yield* selection ? [raw, frames[3]] : frames })
  const result: Uint8Array[] = []
  for await (const frame of screenOcrFrames(job, new AbortController().signal, () => undefined)) result.push(frame)
  expect(result).toHaveLength(4); expect(result[1]).toBe(result[0]); expect(result[2]).toBe(result[0]); expect(result[3]).toBe(frames[3])
  expect(vi.mocked(ffmpegFrames).mock.calls.at(-1)?.[4]).toBe('eq(n,0)+eq(n,3)')
})
it('原图数量不符与取消不能返回伪完成', async () => {
  const controller = new AbortController(); controller.abort()
  vi.mocked(ffmpegFrames).mockImplementation(async function* () { yield new Uint8Array(640 * 448 * 3) })
  await expect(screenOcrFrames(job, controller.signal, () => undefined).next()).rejects.toThrow()
  vi.mocked(ffmpegFrames).mockImplementation(async function* (_a, _b, _c, _d, selection) { if (!selection) yield new Uint8Array(640 * 448 * 3) })
  await expect(screenOcrFrames(job, new AbortController().signal, () => undefined).next()).rejects.toThrow('不完整')
})
it('移动指针逐渐露出原位置；停住后指针附近新文字立即触发检测，不被永久屏蔽', async () => {
  const frames = [100, 180, 260, 340, 340].map(x => {
    const rgb = new Uint8Array(640 * 448 * 3).fill(255); rgb.fill(0, (100 * 640 + x) * 3, (100 * 640 + x + 4) * 3); return rgb
  })
  frames[4].fill(0, (110 * 640 + 350) * 3, (110 * 640 + 360) * 3)
  let selection: string | undefined
  vi.mocked(ffmpegFrames).mockImplementation(async function* (_a, _b, _c, _d, chosen) { if (chosen) { selection = chosen; yield* frames } else yield* frames })
  const cursor = [100, 180, 260, 340, 340].map((x, i) => ({ monoUs: i * 100000, point: [x, 100] as [number, number] }))
  for await (const _frame of screenOcrFrames({ ...job, cursor }, new AbortController().signal, () => undefined)) { /* consume */ }
  expect(selection).toBe('between(n,0,1)+eq(n,4)')
})
it('两张原图循环缓冲保留上一帧；默认读取者仍拥有所有历史帧', async () => {
  async function* bytes() { yield Uint8Array.of(1, 2, 3, 4, 5, 6) }
  const reused = rawFrames(bytes(), 2, 2), first = (await reused.next()).value!, second = (await reused.next()).value!
  expect([...first]).toEqual([1, 2]); expect([...second]).toEqual([3, 4])
  const third = (await reused.next()).value!; expect(third).toBe(first); expect([...second]).toEqual([3, 4])
  const kept = []; for await (const frame of rawFrames(bytes(), 2)) kept.push([...frame])
  expect(kept).toEqual([[1, 2], [3, 4], [5, 6]])
})
