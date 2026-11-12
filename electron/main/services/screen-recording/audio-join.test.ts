import { afterEach, beforeEach, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type { ClockAnchor } from '../../../../src/core/captureLog/clock'
import { RecordingTrackState } from '../../../../src/core/screenRecording/trackJournal'
import { joinRecordingAudio } from './audio-join'
import { readWavLayout, repairWavHeader, wavHeader } from './wav-file'

const RATE = 48000, LAYOUT = { format: 'pcm' as const, channels: 1, sampleRate: RATE, bitsPerSample: 16, blockAlign: 2 }
let directory: string
beforeEach(async () => { directory = await mkdtemp(path.join(tmpdir(), 'audio-join-')) })
afterEach(async () => { await rm(directory, { recursive: true, force: true }) })
const anchor = (monoUs: number, id: string): ClockAnchor => ({ monoUs, audioSample: 0, audioSegmentRef: id, audioRate: RATE, presentedFrame: null, requestedFrame: null, sequenceRef: null, visitRef: null, playbackDirection: 0, playbackRate: 1, playing: false, epoch: 0, uncertaintyUs: 0 })
/** 设备帧号连续的正弦；`click` 处放一个尖峰，代表一次在事件日志和麦克风里都录到的点击声。 */
const sample = (frame: number, click: number): number => frame === click ? 30000 : Math.round(Math.sin(frame * 2 * Math.PI * 440 / RATE) * 6000)
async function segment(state: RecordingTrackState, startUs: number, firstFrame: number, frames: number, click: number, write = true): Promise<void> {
  const id = randomUUID(), data = Buffer.alloc(frames * 2)
  for (let i = 0; i < frames; i++) data.writeInt16LE(sample(firstFrame + i, click), i * 2)
  if (write) await writeFile(path.join(directory, `${id}.wav`), Buffer.concat([wavHeader(LAYOUT, data.length), data]))
  // 与录制输出一致：分段时长按名义采样率记，源时钟偏移记下第一个采样在原生副本里的帧号。
  state.apply({ type: 'seal', kind: 'microphone', segment: { id, file: `${id}.wav`, monoSpanUs: [startUs, startUs + Math.round(frames * 1_000_000 / RATE)], sampleRate: RATE, channels: 1, units: frames, latencyCompensationUs: 0, sourceClockOffsetUs: startUs - Math.round(firstFrame * 1_000_000 / RATE), anchors: [anchor(startUs, id)] } })
}
async function pcm(file: string): Promise<Int16Array> {
  const layout = await readWavLayout(file), bytes = await readFile(file)
  return new Int16Array(bytes.buffer.slice(bytes.byteOffset + layout.dataOffset, bytes.byteOffset + layout.dataOffset + layout.dataBytes))
}

it('设备时钟快 100 ppm、两小时级漂移：拼成一条后每段仍在真实时刻开始，同一次点击在事件与声音里对齐；接缝无爆音；暂停处分成两条', async () => {
  const state = new RecordingTrackState(['microphone'])
  // 设备每 5 秒的 240000 帧在系统时钟上只用了 4.9995 秒。
  const realUs = 4_999_500, frames = 240_000, click = 6 * frames + 10
  for (let i = 0; i < 8; i++) await segment(state, 1_000_000 + i * realUs, i * frames, frames, click)
  const resumeUs = 1_000_000 + 8 * realUs + 3_000_000
  state.apply({ type: 'gap', kind: 'microphone', gap: { monoSpanUs: [1_000_000 + 8 * realUs, resumeUs], reason: 'pause' } })
  await segment(state, resumeUs, 8 * frames + 999, 48_000, -1)
  const tracks = state.tracks(randomUUID(), 0)
  const { audio: joined } = await joinRecordingAudio(directory, tracks)
  expect(joined.map(item => item.monoUs)).toEqual([1_000_000, resumeUs])
  const audio = await pcm(joined[0].path)
  const clickMonoUs = 1_000_000 + 6 * realUs + 10 * 1_000_000 / RATE
  const found = audio.findIndex(value => value === 30000)
  // 点击在拼接文件里的时刻与事件日志里的时刻相差不到一个采样；直接首尾相接会晚约 3 毫秒。
  expect(Math.abs(joined[0].monoUs + found * 1_000_000 / RATE - clickMonoUs)).toBeLessThanOrEqual(1_000_000 / RATE)
  expect(Math.abs(found - (6 * frames + 10))).toBeGreaterThan(100)
  expect(joined[0].durationUs).toBe(Math.round(audio.length * 1_000_000 / RATE))
  expect(Math.abs(joined[0].monoUs + joined[0].durationUs - (1_000_000 + 7 * realUs + 5_000_000))).toBeLessThan(100)
  let jump = 0
  for (let i = 1; i < audio.length; i++) if (audio[i] !== 30000 && audio[i - 1] !== 30000) jump = Math.max(jump, Math.abs(audio[i] - audio[i - 1]))
  // 440 Hz、幅度 6000 的正弦相邻采样最多差约 345：拉伸处同样连续。
  expect(jump).toBeLessThan(400)
  expect((await pcm(joined[1].path)).length).toBe(48_000)
})

it('两次采集首尾重叠（失联的旧进程还在写）：前一条只写到被截短的终点，同一段声音不出现两遍', async () => {
  const state = new RecordingTrackState(['microphone'])
  await segment(state, 1_000_000, 0, 5 * RATE, -1)
  state.apply({ type: 'gap', kind: 'microphone', gap: { monoSpanUs: [4_000_000, 4_000_000], reason: 'missing-data' } })
  await segment(state, 4_000_000, 10 * RATE, RATE, -1)
  const { audio } = await joinRecordingAudio(directory, state.tracks(randomUUID(), 0))
  expect(audio.map(item => [item.monoUs, item.durationUs])).toEqual([[1_000_000, 3_000_000], [4_000_000, 1_000_000]])
  expect((await pcm(audio[0].path)).length).toBe(3 * RATE)
})

it('写到一半的 WAV 按实际写到的完整帧补齐头部长度，采样不动', async () => {
  const file = path.join(directory, 'partial.wav'), data = Buffer.alloc(1001)
  const header = wavHeader(LAYOUT, 0)
  await writeFile(file, Buffer.concat([header.subarray(0, 4), Buffer.alloc(4), header.subarray(8), data]))
  expect(await readWavLayout(file)).toMatchObject({ unfinished: true, dataBytes: 1000 })
  expect((await repairWavHeader(file)).frames).toBe(500)
  expect(await readWavLayout(file)).toMatchObject({ unfinished: false, dataBytes: 1000 })
})

/** 原生录音服务在录制目录里写的整段副本：每个采样都在。 */
async function nativeCopy(frames: number): Promise<void> {
  const data = Buffer.alloc(frames * 2)
  for (let i = 0; i < frames; i++) data.writeInt16LE(sample(i, -1), i * 2)
  await writeFile(path.join(directory, `microphone-native-${randomUUID()}.wav`), Buffer.concat([wavHeader(LAYOUT, data.length), data]))
}
it('推送跟不上丢了一段采样：用原生整段副本补齐，空档从轨道里去掉，补出来的声音与前后连续', async () => {
  const state = new RecordingTrackState(['microphone'])
  await nativeCopy(2.5 * RATE)
  await segment(state, 1_000_000, 0, RATE, -1)
  // 中间 0.5 秒的推送丢了：分段与空档和录制时界面记下的一样。
  state.apply({ type: 'gap', kind: 'microphone', gap: { monoSpanUs: [2_000_000, 2_500_000], reason: 'missing-data' } })
  await segment(state, 2_500_000, 1.5 * RATE, RATE, -1)
  const { audio, gaps } = await joinRecordingAudio(directory, state.tracks(randomUUID(), 0))
  expect(gaps.get('microphone')).toEqual([])
  expect(audio).toHaveLength(1)
  const joined = await pcm(audio[0].path)
  expect(joined.length).toBe(2.5 * RATE)
  for (let i = 0; i < joined.length; i++) if (joined[i] !== sample(i, -1)) throw new Error(`第 ${i} 个采样不一致`)
})
it('界面进程退出时没写完的尾巴从副本补到副本结束；副本与分段对不上的不补', async () => {
  const state = new RecordingTrackState(['microphone'])
  await nativeCopy(1.25 * RATE)
  await segment(state, 1_000_000, 0, RATE, -1)
  // 另一份录音（帧号从别处起算），内容对不上，不能拿来补。
  await segment(state, 5_000_000, 7 * RATE, RATE, -1, true)
  state.apply({ type: 'detach', atUs: 2_200_000 })
  const { audio } = await joinRecordingAudio(directory, state.tracks(randomUUID(), 0))
  expect(audio.map(item => [item.monoUs, item.durationUs])).toEqual([[1_000_000, 1_250_000], [5_000_000, 1_000_000]])
})
