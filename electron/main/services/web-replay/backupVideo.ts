import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import { release } from 'node:os'
import path from 'node:path'
import { desktopCapturer } from 'electron'
import { captureOptionsSchema, type CaptureManifest } from '../../../../src/core/screenRecording/capture'
import type { WebRecordingBackupOptions } from '../../../../src/platform/contracts/webReplay'
import { mediaPermissions } from '../media-permissions'
import { resolveNativeCaptureSource } from '../screen-recording/capture/source'
import { createMainLogger } from '../logging'
import { GfxCaptureBackend, type NativeCaptureSource } from '../screen-recording/capture/gfxcapture'
import { CaptureStorage } from '../screen-recording/capture/storage'
import { loadFfmpegPath } from '../video/ffmpeg-loader'
import { quickExportAudioGraph } from '../screen-recording/quick-export'
import { recordingTracksSchema } from '../../../../src/core/screenRecording/tracks'
import { webRecordingBackupTimingSchema } from '../../../../src/core/webReplay/videoEvents'

const logger = createMainLogger('main.web_replay.backup')
export const BACKUP_VIDEO_FILE = 'backup.mp4'
/** Where the recording page writes the backup's microphone and system sound (its own tracks.json + files). */
export const BACKUP_AUDIO_DIRECTORY = 'backup-audio'
/** Picture timing of backup.mp4, kept so sound recorded beside it can be laid in later. */
export const BACKUP_TIMING_FILE = 'backup.json'
const now = (): number => Number(process.hrtime.bigint() / 1000n)
const even = (value: number, max: number): number => Math.max(2, Math.min(max, Math.floor(value / 2) * 2))

/**
 * A plain screen recording of the recorded app's window (or a whole monitor), kept beside the recording data in case a
 * replay ever falls short. It reuses the screen recorder's native window capture (with the real
 * pointer) but not its session or control bar, so it never blocks or disturbs ordinary recordings.
 */
export class WebRecordingBackupVideo {
  private constructor(private readonly backend: GfxCaptureBackend, private readonly storage: CaptureStorage, private readonly directory: string, private readonly originUs: number) {}

