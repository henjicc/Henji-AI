import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { getDocumentService } from '../documents/runtime'
import { recordingDocumentSchema, type RecordingDocument, type RecordingMedia } from '../../../../src/core/screenRecording/document'
import { recordingCombinePlan, recordingCombinedPartEndUs, type RecordingCombinedFiles, type RecordingCombinedGroup } from '../../../../src/core/screenRecording/combine'
import { loadFfmpegPath, loadFfprobePath } from '../video/ffmpeg-loader'
import { createMainLogger } from '../logging'
import { quickExportList, runFfmpeg } from './quick-export'
import { readWavLayout, wavHeader, type WavLayout } from './wav-file'
import { captureTimingGroup, readCaptureTiming } from './capture/native-timing'

const logger = createMainLogger('main.screen_recording.combine')
/** 合并写盘前留出的余量，与录制时的磁盘检查一致。 */
const RESERVE_BYTES = 256 * 1024 * 1024
const COPY_CHUNK_BYTES = 4 * 1024 * 1024
type AudioKind = keyof RecordingCombinedFiles['audio']

function probe(binary: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => execFile(binary, args, { windowsHide: true, timeout: 60_000, maxBuffer: 1024 * 1024 }, (error, stdout) => error ? reject(error) : resolve(stdout)))
}
/** 能否流复制接在一起只看编码参数；SPS/PPS 不同（例如中途改用软件编码）的两片不能接。 */
async function streamKey(ffprobe: string, file: string): Promise<string> {
  return (await probe(ffprobe, ['-v', 'error', '-select_streams', 'v:0', '-show_data_hash', 'SHA256', '-show_entries', 'stream=codec_name,profile,level,width,height,pix_fmt,time_base,r_frame_rate,extradata_hash', '-of', 'compact=nk=1', file])).trim()
}
async function durationUs(ffprobe: string, file: string): Promise<number> {
  return Math.round(Number((await probe(ffprobe, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file])).trim()) * 1e6)
}
const exists = (file: string): Promise<boolean> => fs.stat(file).then(() => true, () => false)

/** 合并文件的时长要等于各片用到的帧数之和（误差不到一帧半），否则当作没合成功。 */
function matchesFrames(actualUs: number, group: RecordingCombinedGroup): boolean {
  return Number.isFinite(actualUs) && Math.abs(actualUs - group.frames * 1e6 / group.fps) <= 1.5e6 / group.fps
}

/**
 * 画面：concat 分离器按各片顺序流复制，每片只在末尾用 outpoint 切；outpoint 取到帧边界并向下舍到微秒，
 * 下一片正好从下一帧的位置接上，整条仍是恒定帧率。输出与录制时同样的分片 MP4，剪辑一直读得了这种文件。
 */
export function combinedScreenArgs(list: string, output: string): string[] {
  return ['-hide_banner', '-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', list, '-map', '0:v:0', '-c', 'copy', '-movflags', '+frag_keyframe+empty_moov+default_base_moof', '-f', 'mp4', output]
}
export function combinedScreenList(group: RecordingCombinedGroup, media: ReadonlyMap<string, RecordingMedia>): string {
  return quickExportList(group.parts.map(part => ({ path: media.get(part.mediaId)!.path, outpointUs: Math.floor(part.frames * 1e6 / group.fps) })))
}

async function writeCombinedScreen(directory: string, output: string, group: RecordingCombinedGroup, media: ReadonlyMap<string, RecordingMedia>): Promise<void> {
  const ffmpeg = await loadFfmpegPath(), ffprobe = await loadFfprobePath()
  const token = randomUUID(), list = path.join(directory, `combine-${token}.txt`), partial = path.join(directory, `${path.basename(output, '.mp4')}.${token}.partial`)
  await fs.writeFile(list, combinedScreenList(group, media), 'utf8')
  try {
    await runFfmpeg(ffmpeg, combinedScreenArgs(list, partial))
    const actual = await durationUs(ffprobe, partial)
    if (!matchesFrames(actual, group)) throw new Error(`合并后的画面时长 ${(actual / 1e6).toFixed(3)} 秒与各段之和 ${(group.frames / group.fps).toFixed(3)} 秒不符`)
    // 先写完、核对过才换上正式文件名：中途崩溃只留下 .partial，原分片一直在。
    await fs.rename(partial, output)
  } catch (error) { await fs.rm(partial, { force: true }); throw error } finally { await fs.rm(list, { force: true }) }
}

