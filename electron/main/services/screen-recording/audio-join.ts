import fs from 'node:fs/promises'
import path from 'node:path'
import type { RecordingTrackGap, RecordingTrackKind, RecordingTracks } from '../../../../src/core/screenRecording/tracks'
import { decodeWavFrames, encodeWavFrames, readWavLayout, wavHeader, type WavLayout } from './wav-file'

export interface JoinedRecordingAudio { kind: Extract<RecordingTrackKind, 'microphone' | 'systemAudio'>; path: string; monoUs: number; durationUs: number }

/** 相邻两段之间超过这个空白或重叠就不再算同一路连续声音，另起一条。 */
const CONTINUOUS_TOLERANCE_US = 20_000
/** 拼接处用前一段末尾这么长的采样吸收设备时钟漂移；漂移只有几个采样，速度变化远小于可闻范围。 */
const SLIP_WINDOW_US = 200_000
/** 原生麦克风整段副本：录屏让原生录音服务写在录制目录里，重连后的续写文件名带 -N。 */
export const NATIVE_MICROPHONE_FILE = /^microphone-native-[a-f0-9-]+\.wav$/
/** 核对两份采样是否同一段声音时比较的帧数与容差（两边各自量化成整数采样）。 */
const MATCH_FRAMES = 256, MATCH_TOLERANCE = 2 / 0x8000

interface Part { file: string; layout: WavLayout; offset: number; frames: number; startUs: number; endUs: number; outFrames: number; nativeFrame?: number }
interface Native { file: string; layout: WavLayout; frames: number }

/**
 * 2 小时的声音按 5 秒一段写成上千个文件；导入剪辑前拼成每路一条连续的声音，真实空档处才分开。
 * 麦克风推送跟不上或界面进程中途退出时，分段之间会缺几段采样；原生录音服务另写的整段副本里每个采样都在，
 * 用它补齐，补上的空档从轨道空档里去掉。
 */
/** `untilUs` 是这次录制按下停止的时刻：最后一段之后从副本补尾巴不超过它（共享的副本可能还在被别人写）。 */
export async function joinRecordingAudio(directory: string, tracks: RecordingTracks, untilUs = Infinity): Promise<{ audio: JoinedRecordingAudio[]; gaps: Map<RecordingTrackKind, RecordingTrackGap[]> }> {
  const audio: JoinedRecordingAudio[] = [], gaps = new Map<RecordingTrackKind, RecordingTrackGap[]>()
  for (const track of tracks.tracks) {
    if (track.kind === 'camera') continue
    const kind = track.kind
    let parts: Part[] = []
    for (const segment of track.segments) {
      const file = path.join(directory, segment.file), layout = await readWavLayout(file)
      const frames = layout.dataBytes / layout.blockAlign
      if (!frames) continue
      const nativeFrame = segment.sourceClockOffsetUs === undefined ? undefined : Math.round((segment.monoSpanUs[0] - segment.sourceClockOffsetUs) * layout.sampleRate / 1_000_000)
      parts.push({ file, layout, offset: layout.dataOffset, frames, startUs: segment.monoSpanUs[0], endUs: segment.monoSpanUs[1], outFrames: frames, ...(nativeFrame !== undefined ? { nativeFrame } : {}) })
    }
    let trackGaps = [...track.gaps]
    if (kind === 'microphone') ({ parts, gaps: trackGaps } = await fillFromNative(directory, parts, trackGaps, untilUs))
    gaps.set(kind, trackGaps)
    let run: Part[] = [], index = 0
    for (const part of parts) {
      const previous = run.at(-1)
      const sameFormat = previous && previous.layout.format === part.layout.format && previous.layout.channels === part.layout.channels && previous.layout.sampleRate === part.layout.sampleRate && previous.layout.bitsPerSample === part.layout.bitsPerSample
      const recordedGap = previous && trackGaps.some(gap => gap.monoSpanUs[0] >= previous.startUs && gap.monoSpanUs[0] <= part.startUs)
      if (previous && (!sameFormat || recordedGap || Math.abs(part.startUs - previous.endUs) > CONTINUOUS_TOLERANCE_US)) { audio.push(await writeRun(directory, kind, index++, run)); run = [] }
      run.push(part)
    }
    if (run.length) audio.push(await writeRun(directory, kind, index++, run))
  }
  return { audio, gaps }
}

