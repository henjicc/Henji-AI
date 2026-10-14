import { spawn } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { getDocumentService } from '../documents/runtime'
import { recordingDocumentSchema, type RecordingDocument, type RecordingMedia } from '../../../../src/core/screenRecording/document'
import { recordingMediaSpans } from '../../../../src/core/screenRecording/range'
import type { CaptureEvent } from '../../../../src/core/captureLog/events'
import { loadFfmpegPath } from '../video/ffmpeg-loader'
import { getUserFolderDir } from '../appPaths'
import { createMainLogger } from '../logging'
import { readRecordingEvents } from './session-document'
import { appendRecordingEventsBox, type EmbeddedRecordingEvents } from './embedded-events'

const logger = createMainLogger('main.screen_recording.quick_export')
/** Files written by this run; only these may be revealed again, never caller-supplied paths. */
const exported = new Map<string, string>()

interface Window { startUs: number; endUs: number; outputUs: number }

export interface QuickExportFile { path: string; outpointUs?: number }
/**
 * Screen files back to back, cut by the shared range and pauses: the countdown warm-up, paused stretches and
 * the encoder's tail after stop are left out. With stream copy only two cuts are exact: the very start (a seek
 * on the joined input) and every file's end (`outpoint`); a resumed file therefore keeps its first few frames,
 * and the windows say so, which keeps the sound aligned with what is really in the file.
 */
export function quickExportWindows(recording: Pick<RecordingDocument, 'media' | 'startUs' | 'endUs' | 'pauses' | 'tracks'>): { windows: Window[]; seekUs: number; files: QuickExportFile[] } {
  let joinedUs = 0, outputUs = 0, seekUs = 0
  const windows: Window[] = [], files: QuickExportFile[] = []
  for (const item of recording.media.filter(item => item.kind === 'screen' && item.durationUs > 0).sort((a, b) => a.monoUs - b.monoUs)) {
    const spans = recordingMediaSpans(recording, item)
    if (spans.length) {
      const startUs = windows.length ? item.monoUs : spans[0].startUs, endUs = spans.at(-1)!.endUs
      if (!windows.length) seekUs = joinedUs + startUs - item.monoUs
      windows.push({ startUs, endUs, outputUs }); outputUs += endUs - startUs
      files.push({ path: item.path, ...(endUs < item.monoUs + item.durationUs ? { outpointUs: endUs - item.monoUs } : {}) })
      joinedUs += endUs - item.monoUs
    }
  }
  return { windows, seekUs, files }
}
/** Concat demuxer list; paths are quoted for the demuxer's own escaping rules. */
export function quickExportList(files: readonly QuickExportFile[]): string {
  return files.map(file => [`file '${file.path.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`, ...(file.outpointUs !== undefined ? [`outpoint ${(file.outpointUs / 1e6).toFixed(6)}`] : [])].join('\n')).join('\n')
}

export function quickExportOutputUs(windows: readonly Window[], monoUs: number): number | null {
  const window = windows.find(item => monoUs >= item.startUs && monoUs < item.endUs)
  return window ? window.outputUs + monoUs - window.startUs : null
}

/** Each audio file contributes only the parts that overlap a screen span, placed at that span's output time. */
export function quickExportAudioGraph(audio: readonly RecordingMedia[], windows: readonly Window[], firstInput: number): { graph: string; label: string } | null {
  const parts: string[] = [], labels: string[] = []
  audio.forEach((item, index) => {
    for (const window of windows) {
      const start = Math.max(item.monoUs, window.startUs), end = Math.min(item.monoUs + item.durationUs, window.endUs)
      if (end - start < 10_000) continue
      const label = `a${labels.length}`
      const delayMs = Math.round((window.outputUs + start - window.startUs) / 1000)
      parts.push(`[${firstInput + index}:a]atrim=start=${((start - item.monoUs) / 1e6).toFixed(6)}:duration=${((end - start) / 1e6).toFixed(6)},asetpts=PTS-STARTPTS,adelay=${delayMs}:all=1[${label}]`)
      labels.push(`[${label}]`)
    }
  })
  if (!labels.length) return null
  return { graph: `${parts.join(';')};${labels.join('')}amix=inputs=${labels.length}:normalize=0:dropout_transition=0[aout]`, label: '[aout]' }
}

function compactEvents(events: readonly CaptureEvent[], windows: readonly Window[]): EmbeddedRecordingEvents['events'] {
  const rows: EmbeddedRecordingEvents['events'] = []
  for (const event of events) {
    const outputUs = quickExportOutputUs(windows, event.monoUs)
    if (outputUs === null) continue
    const ms = Math.round(outputUs / 1000)
    if (event.kind === 'cursor') rows.push([ms, 'cursor', event.point?.[0] ?? null, event.point?.[1] ?? null, event.shape])
    else if (event.kind === 'click') rows.push([ms, 'click', event.point[0], event.point[1], event.button, event.phase])
    else if (event.kind === 'scroll') rows.push([ms, 'scroll', event.point[0], event.point[1], event.axis, event.amount])
    else if (event.kind === 'key') rows.push([ms, 'key', event.category])
    else if (event.kind === 'mark') rows.push([ms, 'mark', event.note ?? ''])
  }
  return rows
}

