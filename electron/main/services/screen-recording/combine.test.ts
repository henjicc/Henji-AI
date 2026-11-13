import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { createRecordingDocument, type RecordingDocument } from '../../../../src/core/screenRecording/document'
import { captureOptionsSchema } from '../../../../src/core/screenRecording/capture'
import { recordingDurationUs } from '../../../../src/core/screenRecording/range'
import { wavHeader } from './wav-file'

const binaries = vi.hoisted(() => ({ ffmpeg: '', ffprobe: '' }))
binaries.ffmpeg = path.resolve('native/video-decoder/target/release/ffmpeg.exe'); binaries.ffprobe = path.resolve('native/video-decoder/target/release/ffprobe.exe')
const state = vi.hoisted(() => ({ content: null as unknown }))
vi.mock('../video/ffmpeg-loader', () => ({ loadFfmpegPath: async () => binaries.ffmpeg, loadFfprobePath: async () => binaries.ffprobe }))
vi.mock('../documents/runtime', () => ({ getDocumentService: () => ({ readDocument: async () => ({ meta: { kind: 'screen_recording' }, content: state.content }) }) }))
vi.mock('../logging', () => ({ createMainLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) }))
import { combineRecording } from './combine'

const haveFfmpeg = existsSync(binaries.ffmpeg) && existsSync(binaries.ffprobe)
let directory = ''
afterEach(async () => { if (directory) await fs.rm(directory, { recursive: true, force: true }); directory = '' })

const RATE = 8000
/** 每个采样记着自己在会话时钟上的时刻（毫秒的一半），拼接后能逐点核对来自哪里。 */
const sampleAt = (monoUs: number): number => Math.round(monoUs / 2000) % 32000
async function wav(file: string, monoUs: number, seconds: number): Promise<void> {
  const frames = Math.round(seconds * RATE), data = Buffer.alloc(frames * 2)
  for (let i = 0; i < frames; i++) data.writeInt16LE(sampleAt(monoUs + i * 1e6 / RATE), i * 2)
  await fs.writeFile(file, Buffer.concat([wavHeader({ format: 'pcm', channels: 1, sampleRate: RATE, bitsPerSample: 16, blockAlign: 2 }, data.length), data]))
}
function clip(file: string, seconds: number): void {
  execFileSync(binaries.ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', `testsrc=size=320x240:rate=30:duration=${seconds}`, '-c:v', 'libx264', '-g', '15', '-bf', '0', '-pix_fmt', 'yuv420p', '-movflags', '+frag_keyframe+empty_moov+default_base_moof', file])
}
const probe = (args: string[]): string => execFileSync(binaries.ffprobe, ['-v', 'error', ...args], { encoding: 'utf8' }).trim()

async function session(endUs: number, secondDurationUs: number): Promise<RecordingDocument> {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'henji-combine-'))
  clip(path.join(directory, 'screen-000000.mp4'), 3.3); clip(path.join(directory, 'screen-000001.mp4'), 4)
  await wav(path.join(directory, 'microphone-joined-000.wav'), 800_000, 3.4)
  // 恢复后麦克风晚了半秒才有声音：合并文件里那半秒是静音占位。
  await wav(path.join(directory, 'microphone-joined-001.wav'), 6_500_000, 3.6)
  const content = { ...createRecordingDocument(), status: 'stopped' as const, startUs: 1_200_000, endUs, pauses: [{ startUs: 4_000_000, endUs: 6_000_000 }] }
  content.source = { name: '屏幕', options: captureOptionsSchema.parse({ sourceId: 'screen:0:0', width: 320, height: 240, fps: 30, bitrate: 1000000 }), cursorEmbedded: false }
  content.media = [
    { id: 'screen-0', kind: 'screen', path: path.join(directory, 'screen-000000.mp4'), monoUs: 1_000_000, durationUs: 3_300_000 },
    { id: 'screen-1', kind: 'screen', path: path.join(directory, 'screen-000001.mp4'), monoUs: 6_000_000, durationUs: secondDurationUs },
    { id: 'microphone-joined-000', kind: 'microphone', path: path.join(directory, 'microphone-joined-000.wav'), monoUs: 800_000, durationUs: 3_400_000 },
    { id: 'microphone-joined-001', kind: 'microphone', path: path.join(directory, 'microphone-joined-001.wav'), monoUs: 6_500_000, durationUs: 3_600_000 },
  ]
  state.content = content
  return content
}

