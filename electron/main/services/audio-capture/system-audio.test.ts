import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type { AudioCaptureEvent, SystemAudioNativeEvent } from '../../../../src/core/audioCapture/contracts'
import { RecordingTrackState, recordingTrackRecordSchema, type RecordingTrackRecord } from '../../../../src/core/screenRecording/trackJournal'

const native = vi.hoisted(() => ({ request: vi.fn(), setActive: vi.fn(), event: undefined as ((event: AudioCaptureEvent | SystemAudioNativeEvent) => void) | undefined, crash: undefined as ((loss: { code: string; message: string }) => void) | undefined }))
const mainNowUs = (): number => Number(process.hrtime.bigint() / 1000n)
vi.mock('./client', () => ({
  mainClockUs: () => Number(process.hrtime.bigint() / 1000n),
  AudioCaptureClient: class { constructor(_path: unknown, event: typeof native.event, crash: typeof native.crash) { native.event = event; native.crash = crash } request = native.request; setActive = native.setActive; async settled(): Promise<void> {} async dispose(): Promise<void> {} },
}))
vi.mock('./executable', () => ({ audioCaptureExecutablePath: () => 'native' }))
vi.mock('../logging', () => ({ createMainLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) }))
import { SystemAudioCaptureService } from './system-audio'
import { joinRecordingAudio } from '../screen-recording/audio-join'
import { readWavLayout, wavHeader } from '../screen-recording/wav-file'

const RATE = 48000, ORIGIN = 1_000_000_000
const health = { segments: 0, silenceSeconds: 0, unavailableSeconds: 0, trimmedFrames: 0, discontinuities: 0, droppedFrames: 0, deviceSwitches: 0, maxWriteMs: 0 }
/** 原生替身：记下每次开的原生会话；停止时先交出 `beforeStop` 里的段事件，再应答（与原生的顺序一致）。 */
function fakeNative(options: { recoverBytes?: number } = {}) {
  const starts: string[] = []
  const hooks = { beforeStop: undefined as (() => void) | undefined }
  native.request.mockReset()
  native.request.mockImplementation(async (type: string, payload: Record<string, unknown> = {}) => {
    if (type === 'startSystemAudio') starts.push(payload.sessionId as string)
    if (type === 'stop') { hooks.beforeStop?.(); hooks.beforeStop = undefined }
    if (type === 'recover') return { writtenBytes: options.recoverBytes ?? 0 }
    return { sampleRate: RATE, device: '扬声器', durationSeconds: 0, systemHealth: health }
  })
  const segment = (phase: 'open' | 'seal', sessionId: string, segmentId: string, firstFrame: number, monoUs: number, frames?: number): void =>
    native.event!({ event: 'segment', sessionId, phase, segmentId, file: `${segmentId}.wav`, firstFrame, sampleRate: RATE, channels: 2, bitDepth: 16, nativeMonoUs: monoUs - 7, monoUs, uncertaintyUs: 3, ...(frames ? { frames } : {}) })
  return { starts, hooks, segment, calls: (type: string) => native.request.mock.calls.filter(call => call[0] === type) }
}
const kinds = (records: RecordingTrackRecord[]): string[] => records.map(record => record.type)
let directory: string
beforeEach(async () => { directory = await mkdtemp(path.join(tmpdir(), 'system-audio-')) })
afterEach(async () => { vi.useRealTimers(); await rm(directory, { recursive: true, force: true }) })