interface AudioSource { file: string; layout: WavLayout; monoUs: number; frames: number }
const sameLayout = (a: WavLayout, b: WavLayout): boolean => a.format === b.format && a.channels === b.channels && a.sampleRate === b.sampleRate && a.bitsPerSample === b.bitsPerSample

/**
 * 声音：按同一份分组把这一路的声音文件切成与画面一样的几段首尾相接，文件时间与画面一致；
 * 这一路没录到的地方（设备断开、开始得晚）写静音占位，导入时那里不放片段，空档照样留空。
 */
export async function writeCombinedAudio(output: string, group: RecordingCombinedGroup, media: readonly RecordingMedia[]): Promise<void> {
  const sources: AudioSource[] = []
  for (const item of [...media].sort((a, b) => a.monoUs - b.monoUs)) {
    const layout = await readWavLayout(item.path)
    if (sources.length && !sameLayout(sources[0].layout, layout)) throw new Error('这一路声音中途换了采样格式，不能拼成一条')
    sources.push({ file: item.path, layout, monoUs: item.monoUs, frames: layout.dataBytes / layout.blockAlign })
  }
  if (!sources.length) return
  const { layout } = sources[0], rate = layout.sampleRate, block = layout.blockAlign
  const at = (fileUs: number): number => Math.round(fileUs * rate / 1e6)
  const total = at(group.frames * 1e6 / group.fps)
  // 每一段：输出从第几帧起、来自哪个文件的第几帧、多少帧。
  const copies: Array<{ out: number; source: AudioSource; from: number; count: number }> = []
  for (const part of group.parts) {
    const partEnd = recordingCombinedPartEndUs(part, group.fps)
    for (const source of sources) {
      const start = Math.max(part.monoUs, source.monoUs), end = Math.min(partEnd, source.monoUs + source.frames * 1e6 / rate)
      if (end <= start) continue
      const out = at(part.fileUs + start - part.monoUs), from = Math.round((start - source.monoUs) * rate / 1e6)
      const count = Math.min(at(part.fileUs + end - part.monoUs) - out, source.frames - from)
      if (count > 0) copies.push({ out, source, from, count })
    }
  }
  copies.sort((a, b) => a.out - b.out)
  const partial = `${output}.${randomUUID()}.partial`
  const handle = await fs.open(partial, 'w')
  try {
    await handle.write(wavHeader(layout, total * block))
    let cursor = 0
    const silence = async (until: number): Promise<void> => {
      while (cursor < until) { const frames = Math.min(until - cursor, COPY_CHUNK_BYTES / block | 0); await handle.write(Buffer.alloc(frames * block)); cursor += frames }
    }
    for (const copy of copies) {
      // 两个文件首尾重叠的几帧只取先到的。
      const skip = Math.max(0, cursor - copy.out), count = Math.min(copy.count - skip, total - Math.max(cursor, copy.out))
      if (count <= 0) continue
      await silence(copy.out)
      const source = await fs.open(copy.source.file, 'r')
      try {
        for (let done = 0; done < count;) {
          const frames = Math.min(count - done, COPY_CHUNK_BYTES / block | 0), buffer = Buffer.alloc(frames * block)
          const { bytesRead } = await source.read(buffer, 0, buffer.length, copy.source.layout.dataOffset + (copy.from + skip + done) * block)
          if (bytesRead < buffer.length) buffer.fill(0, bytesRead)
          await handle.write(buffer); done += frames; cursor += frames
        }
      } finally { await source.close() }
    }
    await silence(total)
    if ((total * block) & 1) await handle.write(Buffer.alloc(1))
    await handle.sync()
    await handle.close()
    await fs.rename(partial, output)
  } catch (error) { await handle.close().catch(() => undefined); await fs.rm(partial, { force: true }); throw error }
}

