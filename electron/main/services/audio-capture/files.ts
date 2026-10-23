import fs from 'node:fs/promises'
import path from 'node:path'
import { audioCaptureRecoverySchema, type AudioCaptureFile } from '../../../../src/core/audioCapture/contracts'
import { audioCaptureFileName } from '../../../../src/core/audioCapture/fileName'
import type { CaptureSettingsStore } from './settings'
import { createMainLogger } from '../logging'

const KEY = 'audio_capture.pending_files'
const logger = createMainLogger('main.audio_capture.files')
/** 与录音命令共用串行队列。先持久登记，再开始采集；失败不会把用户录音变成无人认领的文件。 */
export class AudioCaptureFiles {
  constructor(private readonly root: () => string, private readonly store: () => CaptureSettingsStore, private readonly trash: (path: string) => Promise<void>) {}
  private read(): string[] {
    const raw = this.store().get(KEY)
    if (!raw) return []
    let value: unknown
    try { value = JSON.parse(raw) } catch { throw new Error('未完成录音记录无法读取，原始文件仍保留在作品目录的“录音”文件夹') }
    if (value && typeof value === 'object' && 'version' in value && value.version !== 1) throw new Error('未完成录音记录由更新版本创建，请升级后恢复')
    const parsed = audioCaptureRecoverySchema.safeParse(value)
    if (!parsed.success) throw new Error('未完成录音记录无法读取，原始文件仍保留在作品目录的“录音”文件夹')
    return parsed.data.files
  }
  private write(files: string[]): void { this.store().set(KEY, JSON.stringify(audioCaptureRecoverySchema.parse({ version: 1, minReaderVersion: 1, files })), 'json') }
  private folder(): string { return path.join(this.root(), '录音') }
  private file(name: string): AudioCaptureFile { return { outputPath: path.join(this.folder(), name), name } }
  async prepare(now = new Date()): Promise<AudioCaptureFile> {
    logger.info('准备录音文件', { event: 'audio_capture.file.prepare.start' })
    try {
      const names = this.read()
      await fs.mkdir(this.folder(), { recursive: true })
      let ordinal = 0
      let name = audioCaptureFileName(now)
      while (names.includes(name) || await this.exists(this.file(name).outputPath)) name = audioCaptureFileName(now, ++ordinal)
      this.write([...names, name])
      logger.info('录音恢复记录已保存', { event: 'audio_capture.file.prepare.completed' })
      return this.file(name)
    } catch (error) { logger.warn('准备录音文件失败', { event: 'audio_capture.file.prepare.failed', error }); throw error }
  }
  private async exists(target: string): Promise<boolean> {
    try { await fs.lstat(target); return true } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error }
  }
  async pending(): Promise<AudioCaptureFile[]> {
    const files: AudioCaptureFile[] = []
    for (const name of this.read()) { const file = this.file(name); if (await this.exists(file.outputPath)) files.push(file) }
    return files
  }
  private assertManaged(outputPath: string): string {
    const name = path.basename(outputPath)
    if (path.resolve(outputPath) !== path.resolve(this.file(name).outputPath) || !this.read().includes(name)) throw new Error('只能处理本应用尚未完成的录音')
    return name
  }
  complete(outputPath: string): void {
    const name = this.assertManaged(outputPath)
    this.write(this.read().filter(item => item !== name))
  }
  async discard(outputPath: string): Promise<void> {
    this.assertManaged(outputPath)
    logger.info('录音移到回收站', { event: 'audio_capture.file.trash.start' })
    try {
      if (await this.exists(outputPath)) await this.trash(outputPath)
      this.complete(outputPath)
      logger.info('录音已移到回收站', { event: 'audio_capture.file.trash.completed' })
    } catch (error) { logger.warn('录音回收失败，恢复记录已保留', { event: 'audio_capture.file.trash.failed', error }); throw error }
  }
}
