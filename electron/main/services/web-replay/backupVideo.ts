import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import { release } from 'node:os'
import path from 'node:path'
import { desktopCapturer } from 'electron'
import { captureOptionsSchema, type CaptureManifest } from '../../../../src/core/screenRecording/capture'
import { createMainLogger } from '../logging'
import { GfxCaptureBackend } from '../screen-recording/capture/gfxcapture'
import { CaptureStorage } from '../screen-recording/capture/storage'
import { loadFfmpegPath } from '../video/ffmpeg-loader'

const logger = createMainLogger('main.web_replay.backup')
export const BACKUP_VIDEO_FILE = 'backup.mp4'
const now = (): number => Number(process.hrtime.bigint() / 1000n)
const even = (value: number, max: number): number => Math.max(2, Math.min(max, Math.floor(value / 2) * 2))

/**
 * A plain screen recording of the recorded app's window, kept beside the recording data in case a
 * replay ever falls short. It reuses the screen recorder's native window capture (with the real
 * pointer) but not its session or control bar, so it never blocks or disturbs ordinary recordings.
 */
export class WebRecordingBackupVideo {
  private constructor(private readonly backend: GfxCaptureBackend, private readonly storage: CaptureStorage, private readonly directory: string) {}

  /** Returns null (with the reason) when the window cannot be found or captured on this system. */
  static async start(directory: string, recordingId: string, appName: string, viewport: { width: number; height: number; dpr: number }): Promise<{ backup: WebRecordingBackupVideo } | { reason: string }> {
    if (process.platform !== 'win32' || Number(release().split('.')[2]) < 18362) return { reason: '当前系统不支持窗口录屏，未录制备份视频' }
    const windows = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: 0, height: 0 } })
    const window = windows.find(item => item.name === appName) ?? windows.find(item => item.name.includes(appName))
    const hwnd = window?.id.match(/^window:(\d+):/)?.[1]
    if (!window || !hwnd) return { reason: `没有找到「${appName}」的窗口，未录制备份视频` }
    const options = captureOptionsSchema.parse({ sourceId: window.id, backend: 'gfxcapture', fps: 30, width: even(viewport.width * viewport.dpr, 3840), height: even(viewport.height * viewport.dpr, 2160) })
    const manifest: CaptureManifest = { version: 2, minReaderVersion: 1, sessionId: recordingId, options, backend: 'gfxcapture', cursorEmbedded: true, status: 'prepared', spans: [] }
    const backupDirectory = path.join(directory, 'backup')
    const storage = new CaptureStorage(backupDirectory, manifest)
    await storage.prepare()
    const origin = now()
    const backend = new GfxCaptureBackend(options, { selector: 'hwnd', handle: hwnd, width: 0, height: 0 }, storage, {
      nowUs: () => now() - origin,
      failed: error => logger.warn('网页录制的备份录屏中断', { event: 'web_replay.backup.failed', context: { recordingId }, error }),
    }, true)
    await backend.prepare()
    await backend.start(new AbortController().signal)
    logger.info('网页录制的备份录屏开始', { event: 'web_replay.backup.started', context: { recordingId, window: window.name } })
    return { backup: new WebRecordingBackupVideo(backend, storage, directory) }
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
      return output
    } catch (error) {
      logger.warn('网页录制的备份录屏保存失败，原始片段保留在 backup 目录', { event: 'web_replay.backup.save_failed', error })
      return null
    }
  }
}