/** 一路声音的各文件采样格式一致才能拼成一条；中途换了格式（换了设备）的这一路照原样分段导入，不连累画面。 */
async function combinableAudio(media: readonly RecordingMedia[]): Promise<{ bytes: number } | null> {
  const layouts = await Promise.all(media.map(item => readWavLayout(item.path)))
  if (layouts.some(layout => !sameLayout(layouts[0], layout))) return null
  return { bytes: layouts.reduce((sum, layout) => sum + layout.dataBytes, 0) }
}

/** 上次合并到一半应用退出留下的半成品（一次长录可达十几 GB）：写入中的文件一直在变，十分钟没动过的才删。 */
const STALE_PARTIAL_MS = 10 * 60 * 1000
async function removeStalePartials(directory: string): Promise<void> {
  for (const name of await fs.readdir(directory).catch(() => [] as string[])) {
    if (!name.endsWith('.partial') && !/^combine-[0-9a-f-]+\.txt$/.test(name)) continue
    const file = path.join(directory, name)
    const stat = await fs.stat(file).catch(() => null)
    if (stat && Date.now() - stat.mtimeMs > STALE_PARTIAL_MS) await fs.rm(file, { force: true }).catch(error => logger.warn('合并半成品没能删除', { event: 'recording.combine.partial_busy', error, context: { file } }))
  }
}

async function audioUpToDate(file: string, group: RecordingCombinedGroup): Promise<boolean> {
  try { const layout = await readWavLayout(file); return !layout.unfinished && layout.dataBytes / layout.blockAlign === Math.round(group.frames / group.fps * layout.sampleRate) } catch { return false }
}

/**
 * 原生采集录的画面：每个文件是一段连续的画面、暂停不在里面，本身就是合并好的；按逐帧时刻表分出各段，声音照常按这组拼。
 * 通常一次录制一个文件；采集中断后自动续录（显卡重置、采集进程退出）会再开一个，两个文件之间那一两秒没有画面，
 * 所以每个文件各成一组，不接在一起。
 * 返回 'none'：没有这种文件，走分片合并；null：都没暂停过，或与没有时刻表的分片混在一起（不该出现），按原样逐个导入。
 */
async function continuousScreenGroups(content: RecordingDocument): Promise<RecordingCombinedGroup[] | 'none' | null> {
  const screens = content.media.filter(item => item.kind === 'screen' && item.durationUs > 0).sort((a, b) => a.monoUs - b.monoUs)
  const timings = await Promise.all(screens.map(screen => readCaptureTiming(screen.path)))
  if (timings.every(timing => !timing)) return 'none'
  if (timings.some(timing => !timing)) return null
  const groups = screens.map((screen, index): RecordingCombinedGroup => {
    const timing = timings[index]!, fps = timing.fpsNum / timing.fpsDen, frames = Math.round(screen.durationUs * fps / 1e6)
    return captureTimingGroup(screen.id, timing, screen.monoUs, frames) ?? { fps, frames, parts: [{ mediaId: screen.id, monoUs: screen.monoUs, frames, fileUs: 0 }] }
  })
  return groups.some(group => group.parts.length > 1) ? groups : null
}

/**
 * 导入剪辑前的合并：一次录制拼成一个画面文件、每路声音一条，原分片与分段一个不删（录制文件里的其他功能还按会话时钟读它们）。
 * 已经合并过且完整的直接复用；不需要合并（只有一片、较早版本录的会话对不齐暂停）返回 null。
 */