describe('系统声：原生分段换算成录制轨道', () => {
  it('段事件按录制起点换算并都是合法的轨道记录；暂停结束原生会话、恢复重开，中间记暂停空档；停止后最后一段已封口', async () => {
    const { starts, hooks, segment } = fakeNative()
    const records: RecordingTrackRecord[] = []
    const recorder = await new SystemAudioCaptureService(() => 'native').start({ directory, originUs: ORIGIN, record: record => records.push(record) })
    const [a, b, c] = [randomUUID(), randomUUID(), randomUUID()]
    segment('open', starts[0], a, 0, ORIGIN + 100_000)
    segment('seal', starts[0], a, 0, ORIGIN + 100_000, 240_000)
    segment('open', starts[0], b, 240_000, ORIGIN + 5_099_990)
    hooks.beforeStop = () => segment('seal', starts[0], b, 240_000, ORIGIN + 5_099_990, 48_000)
    await recorder.pause()
    await recorder.resume()
    expect(starts).toHaveLength(2)
    segment('open', starts[1], c, 0, ORIGIN + 9_000_000)
    hooks.beforeStop = () => segment('seal', starts[1], c, 0, ORIGIN + 9_000_000, 24_000)
    const summary = await recorder.stop()
    expect(kinds(records)).toEqual(['open', 'seal', 'open', 'seal', 'gap', 'open', 'seal'])
    for (const record of records) recordingTrackRecordSchema.parse(record)
    expect(records[1]).toMatchObject({ type: 'seal', kind: 'systemAudio', segment: { id: a, monoSpanUs: [100_000, 5_100_000], units: 240_000, channels: 2 } })
    expect(records[4]).toEqual({ type: 'gap', kind: 'systemAudio', gap: { monoSpanUs: [6_099_990, 9_000_000], reason: 'pause' } })
    expect(summary.durationSeconds).toBeCloseTo(6.5)
  })

  it('原生服务崩溃：先重开接着录，再把没封口的段按文件补出来，中间记缺数据空档；重连后仍声明在录，不会被空闲计时关掉', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    // 失联前那一段写到了 2 秒（16 位双声道）；失联发生在录制第 2.2 秒。
    const { starts, segment, calls } = fakeNative({ recoverBytes: 2 * RATE * 4 })
    const origin = mainNowUs() - 2_200_000
    const records: RecordingTrackRecord[] = [], available = vi.fn()
    const recorder = await new SystemAudioCaptureService(() => 'native').start({ directory, originUs: origin, record: record => records.push(record), available })
    const a = randomUUID(), b = randomUUID()
    segment('open', starts[0], a, 0, origin + 100_000)
    native.crash!({ code: 'PROCESS_EXITED', message: '录音服务异常退出' })
    expect(available).toHaveBeenLastCalledWith(false)
    native.setActive.mockClear()
    await vi.advanceTimersByTimeAsync(600)
    expect(starts).toHaveLength(2)
    expect(native.setActive).toHaveBeenLastCalledWith(true)
    expect(available).toHaveBeenLastCalledWith(true)
    // 补旧段在串行队列之外做，不拖住暂停与停止。
    await vi.waitFor(() => expect(calls('recover')).toHaveLength(1))
    expect(calls('recover')[0][1]).toEqual({ outputPath: path.join(directory, `${a}.wav`) })
    await vi.waitFor(() => expect(records[1]).toMatchObject({ type: 'seal', segment: { id: a, monoSpanUs: [100_000, 2_100_000], units: 2 * RATE } }))
    segment('open', starts[1], b, 0, origin + 3_000_000)
    const gap = records.find(record => record.type === 'gap')
    expect(gap).toMatchObject({ kind: 'systemAudio', gap: { reason: 'missing-data' } })
    const [from, to] = (gap as Extract<RecordingTrackRecord, { type: 'gap' }>).gap.monoSpanUs
    expect(from).toBeGreaterThanOrEqual(2_200_000); expect(from).toBeLessThan(2_400_000); expect(to).toBe(3_000_000)
    await recorder.stop()
  })

  it('恢复时开不了（例如暂时没有输出设备）不让录制失败：提醒用户，自动重试，接上后暂停空档照常', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const { starts, segment } = fakeNative()
    const records: RecordingTrackRecord[] = [], available = vi.fn()
    const origin = mainNowUs()
    const recorder = await new SystemAudioCaptureService(() => 'native').start({ directory, originUs: origin, record: record => records.push(record), available })
    await recorder.pause()
    // 暂停一小会儿再恢复（真实时钟），暂停空档才有长度。
    for (const until = mainNowUs() + 2000; mainNowUs() < until;) { /* 等 2 毫秒 */ }
    native.request.mockRejectedValueOnce(new Error('DEVICE_UNAVAILABLE'))
    await expect(recorder.resume()).resolves.toBeUndefined()
    expect(available).toHaveBeenLastCalledWith(false)
    await vi.advanceTimersByTimeAsync(600)
    expect(starts).toHaveLength(2)
    expect(available).toHaveBeenLastCalledWith(true)
    segment('open', starts[1], randomUUID(), 0, origin + 60_000_000)
    expect(records.map(record => record.type === 'gap' ? record.gap.reason : record.type)).toEqual(['pause', 'missing-data', 'open'])
    await recorder.stop()
  })

  it('重连中停止：不再重连，没封口的段补出来，空档记到按下停止，提醒撤掉', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const { starts, segment, calls } = fakeNative({ recoverBytes: RATE * 4 })
    const origin = mainNowUs() - 3_000_000
    const records: RecordingTrackRecord[] = [], available = vi.fn()
    const recorder = await new SystemAudioCaptureService(() => 'native').start({ directory, originUs: origin, record: record => records.push(record), available })
    segment('open', starts[0], randomUUID(), 0, origin + 1_000_000)
    native.crash!({ code: 'NOT_RESPONDING', message: '录音服务没有应答' })
    await recorder.stop(3_500_000)
    await vi.advanceTimersByTimeAsync(5000)
    expect(starts).toHaveLength(1)
    expect(calls('recover')).toHaveLength(1)
    expect(records.map(record => record.type === 'gap' ? record.gap.reason : record.type)).toEqual(['open', 'seal', 'missing-data'])
    expect(available).toHaveBeenLastCalledWith(true)
  })

  it('暂停收尾途中写盘失败：这一路保持结束，之后停止不再重复记空档', async () => {
    const { starts, hooks } = fakeNative()
    const records: RecordingTrackRecord[] = [], failed = vi.fn()
    const recorder = await new SystemAudioCaptureService(() => 'native').start({ directory, originUs: ORIGIN, record: record => records.push(record), failed })
    hooks.beforeStop = () => native.event!({ event: 'interrupted', sessionId: starts[0], outputPath: directory, writtenBytes: 0, error: { code: 'DISK_FULL', message: '磁盘空间不足', recoverable: true } })
    await recorder.pause()
    await recorder.resume()
    expect(starts).toHaveLength(1)
    const summary = await recorder.stop()
    expect(summary.outcome).toBe('failed')
    expect(failed).toHaveBeenCalledOnce()
    expect(records).toEqual([])
  })

  it('写盘失败：交给录制按失败处理；这一路结束，之后能再开新的', async () => {
    const { starts } = fakeNative()
    const failed = vi.fn()
    const service = new SystemAudioCaptureService(() => 'native')
    await service.start({ directory, originUs: ORIGIN, record: () => {}, failed })
    native.event!({ event: 'interrupted', sessionId: starts[0], outputPath: directory, writtenBytes: 10, error: { code: 'DISK_FULL', message: '磁盘空间不足', recoverable: true } })
    expect(failed).toHaveBeenCalledWith(expect.objectContaining({ code: 'DISK_FULL' }))
    await expect(service.start({ directory, originUs: ORIGIN, record: () => {} })).resolves.toBeDefined()
  })
})