/**
 * Video is stream-copied; only the mixed sound is encoded. Seeking the joined input with stream copy keeps the
 * keyframe before the start and writes an edit list, so playback still begins on the exact frame.
 */
export function quickExportArgs(list: string, audio: readonly string[], mix: { graph: string; label: string } | null, output: string, seekUs = 0, durationUs?: number): string[] {
  return ['-v', 'error', '-y', ...(seekUs > 0 ? ['-ss', (seekUs / 1e6).toFixed(6)] : []), '-f', 'concat', '-safe', '0', '-i', list, ...audio.flatMap(file => ['-i', file]),
    ...(durationUs !== undefined ? ['-t', (durationUs / 1e6).toFixed(6)] : []),
    ...(mix ? ['-filter_complex', mix.graph, '-map', '0:v:0', '-map', mix.label, '-c:a', 'aac', '-b:a', '192k'] : ['-map', '0:v:0', '-an']),
    '-c:v', 'copy', '-movflags', '+faststart', output]
}

function run(binary: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true })
    let errors = ''
    child.stderr.on('data', (chunk: Buffer) => { errors = (errors + chunk.toString('utf8')).slice(-8192) })
    child.on('error', reject)
    child.once('close', code => code === 0 ? resolve() : reject(new Error(`视频合成失败：${errors.trim().split('\n').at(-1) || `退出码 ${code}`}`)))
  })
}

function availableName(directory: string, base: string): string {
  const safe = base.replace(/[\\/:*?"<>|]+/g, '-').trim().slice(0, 120) || '屏幕录制'
  for (let index = 1; ; index++) {
    const candidate = path.join(directory, `${safe}${index > 1 ? ` (${index})` : ''}.mp4`)
    if (!existsSync(candidate)) return candidate
  }
}

/**
 * Quick mode: the picture already contains the system pointer, so the file only needs its spans joined
 * and its sound mixed — video is stream-copied, never re-encoded. Pointer facts ride along in the file.
 */
export async function exportQuickRecording(sessionId: string, directory?: string): Promise<{ path: string; durationUs: number; events: number }> {
  const read = await getDocumentService().readDocument({ id: sessionId })
  if (read.meta.kind !== 'screen_recording') throw new Error('请选择录制会话')
  const content: RecordingDocument = recordingDocumentSchema.parse(read.content)
  const { windows, seekUs, files } = quickExportWindows(content)
  if (!windows.length || !content.source) throw new Error('这段录制没有可保存的画面')
  const target = directory ?? path.join(getUserFolderDir('exports'), '屏幕录制')
  await mkdir(target, { recursive: true })
  if (!statSync(target).isDirectory()) throw new Error('保存位置不是文件夹')
  const output = availableName(target, read.meta.name)
  const audio = content.media.filter(item => (item.kind === 'microphone' || item.kind === 'systemAudio') && item.durationUs > 0)
  const list = path.join(path.dirname(files[0].path), `quick-export-${process.pid}.txt`)
  await writeFile(list, quickExportList(files), 'utf8')
  const ffmpeg = await loadFfmpegPath()
  const mix = quickExportAudioGraph(audio, windows, 1)
  const started = Date.now()
  const durationUs = windows.reduce((sum, window) => sum + window.endUs - window.startUs, 0)
  try {
    await run(ffmpeg, quickExportArgs(list, audio.map(item => item.path), mix, output, seekUs, durationUs))
  } catch (error) { await rm(output, { force: true }); throw error } finally { await rm(list, { force: true }) }
  const events: CaptureEvent[] = []
  for (let offset: number | null = 0; offset !== null;) {
    const page = await readRecordingEvents(sessionId, offset, 4096, false)
    events.push(...page.events); offset = page.nextOffset
  }
  const rows = compactEvents(events, windows)
  const options = content.source.options
  await appendRecordingEventsBox(output, { format: 'henji.recording-events', version: 1, video: { width: options.width, height: options.height, fps: options.fps, durationMs: Math.round(durationUs / 1000) }, cursorEmbedded: content.source.cursorEmbedded, events: rows })
  exported.set(sessionId, output)
  logger.info('快速录制已保存为视频', { event: 'recording.quick_export.completed', context: { sessionId, file: output, durationMs: Math.round(durationUs / 1000), events: rows.length, elapsedMs: Date.now() - started } })
  return { path: output, durationUs, events: rows.length }
}

export function quickExportPath(sessionId: string): string | undefined {
  const file = exported.get(sessionId)
  return file && existsSync(file) ? file : undefined
}