async function readFrames(file: string, offset: number, bytes: number): Promise<Buffer> {
  const handle = await fs.open(file, 'r'), buffer = Buffer.alloc(bytes)
  try { await handle.read(buffer, 0, bytes, offset) } finally { await handle.close() }
  return buffer
}
/** 两处是同一段声音。数字静音（全零）说明不了出处（换了副本也一样是零），不认；停顿时的底噪足够区分。 */
async function sameSound(a: { file: string; offset: number; layout: WavLayout }, b: { file: string; offset: number; layout: WavLayout }, frames: number): Promise<boolean> {
  if (frames <= 0) return false
  const left = decodeWavFrames(await readFrames(a.file, a.offset, frames * a.layout.blockAlign), a.layout)
  const right = decodeWavFrames(await readFrames(b.file, b.offset, frames * b.layout.blockAlign), b.layout)
  if (left.every(channel => channel.every(value => Math.abs(value) < 1e-5))) return false
  return left.every((channel, c) => channel.every((value, i) => Math.abs(value - right[c][i]) <= MATCH_TOLERANCE))
}

/**
 * 只用核对过的采样补：分段末尾与原生副本同一位置的声音一致才认定出自同一份录音；
 * 下一段也出自同一份时补齐中间缺的帧，否则（界面进程退出前没来得及写完）补到副本结束或下一段开始为止。
 */
async function fillFromNative(directory: string, parts: Part[], gaps: RecordingTrackGap[], untilUs: number): Promise<{ parts: Part[]; gaps: RecordingTrackGap[] }> {
  const natives: Native[] = []
  for (const name of (await fs.readdir(directory).catch(() => [] as string[])).filter(value => NATIVE_MICROPHONE_FILE.test(value))) {
    const file = path.join(directory, name)
    const layout = await readWavLayout(file).catch(() => null)
    if (layout) natives.push({ file, layout, frames: layout.dataBytes / layout.blockAlign })
  }
  if (!natives.length) return { parts, gaps }
  const filled: Part[] = []
  for (const [index, part] of parts.entries()) {
    filled.push(part)
    if (part.nativeFrame === undefined) continue
    const end = part.nativeFrame + part.frames, next = parts[index + 1]
    const check = Math.min(MATCH_FRAMES, part.frames)
    let source: Native | undefined
    for (const native of natives) {
      if (native.layout.sampleRate !== part.layout.sampleRate || native.layout.channels !== part.layout.channels || native.frames <= end) continue
      if (await sameSound({ ...part, offset: part.offset + (part.frames - check) * part.layout.blockAlign }, { ...native, offset: native.layout.dataOffset + (end - check) * native.layout.blockAlign }, check)) { source = native; break }
    }
    if (!source) continue
    const rate = part.layout.sampleRate
    const continues = next?.nativeFrame !== undefined && next.nativeFrame >= end && next.nativeFrame + Math.min(MATCH_FRAMES, next.frames) <= source.frames
      && await sameSound(next, { ...source, offset: source.layout.dataOffset + next.nativeFrame * source.layout.blockAlign }, Math.min(MATCH_FRAMES, next.frames))
    const room = Math.floor(((next?.startUs ?? untilUs) - part.endUs) * rate / 1_000_000)
    const frames = continues ? next!.nativeFrame! - end : Math.min(source.frames - end, room)
    if (frames <= 0) continue
    const startUs = part.endUs, endUs = startUs + Math.round(frames * 1_000_000 / rate)
    filled.push({ file: source.file, layout: source.layout, offset: source.layout.dataOffset + end * source.layout.blockAlign, frames, startUs, endUs, outFrames: frames })
    // 补上的这段不再是空档；下一段若接得上，中间整段都补齐了。
    const coveredEnd = continues ? next!.startUs : endUs
    gaps = gaps.flatMap(gap => {
      const [from, to] = gap.monoSpanUs
      if (gap.reason !== 'missing-data' || to <= startUs || from >= coveredEnd) return [gap]
      return [...from < startUs ? [[from, startUs]] : [], ...to > coveredEnd ? [[coveredEnd, to]] : []].map(span => ({ ...gap, monoSpanUs: span as [number, number] }))
    })
  }
  return { parts: filled, gaps }
}

