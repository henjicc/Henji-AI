import { afterEach, expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { encodeRecordingWav } from '../../../../src/core/audioEdit/recordingAudio'
import { videoEditRecordingGainDb } from '../../../../src/core/videoEdit/loudness'

// 真实 FFmpeg 子进程：CI 冷启动首个用例常超过默认 5 秒，给集成测试留足时间。
vi.setConfig({ testTimeout: 30_000 })
import { AudioLoudnessSession, measureAudioFileLoudness } from './loudness'

const sessions: AudioLoudnessSession[] = []
it.each([44100, 48000])('%i Hz 文件区间测量不包含相邻声音，增益后达到录后目标且原采样未改写', async rate => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'henji-loudness-range-'))
  try {
    const file = path.join(directory, 'take.wav'), signal = new AbortController().signal
    const samples = Float32Array.from({ length: rate * 6 }, (_, frame) => 10 ** ((frame >= rate * 2 && frame < rate * 4 ? -36 : -6) / 20) * Math.sin(frame * 2 * Math.PI * 1000 / rate))
    const bytes = encodeRecordingWav(samples, rate)
    await fs.writeFile(file, bytes)
    const measured = await measureAudioFileLoudness(file, rate * 2, rate * 2, rate, signal)
    expect(measured.integratedLufs).toBeCloseTo(-39, 0)
    expect(measured.durationSeconds).toBe(2)
    expect(await fs.readFile(file)).toEqual(Buffer.from(bytes))
    const gainDb = videoEditRecordingGainDb(0, measured)
    const gained = samples.slice(rate * 2, rate * 4).map(value => value * 10 ** (gainDb / 20))
    const rendered = path.join(directory, 'rendered.wav')
    await fs.writeFile(rendered, encodeRecordingWav(gained, rate))
    const actual = await measureAudioFileLoudness(rendered, 0, gained.length, rate, signal)
    expect(Math.abs(actual.integratedLufs! + 16)).toBeLessThanOrEqual(.5)
    expect(actual.truePeakDbtp!).toBeLessThanOrEqual(-1)
  } finally { await fs.rm(directory, { recursive: true, force: true }) }
})
afterEach(async () => { await Promise.all(sessions.splice(0).map(session => session.close())) })
async function signal(rate = 48000, seconds = 4, level = -23, frequency = 1000, phase = 0, quietAfter = false): Promise<AudioLoudnessSession> {
  const session = new AudioLoudnessSession(rate, 2); sessions.push(session); await session.initialize()
  for (let block = 0; block < seconds; block++) {
    const amplitude = 10 ** ((quietAfter && block >= seconds / 2 ? -55 : level) / 20)
    const plane = Float32Array.from({ length: rate }, (_, index) => amplitude * Math.sin(2 * Math.PI * frequency * (block * rate + index) / rate + phase))
    await session.append([plane, plane])
  }
  return session
}
it.each([44100, 48000])('%i Hz：1 kHz 立体声正弦 -23 dBFS 峰值约 -23 LUFS，三秒短期与积分一致', async rate => {
  const measured = await (await signal(rate)).measure()
  expect(measured.integratedLufs).toBeCloseTo(-23, 0)
  expect(measured.shortTermLufs).toBeCloseTo(measured.integratedLufs!, 1)
  expect(measured.samplePeakDbfs).toBeCloseTo(-23, 1)
})
it('相对 -10 LU 门限排除轻声段；绝对 -70 LUFS 门限与静音返回 null', async () => {
  const measured = await (await signal(48000, 8, -23, 1000, 0, true)).measure()
  expect(Math.abs(measured.integratedLufs! + 23)).toBeLessThan(.5)
  expect((await (await signal(48000, 4, -80)).measure()).integratedLufs).toBeNull()
  const silence = new AudioLoudnessSession(48000, 1); sessions.push(silence); await silence.initialize(); await silence.append([new Float32Array(48000)])
  expect(await silence.measure()).toMatchObject({ integratedLufs: null, truePeakDbtp: null, shortTermLufs: null, samplePeakDbfs: null })
})
it('4× 真峰值检测到采样点之间的 12 kHz 峰值，明显高于采样峰值', async () => {
  const measured = await (await signal(48000, 4, -2, 12000, Math.PI / 4)).measure()
  expect(measured.truePeakDbtp! - measured.samplePeakDbfs!).toBeGreaterThan(2)
  expect(measured.truePeakDbtp).toBeGreaterThanOrEqual(-2.2)
})
it.each([-14, -16, -23])('导出补偿到 %i LUFS，回读真实 PCM 重新测量在 ±0.5 LU，长度相同', async targetLufs => {
  const source = await signal(48000, 8, -30)
  const normalized = await source.normalize({ targetLufs, truePeakDbtp: -1 })
  expect(Math.abs(normalized.integratedLufs! - targetLufs)).toBeLessThanOrEqual(.5)
  const check = new AudioLoudnessSession(48000, 2); sessions.push(check); await check.initialize()
  for (let second = 0; second < 8; second++) await check.append(await source.read(second * 48000, 48000))
  const actual = await check.measure(); expect(Math.abs(actual.integratedLufs! - targetLufs)).toBeLessThanOrEqual(.5); expect(actual.truePeakDbtp!).toBeLessThanOrEqual(-1)
})
it('标准化需要限幅时也守住真峰值，不以简单增益推高峰值', async () => {
  const source = await signal(48000, 8, -30)
  // Sparse full-scale transients force dynamic loudnorm instead of linear gain.
  const plane = new Float32Array(48000); for (let index = 0; index < plane.length; index++) plane[index] = .025 * Math.sin(index * 2 * Math.PI * 1000 / 48000); plane[24000] = .99
  await source.append([plane, plane])
  const actual = await source.normalize({ targetLufs: -14, truePeakDbtp: -1 })
  expect(Math.abs(actual.integratedLufs! + 14)).toBeLessThanOrEqual(.5); expect(actual.truePeakDbtp!).toBeLessThanOrEqual(-1)
})
it('封口、取消、非有限采样和不完整声道不能继续提交', async () => {
  const source = await signal(); await source.measure()
  await expect(source.append([new Float32Array(2), new Float32Array(2)])).rejects.toThrow('追加')
  await source.close(); await expect(source.measure()).rejects.toThrow('关闭')
  const invalid = new AudioLoudnessSession(48000, 2); sessions.push(invalid); await invalid.initialize()
  await expect(invalid.append([new Float32Array([NaN]), new Float32Array([0])])).rejects.toThrow('无效采样')
})