  /** Returns null (with the reason) when the window cannot be found or captured on this system. */
  static async start(directory: string, recordingId: string, appName: string, viewport: { width: number; height: number; dpr: number }, request: WebRecordingBackupOptions): Promise<{ backup: WebRecordingBackupVideo } | { reason: string }> {
    if (process.platform !== 'win32' || Number(release().split('.')[2]) < 18362) return { reason: '当前系统不支持原生录屏，未录制备份视频' }
    let sourceId: string
    let native: NativeCaptureSource
    let size: { width: number; height: number }
    if (request.target === 'screen') {
      const screenSource = (await mediaPermissions.sources([], false, 'screen')).find(item => item.id === request.sourceId)
      if (!screenSource) return { reason: '所选显示器已断开，未录制备份视频' }
      sourceId = screenSource.id
      native = await resolveNativeCaptureSource(screenSource)
      size = { width: request.width, height: request.height }
    } else {
      const windows = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: 0, height: 0 } })
      const window = windows.find(item => item.name === appName) ?? windows.find(item => item.name.includes(appName))
      const hwnd = window?.id.match(/^window:(\d+):/)?.[1]
      if (!window || !hwnd) return { reason: `没有找到「${appName}」的窗口，未录制备份视频` }
      sourceId = window.id
      native = { selector: 'hwnd', handle: hwnd, width: 0, height: 0 }
      // A window is recorded at its own size.
      size = { width: even(viewport.width * viewport.dpr, 3840), height: even(viewport.height * viewport.dpr, 2160) }
    }
    const { fps, rateControl, bitrate, keyframeFrames, codec, encoder } = request
    const options = captureOptionsSchema.parse({ sourceId, backend: 'gfxcapture', fps, rateControl, bitrate, keyframeFrames, codec, encoder, ...size })
    const manifest: CaptureManifest = { version: 2, minReaderVersion: 1, sessionId: recordingId, options, backend: 'gfxcapture', cursorEmbedded: true, status: 'prepared', spans: [] }
    const backupDirectory = path.join(directory, 'backup')
    const storage = new CaptureStorage(backupDirectory, manifest)
    await storage.prepare()
    const origin = now()
    const backend = new GfxCaptureBackend(options, native, storage, {
      nowUs: () => now() - origin,
      failed: error => logger.warn('网页录制的备份录屏中断', { event: 'web_replay.backup.failed', context: { recordingId }, error }),
    }, true)
    await backend.prepare()
    await backend.start(new AbortController().signal)
    logger.info('网页录制的备份录屏开始', { event: 'web_replay.backup.started', context: { recordingId, target: request.target, ...size, fps: options.fps } })
    return { backup: new WebRecordingBackupVideo(backend, storage, directory, origin) }
  }

  /** Stops capture and leaves one ordinary MP4 (`backup.mp4`) in the recording directory. */
  async stop(): Promise<string | null> {
    try {
      await this.backend.stop(new AbortController().signal)
      await this.storage.release()
      const spans = this.storage.manifest.spans.filter(span => span.durationUs > 0)
      if (!spans.length) return null
      const output = path.join(this.directory, BACKUP_VIDEO_FILE)
      const ffmpeg = await loadFfmpegPath()
      // Captured spans are fragmented MP4; one stream copy makes a normal, seekable file.
      const list = path.join(this.storage.directory, 'spans.txt')
      await fs.writeFile(list, spans.map(span => `file '${this.storage.file(span).replace(/\\/g, '/').replace(/'/g, "'\\''")}'`).join('\n'))
      await new Promise<void>((resolve, reject) => execFile(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', '-movflags', '+faststart', output], { windowsHide: true }, error => (error ? reject(error) : resolve())))
      await fs.rm(this.storage.directory, { recursive: true, force: true })
      await fs.writeFile(path.join(this.directory, BACKUP_TIMING_FILE), JSON.stringify(webRecordingBackupTimingSchema.parse({ originUs: this.originUs, spans: spans.map(({ monoUs, durationUs }) => ({ monoUs, durationUs })) })))
      await mixWebRecordingBackupAudio(this.directory)
      return output
    } catch (error) {
      logger.warn('网页录制的备份录屏保存失败，原始片段保留在 backup 目录', { event: 'web_replay.backup.save_failed', error })
      return null
    }
  }
}

const mixing = new Map<string, Promise<boolean>>()

/**
 * Lays the sound recorded beside the backup into backup.mp4 (picture stream-copied, sound mixed), then
 * removes the separate sound files. Waits briefly for the picture when the recording is still being
 * saved; does nothing when there is no sound. Calls for one recording run one at a time.
 */
export function mixWebRecordingBackupAudio(directory: string, waitMs = 0): Promise<boolean> {
  const previous = mixing.get(directory) ?? Promise.resolve(false)
  const next = previous.catch(() => false).then(() => mixNow(directory, waitMs))
  mixing.set(directory, next)
  void next.finally(() => { if (mixing.get(directory) === next) mixing.delete(directory) }).catch(() => undefined)
  return next
}

async function mixNow(directory: string, waitMs: number): Promise<boolean> {
  const audioDirectory = path.join(directory, BACKUP_AUDIO_DIRECTORY)
  const tracksText = await fs.readFile(path.join(audioDirectory, 'tracks.json'), 'utf8').catch(() => null)
  if (tracksText === null) return false
  const timingFile = path.join(directory, BACKUP_TIMING_FILE)
  for (const deadline = Date.now() + waitMs; ;) {
    if (await fs.access(timingFile).then(() => true, () => false)) break
    if (Date.now() >= deadline) return false
    await new Promise(resolve => setTimeout(resolve, 500))
  }
  const timing = webRecordingBackupTimingSchema.parse(JSON.parse(await fs.readFile(timingFile, 'utf8')))
  const tracks = recordingTracksSchema.parse(JSON.parse(tracksText))
  // Both clocks are Henji's monotonic microseconds; only their zero points differ.
  const shift = tracks.originUs - timing.originUs
  const audio = tracks.tracks.filter(track => track.kind !== 'camera').flatMap(track => track.segments.map(segment => ({
    kind: track.kind, path: path.join(audioDirectory, segment.file), monoUs: segment.monoSpanUs[0] + shift, durationUs: segment.monoSpanUs[1] - segment.monoSpanUs[0],
  }))).filter(item => item.durationUs > 0)
  let outputUs = 0
  const windows = timing.spans.map(span => { const window = { startUs: span.monoUs, endUs: span.monoUs + span.durationUs, outputUs }; outputUs += span.durationUs; return window })
  const mix = quickExportAudioGraph(audio, windows, 1)
  if (mix) {
    const video = path.join(directory, BACKUP_VIDEO_FILE)
    const mixed = path.join(directory, `backup-mixing-${process.pid}.mp4`)
    const ffmpeg = await loadFfmpegPath()
    try {
      await new Promise<void>((resolve, reject) => execFile(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-i', video, ...audio.flatMap(item => ['-i', item.path]), '-filter_complex', mix.graph, '-map', '0:v:0', '-map', mix.label, '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart', mixed], { windowsHide: true }, error => (error ? reject(error) : resolve())))
      await fs.rename(mixed, video)
    } catch (error) {
      await fs.rm(mixed, { force: true })
      logger.warn('备份录屏的声音合成失败，声音文件保留在 backup-audio 目录', { event: 'web_replay.backup.audio_failed', error })
      return false
    }
  }
  await fs.rm(audioDirectory, { recursive: true, force: true })
  logger.info('备份录屏已合成声音', { event: 'web_replay.backup.audio_mixed', context: { tracks: audio.length, mixed: Boolean(mix) } })
  return Boolean(mix)
}