/**
 * 每段落在它真实开始的采样位置上（相对这一条的起点）。设备时钟和系统时钟有几十 ppm 的偏差，
 * 两小时会差出几百毫秒；在每个拼接处把前一段的末尾轻微拉伸或压缩几个采样，让下一段准时开始。
 */
async function writeRun(directory: string, kind: JoinedRecordingAudio['kind'], index: number, parts: Part[]): Promise<JoinedRecordingAudio> {
  const { layout } = parts[0], rate = layout.sampleRate, startUs = parts[0].startUs
  // 一条的最后一段只写到它记录的终点：区间被下一段的真实起点截短过（两次采集首尾重叠）时，多出的采样不能叠进下一条。
  const last = parts[parts.length - 1], span = Math.max(1, Math.round((last.endUs - last.startUs) * rate / 1_000_000))
  if (span < last.frames) last.frames = span
  const starts = parts.map(part => Math.round((part.startUs - startUs) * rate / 1_000_000))
  for (const [i, part] of parts.entries()) part.outFrames = i + 1 < parts.length ? Math.max(1, starts[i + 1] - starts[i]) : part.frames
  const totalFrames = parts.reduce((sum, part) => sum + part.outFrames, 0)
  const output = path.join(directory, `${kind}-joined-${String(index).padStart(3, '0')}.wav`), partial = `${output}.partial`
  const handle = await fs.open(partial, 'w')
  try {
    const dataBytes = totalFrames * layout.blockAlign
    await handle.write(wavHeader(layout, dataBytes))
    for (const part of parts) {
      const bytes = await readFrames(part.file, part.offset, part.frames * layout.blockAlign)
      if (part.outFrames === part.frames) { await handle.write(bytes); continue }
      const slip = part.outFrames - part.frames
      const tail = Math.min(part.frames, Math.max(Math.round(rate * SLIP_WINDOW_US / 1_000_000), Math.abs(slip) * 10))
      const keep = part.frames - tail
      if (keep) await handle.write(bytes.subarray(0, keep * layout.blockAlign))
      const stretched = decodeWavFrames(bytes.subarray(keep * layout.blockAlign), layout).map(channel => resample(channel, Math.max(1, tail + slip)))
      await handle.write(encodeWavFrames(stretched, layout))
    }
    if (dataBytes & 1) await handle.write(Buffer.alloc(1))
    await handle.sync()
  } finally { await handle.close() }
  await fs.rename(partial, output)
  return { kind, path: output, monoUs: startUs, durationUs: Math.round(totalFrames * 1_000_000 / rate) }
}

/** 四点三次 Hermite 插值，首尾采样不变，拼接处前后都连续。 */
export function resample(source: Float32Array, length: number): Float32Array {
  const output = new Float32Array(length)
  if (length === 1 || source.length === 1) { output.fill(source[0] ?? 0); return output }
  const step = (source.length - 1) / (length - 1), last = source.length - 1
  for (let i = 0; i < length; i++) {
    const x = i * step, k = Math.min(last, Math.floor(x)), t = x - k
    const p0 = source[Math.max(0, k - 1)], p1 = source[k], p2 = source[Math.min(last, k + 1)], p3 = source[Math.min(last, k + 2)]
    output[i] = p1 + 0.5 * t * (p2 - p0 + t * (2 * p0 - 5 * p1 + 4 * p2 - p3 + t * (3 * (p1 - p2) + p3 - p0)))
  }
  return output
}