it.skipIf(!haveFfmpeg)('暂停分出的两片画面无损拼成一个文件：帧数与时长等于各段之和，原分片不动；麦克风拼成等长一条、逐点对齐', async () => {
  const content = await session(9_500_000, 4_000_000)
  const sizes = await Promise.all(content.media.map(media => fs.stat(media.path).then(stat => stat.size)))
  const [group] = (await combineRecording('s'))!
  // 第一片用到暂停开始（4.0 秒，含开头 0.2 秒预热），第二片从第一帧用到停止。
  expect(group.parts.map(part => part.frames)).toEqual([90, 105])
  expect(group.screen).toBe(path.join(directory, 'screen-combined-000.mp4'))
  expect(Number(probe(['-select_streams', 'v:0', '-count_packets', '-show_entries', 'stream=nb_read_packets', '-of', 'csv=p=0', group.screen]))).toBe(195)
  expect(Number(probe(['-show_entries', 'format=duration', '-of', 'csv=p=0', group.screen]))).toBeCloseTo(6.5, 2)
  // 去掉预热后正好是录制时长减去暂停。
  expect(6.5 - (content.startUs! - 1_000_000) / 1e6).toBeCloseTo(recordingDurationUs(content) / 1e6, 5)
  // 接缝处帧距不变（恒定帧率）。
  const times = probe(['-select_streams', 'v:0', '-read_intervals', '2.8%3.2', '-show_entries', 'packet=pts_time', '-of', 'csv=p=0', group.screen]).split(/\r?\n/).map(Number)
  for (let i = 1; i < times.length; i++) expect(times[i] - times[i - 1]).toBeCloseTo(1 / 30, 4)
  expect(await Promise.all(content.media.map(media => fs.stat(media.path).then(stat => stat.size)))).toEqual(sizes)

  const audio = await fs.readFile(group.audio.microphone!)
  const frames = (audio.length - 44) / 2
  expect(frames).toBe(6.5 * RATE)
  const at = (fileSeconds: number): number => audio.readInt16LE(44 + Math.round(fileSeconds * RATE) * 2)
  expect(at(0.5)).toBe(sampleAt(1_500_000)) // 暂停前：会话 1.5 秒
  expect(at(2.9)).toBe(sampleAt(3_900_000))
  expect(at(3.2)).toBe(0) // 恢复后的前半秒麦克风没录到
  expect(at(4.0)).toBe(sampleAt(7_000_000)) // 暂停后：文件 4.0 秒 = 会话 7.0 秒
  expect(at(6.4)).toBe(sampleAt(9_400_000))
  // 再导一次复用已合并的文件，不重写。
  const written = (await fs.stat(group.screen)).mtimeMs
  await combineRecording('s')
  expect((await fs.stat(group.screen)).mtimeMs).toBe(written)
}, 60_000)

it.skipIf(!haveFfmpeg)('拼出来的时长与各段之和对不上就当作失败：报出原因，不留半成品，原分片都在', async () => {
  // 文档说第二片有 8 秒，文件里只有 4 秒。
  const content = await session(13_500_000, 8_000_000)
  await expect(combineRecording('s')).rejects.toThrow('与各段之和')
  const names = await fs.readdir(directory)
  expect(names.filter(name => name.includes('combined') || name.includes('partial') || name.endsWith('.txt'))).toEqual([])
  for (const media of content.media) expect(existsSync(media.path)).toBe(true)
}, 60_000)

it.skipIf(!haveFfmpeg)('一路声音中途换了采样格式：画面照样合成一个，这一路不拼（导入时照原样分段）', async () => {
  await session(9_500_000, 4_000_000)
  const data = Buffer.alloc(16000 * 2)
  await fs.writeFile(path.join(directory, 'microphone-joined-001.wav'), Buffer.concat([wavHeader({ format: 'pcm', channels: 1, sampleRate: 16000, bitsPerSample: 16, blockAlign: 2 }, data.length), data]))
  const [group] = (await combineRecording('s'))!
  expect(group.screen).toBe(path.join(directory, 'screen-combined-000.mp4'))
  expect(group.audio.microphone).toBeUndefined()
  expect(existsSync(path.join(directory, 'microphone-combined-000.wav'))).toBe(false)
}, 60_000)
