import { afterEach, expect, it } from 'vitest'
import { AudioLoudnessSession } from './loudness'

const sessions: AudioLoudnessSession[] = []
afterEach(async () => { await Promise.all(sessions.splice(0).map(session => session.close())) })
it.each([44100, 48000])('%iHz 后台 FFmpeg 返回真实非静音区间、首尾静音与轻声敏感度', async rate => {
  const session = new AudioLoudnessSession(rate, 1); sessions.push(session); await session.initialize()
  for (let second = 0; second < 4; second++) await session.append([Float32Array.from({ length: rate }, (_, index) => second === 1 || second === 2 ? 0.003 * Math.sin(2 * Math.PI * 1000 * index / rate) : 0)])
  expect(await session.detectActivity(0)).toEqual([])
  const ranges = await session.detectActivity(100)
  expect(ranges).toHaveLength(1); expect(ranges[0].startSeconds).toBeCloseTo(1, 3); expect(ranges[0].endSeconds).toBeCloseTo(3, 3)
})
it('全静音、全有声以及关闭后拒绝新分析', async () => {
  const silence = new AudioLoudnessSession(48000, 1); sessions.push(silence); await silence.initialize(); await silence.append([new Float32Array(48000)])
  expect(await silence.detectActivity(50)).toEqual([])
  const sound = new AudioLoudnessSession(48000, 2); sessions.push(sound); await sound.initialize(); await sound.append([new Float32Array(48000).fill(.2), new Float32Array(48000).fill(.1)])
  expect(await sound.detectActivity(50)).toEqual([{ startSeconds: 0, endSeconds: 1 }])
  await sound.close(); await expect(sound.detectActivity(50)).rejects.toThrow('关闭')
})