export async function combineRecording(sessionId: string): Promise<RecordingCombinedFiles[] | null> {
  const read = await getDocumentService().readDocument({ id: sessionId })
  if (read.meta.kind !== 'screen_recording') throw new Error('请选择录制会话')
  const content: RecordingDocument = recordingDocumentSchema.parse(read.content)
  if (!['stopped', 'interrupted'].includes(content.status)) return null
  const continuous = await continuousScreenGroups(content)
  if (!continuous || continuous === 'none' && !recordingCombinePlan(content)) return null
  const started = Date.now()
  const screens = content.media.filter(item => item.kind === 'screen' && item.durationUs > 0)
  const ffprobe = await loadFfprobePath()
  const streams = new Map<string, string>()
  if (continuous === 'none') for (const screen of screens) streams.set(screen.id, await streamKey(ffprobe, screen.path))
  const plan = continuous === 'none' ? recordingCombinePlan(content, streams) : continuous
  if (!plan) { logger.info('画面分片编码参数不同，按分段导入', { event: 'recording.combine.skipped', context: { sessionId, screens: screens.length } }); return null }
  const media = new Map(content.media.map(item => [item.id, item]))
  const directory = path.dirname(screens[0].path)
  await removeStalePartials(directory)
  logger.info('合并录制画面与声音', { event: 'recording.combine.start', context: { sessionId, groups: plan.length, parts: plan.reduce((sum, group) => sum + group.parts.length, 0) } })
  try {
    const disk = await fs.statfs(directory)
    // 要写的每个文件先从剩余空间里扣掉估计大小（画面按原分片大小、声音按原文件采样量），不够就整次不合并。
    let free = disk.bavail * disk.bsize - RESERVE_BYTES
    const reserve = (bytes: number, what: string): void => { if (free < bytes) throw new Error(`磁盘空间不够再写一份合并后的${what}`); free -= bytes }
    const audioKinds = new Map<AudioKind, RecordingMedia[]>()
    for (const kind of ['microphone', 'systemAudio'] as AudioKind[]) {
      const sources = content.media.filter(item => item.kind === kind && item.durationUs > 0)
      if (!sources.length) continue
      if (await combinableAudio(sources)) audioKinds.set(kind, sources)
      else logger.info('这一路声音中途换了采样格式，照原样分段导入', { event: 'recording.combine.audio_separate', context: { sessionId, kind } })
    }
    const result: RecordingCombinedFiles[] = []
    for (const [index, group] of plan.entries()) {
      const suffix = String(index).padStart(3, '0')
      let screen = media.get(group.parts[0].mediaId)!.path
      // 各片来自不同文件时才拼；原生采集的连续文件各片都是它自己，直接用原件。
      if (new Set(group.parts.map(part => part.mediaId)).size > 1) {
        screen = path.join(directory, `screen-combined-${suffix}.mp4`)
        if (!await exists(screen) || !matchesFrames(await durationUs(ffprobe, screen).catch(() => NaN), group)) {
          reserve((await Promise.all(group.parts.map(part => fs.stat(media.get(part.mediaId)!.path).then(stat => stat.size, () => 0)))).reduce((sum, size) => sum + size, 0), '画面')
          await writeCombinedScreen(directory, screen, group, media)
        }
      }
      const audio: RecordingCombinedFiles['audio'] = {}
      for (const [kind, sources] of audioKinds) {
        const file = path.join(directory, `${kind}-combined-${suffix}.wav`)
        if (!await audioUpToDate(file, group)) {
          reserve((await combinableAudio(sources))!.bytes, '声音')
          await writeCombinedAudio(file, group, sources)
        }
        audio[kind] = file
      }
      result.push({ ...group, screen, audio })
    }
    logger.info('录制已合并成一个画面素材', { event: 'recording.combine.completed', context: { sessionId, groups: result.length, durationMs: Math.round(result.reduce((sum, group) => sum + group.frames / group.fps, 0) * 1000), elapsedMs: Date.now() - started } })
    return result
  } catch (error) {
    logger.warn('录制合并失败，原分片都在，按分段导入', { event: 'recording.combine.failed', error, context: { sessionId } })
    throw error
  }
}
