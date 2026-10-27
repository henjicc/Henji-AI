import { expect, it, vi } from 'vitest'
import { MAX_REPLAY_TIME_SCALE, nextReplayTimeScale, renderAligned, ReplayDriftMeter, replayAligned, WebReplayDriftError, WebReplayMisalignedError, type ReplayDrift } from './drift'

function measure(leads: number[], samples = { samples: 0, stale: 0 }): ReplayDrift {
  const meter = new ReplayDriftMeter(60)
  leads.forEach(lead => meter.record(lead))
  return meter.summary(samples)
}

it('按超前了多少判断错位，不只数帧：偶尔几帧轻微落后仍算对得上', () => {
  // 编码器启动、GC 之类的偶发停顿：几帧落后两百毫秒内随即追上
  const occasional = measure([0, 0, 180, 120, 60, 0, ...Array(600).fill(3)])
  expect(occasional).toMatchObject({ lateFrames: 3, peakLeadMs: 180 })
  expect(replayAligned(occasional)).toBe(true)
  // 编码一直跟不上：每帧多落后 8ms，累计十几秒后超前过半秒
  const growing = measure(Array.from({ length: 600 }, (_, i) => i * 8))
  expect(growing.peakLeadMs).toBeGreaterThan(500)
  expect(replayAligned(growing)).toBe(false)
  // 从没超过半秒，但整段一直超前 150ms，同样对不上
  const steady = measure(Array(600).fill(150))
  expect(steady.peakLeadMs).toBeLessThan(500)
  expect(replayAligned(steady)).toBe(false)
  // 采样：零星几个太迟舍弃不算，舍弃过多说明轨对不上画面
  expect(replayAligned(measure([0], { samples: 600, stale: 2 }))).toBe(true)
  expect(replayAligned(measure([0], { samples: 600, stale: 30 }))).toBe(true)
  expect(replayAligned(measure([0], { samples: 600, stale: 61 }))).toBe(false)
  // 首帧前的停顿重置后不再计入
  const meter = new ReplayDriftMeter(60)
  meter.record(2_000); meter.reset(); meter.record(0)
  expect(replayAligned(meter.summary())).toBe(true)
})

const drifted = (timeScale: number): WebReplayDriftError => new WebReplayDriftError(timeScale, { frames: 100, lateFrames: 90, peakLeadMs: 4_200, meanLeadMs: 1_800, samples: 50, staleSamples: 40 })

it('错位就放慢一倍重演，对上了就返回，并带回前几遍的错位', async () => {
  const render = vi.fn(async (timeScale: number | undefined) => {
    if (timeScale === undefined) throw drifted(6)
    return { frames: 100, timeScale }
  })
  const onRetry = vi.fn()
  const { result, retries } = await renderAligned(render, { onRetry })
  expect(render.mock.calls.map(call => call[0])).toEqual([undefined, 12])
  expect(result).toEqual({ frames: 100, timeScale: 12 })
  expect(retries).toHaveLength(1)
  expect(onRetry).toHaveBeenCalledWith(retries[0], 12, 1)
})

it('放慢到上限仍错位就报用户能懂的错误，不返回错位的结果；其他错误不重试', async () => {
  const render = vi.fn(async (timeScale: number | undefined) => { throw drifted(timeScale ?? 6) })
  const failure = await renderAligned(render).then(() => null, (error: unknown) => error)
  expect(render.mock.calls.map(call => call[0])).toEqual([undefined, 12, 24])
  expect(failure).toBeInstanceOf(WebReplayMisalignedError)
  expect((failure as Error).message).toBe('电脑太忙，重演跟不上录制的节奏：已放慢到 24 倍重演，画面最多比录制时间超前约 4.2 秒，出的视频、文字轨和位置轨会和录制时间错位，所以没有保存这次结果。请等电脑空闲些（比如其他重演、导出或生成结束后）再试。')
  // 默认已经很慢（如 8K60）时翻倍会超上限，不再重试
  expect(nextReplayTimeScale(23, 1)).toBeNull()
  expect(nextReplayTimeScale(MAX_REPLAY_TIME_SCALE / 2, 1)).toBe(MAX_REPLAY_TIME_SCALE)
  const broken = vi.fn(async () => { throw new Error('重演窗口没有产生任何画面') })
  await expect(renderAligned(broken)).rejects.toThrow('没有产生任何画面')
  expect(broken).toHaveBeenCalledTimes(1)
  // 两遍之间取消就不再开始下一遍
  const controller = new AbortController()
  const cancelled = vi.fn(async () => { controller.abort(); throw drifted(6) })
  await expect(renderAligned(cancelled, { signal: controller.signal })).rejects.toThrow('已取消重演')
  expect(cancelled).toHaveBeenCalledTimes(1)
})