const LAYOUT = { format: 'pcm' as const, channels: 2, sampleRate: RATE, bitsPerSample: 16, blockAlign: 4 }
const sample = (frame: number, click: number): number => frame === click ? 30000 : Math.round(Math.sin(frame * 2 * Math.PI * 440 / RATE) * 6000)

it('跨轨对齐：设备时钟慢 100 ppm 的系统声，经段事件换算、界面中途断开再接上、拼成一条后，同一次点击在声音与事件里相差不到一个采样', async () => {
  const { starts, hooks, segment } = fakeNative()
  const state = new RecordingTrackState(['systemAudio'])
  const recorder = await new SystemAudioCaptureService(() => 'native').start({ directory, originUs: ORIGIN, record: record => state.apply(record) })
  // 设备每 5 秒的 240000 帧在系统时钟上用了 5.0005 秒：段与段之间按帧数推算的终点差出 0.5 毫秒；第 6 段里有一声点击。
  const realUs = 5_000_500, frames = 240_000, click = 6 * frames + 10
  for (let i = 0; i < 8; i++) {
    const id = randomUUID(), data = Buffer.alloc(frames * 4)
    for (let f = 0; f < frames; f++) { const value = sample(i * frames + f, click); data.writeInt16LE(value, f * 4); data.writeInt16LE(value, f * 4 + 2) }
    await writeFile(path.join(directory, `${id}.wav`), Buffer.concat([wavHeader(LAYOUT, data.length), data]))
    segment('open', starts[0], id, i * frames, ORIGIN + 1_000_000 + i * realUs)
    // 界面在第 3 段录到一半时重载：主进程录的系统声不受影响，不应因此出现空档。
    if (i === 3) state.apply({ type: 'detach', atUs: 1_000_000 + 3 * realUs + 2_000_000 })
    if (i < 7) segment('seal', starts[0], id, i * frames, ORIGIN + 1_000_000 + i * realUs, frames)
    else hooks.beforeStop = () => segment('seal', starts[0], id, i * frames, ORIGIN + 1_000_000 + i * realUs, frames)
  }
  await recorder.stop()
  const tracks = state.tracks(randomUUID(), ORIGIN)
  expect(tracks.tracks[0].gaps).toEqual([])
  const { audio } = await joinRecordingAudio(directory, tracks)
  expect(audio).toHaveLength(1)
  const layout = await readWavLayout(audio[0].path), bytes = await readFile(audio[0].path)
  let found = -1
  for (let f = 0; f < layout.dataBytes / 4; f++) if (bytes.readInt16LE(layout.dataOffset + f * 4) === 30000) { found = f; break }
  // 鼠标键盘事件与画面都按同一个 originUs 记时：点击发生在主进程时钟的这一刻。
  const clickEventUs = 1_000_000 + 6 * realUs + 10 * 1_000_000 / RATE
  expect(Math.abs(audio[0].monoUs + found * 1_000_000 / RATE - clickEventUs)).toBeLessThanOrEqual(1_000_000 / RATE)
})
