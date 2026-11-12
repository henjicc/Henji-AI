import { persistenceFileContract } from '../../../../../src/core/persistence/fileContracts'
import { upgradePersistenceContent } from '../../../../../src/core/persistence/migrations'
import { backupBeforePersistenceUpgrade } from '../../persistence/file-upgrade'
import fs from 'node:fs/promises'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { captureManifestSchema, type CaptureManifest, type CaptureSpan } from '../../../../../src/core/screenRecording/capture'
import { loadFfmpegPath, loadFfprobePath } from '../../video/ffmpeg-loader'
import { createMainLogger } from '../../logging'
import { writeBufferAtomically } from '../../fs/atomic-file'

const logger = createMainLogger('main.screen_recording.capture')
const RESERVE_BYTES = 256 * 1024 * 1024
export async function assertCaptureDiskSpace(directory: string): Promise<void> {
  const disk = await fs.statfs(directory)
  if (disk.bavail * disk.bsize < RESERVE_BYTES) throw new Error('磁盘空间不足，录制已停止；请释放空间后重新录制。已保存的片段可以恢复。')
}

/** Acknowledged writes are durable. The manifest is never the only copy of captured media. */
export class CaptureStorage {
  private writer: { index: number; handle: fs.FileHandle; size: number } | null = null
  private tail: Promise<unknown> = Promise.resolve()
  private saves: Promise<void> = Promise.resolve()
  constructor(readonly directory: string, readonly manifest: CaptureManifest, private readonly published?: (manifest: CaptureManifest) => Promise<void>) {}
  async prepare(): Promise<void> {
    await fs.mkdir(this.directory, { recursive: true })
    await assertCaptureDiskSpace(this.directory)
    // Session directories are exclusive: preparing again must never overwrite a recording.
    await writeBufferAtomically(path.join(this.directory, 'capture.json'), Buffer.from(JSON.stringify(captureManifestSchema.parse(this.manifest))), undefined, { exclusive: true })
  }
  save(): Promise<void> {
    const content = JSON.stringify(captureManifestSchema.parse(this.manifest))
    const task = this.saves.then(async () => { await writeBufferAtomically(path.join(this.directory, 'capture.json'), Buffer.from(content)); await this.published?.(captureManifestSchema.parse(JSON.parse(content))) })
    this.saves = task.catch(() => undefined)
    return task
  }
  async openSpan(monoUs: number, external = false): Promise<CaptureSpan> {
    if (this.writer) throw new Error('上一录制片段尚未关闭')
    await assertCaptureDiskSpace(this.directory)
    const index = this.manifest.spans.length
    const span: CaptureSpan = { index, file: `screen-${String(index).padStart(6, '0')}.mp4`, monoUs: Math.max(0, Math.round(monoUs)), durationUs: 0, finalized: false }
    this.manifest.spans.push(span)
    await this.save() // Publish the recovery entry before spawning/opening media.
    if (!external) this.writer = { index, handle: await fs.open(this.file(span), 'wx'), size: 0 }
    return span
  }
  file(span: CaptureSpan): string { return path.join(this.directory, span.file) }
  write(index: number, position: number, data: Uint8Array): Promise<void> {
    const task = this.tail.then(async () => {
      const writer = this.writer
      if (!writer || writer.index !== index) throw new Error('录制片段已关闭')
      if (position > writer.size || data.byteLength > 2 * 1024 * 1024) throw new Error('录制写入位置或大小无效')
      await assertCaptureDiskSpace(this.directory)
      let offset = 0
      while (offset < data.byteLength) {
        const { bytesWritten } = await writer.handle.write(data, offset, data.byteLength - offset, position + offset)
        if (!bytesWritten) throw new Error('录制片段写入失败')
        offset += bytesWritten
      }
      writer.size = Math.max(writer.size, position + offset)
      await writer.handle.datasync()
    })
    this.tail = task.catch(() => undefined)
    return task
  }
  async seal(index: number, durationUs: number): Promise<void> {
    await this.tail
    const span = this.manifest.spans[index]
    if (!span) throw new Error('录制片段不存在')
    if (this.writer) {
      if (this.writer.index !== index) throw new Error('录制片段已改变')
      const writer = this.writer; this.writer = null
      try { await writer.handle.sync() } finally { await writer.handle.close() }
    }
    span.durationUs = Math.round(durationUs); span.finalized = true
    await this.save()
  }
  async release(): Promise<void> {
    await this.tail
    const writer = this.writer; this.writer = null
    if (writer) { try { await writer.handle.sync() } finally { await writer.handle.close() } }
  }
}

function run(binary: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => execFile(binary, args, { windowsHide: true, timeout: 30_000, maxBuffer: 1024 * 1024 }, (error, stdout) => error ? reject(error) : resolve(stdout)))
}
export async function readCaptureManifest(directory: string): Promise<CaptureManifest> {
  const file = path.join(directory, 'capture.json'), text = await fs.readFile(file, 'utf8')
  const raw = JSON.parse(text) as { version: number; minReaderVersion?: number }
  const contract = persistenceFileContract('screen-capture')
  const backup = await backupBeforePersistenceUpgrade(file, contract, raw.version, text)
  return captureManifestSchema.parse(upgradePersistenceContent(contract, raw, raw.version, backup, raw.minReaderVersion))
}
export async function probeMediaDurationUs(file: string): Promise<number> {
  const duration = Number((await run(await loadFfprobePath(), ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file])).trim())
  if (!(duration > 0)) throw new Error('录制片段没有可恢复画面')
  return Math.round(duration * 1_000_000)
}

/**
 * 补齐没封口的画面分片。分片 MP4 边录边可读，先按原文件里真实写到的画面算时长、直接用原件；
 * 原件读不出时才另存一份重新封装的副本。已封口的分片不碰，原件永远保留。
 */
export async function recoverCapture(directory: string, manifest?: CaptureManifest): Promise<{ manifest: CaptureManifest; files: Array<{ index: number; path: string; monoUs: number; durationUs: number }>; rejected: number[]; repaired: number }> {
  manifest ??= await readCaptureManifest(directory)
  const files: Array<{ index: number; path: string; monoUs: number; durationUs: number }> = [], rejected: number[] = []
  let repaired = 0
  for (const span of manifest.spans) {
    const original = path.join(directory, span.file)
    if (span.finalized && span.durationUs > 0) { files.push({ index: span.index, path: original, monoUs: span.monoUs, durationUs: span.durationUs }); continue }
    try {
      span.durationUs = await probeMediaDurationUs(original); span.finalized = true
      files.push({ index: span.index, path: original, monoUs: span.monoUs, durationUs: span.durationUs }); repaired++
    } catch (probeFailure) {
      const output = path.join(directory, `recovered-${span.index}.mp4`)
      try {
        await assertCaptureDiskSpace(directory)
        await run(await loadFfmpegPath(), ['-hide_banner', '-v', 'error', '-y', '-i', original, '-map', '0:v:0', '-c', 'copy', '-movflags', '+faststart', output])
        files.push({ index: span.index, path: output, monoUs: span.monoUs, durationUs: await probeMediaDurationUs(output) }); repaired++
      } catch (error) {
        rejected.push(span.index)
        logger.warn('录制片段未能恢复，原文件已保留', { event: 'recording.capture.recovery.segment_failed', error, context: { index: span.index, probe: String(probeFailure) } })
      }
    }
  }
  if (repaired || rejected.length) logger.info('补齐未封口的画面分片', { event: 'recording.capture.recovery.completed', context: { sessionId: manifest.sessionId, repaired, rejected: rejected.length } })
  return { manifest, files, rejected, repaired }
}
