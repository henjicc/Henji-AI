import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { ZipArchive } from 'archiver'
import { openZip, iterateEntries, readEntryBytes, isSymbolicLinkEntry } from '../zip-archive'
import { encodeRecordingWav, type RecordingAudioRequest, type RecordingAudioResult } from '../../../../src/core/audioEdit/recordingAudio'
import { timestampedAsrService, type TimestampedAsrService } from './timestamped-asr'
import { createAudioEditTask, updateAudioEditTask, registerAudioEditTaskController, deleteAudioEditTasks, getAudioEditStoredTask } from './task-store'

/** Original audio is private temporary media. No raw paths cross the IPC. */
export class ExplanationAudioService {
  private active = new Map<string, AbortController>()
  private erased = new Set<string>()
  private io = new Map<string, Promise<unknown>>()
  constructor(private readonly root = path.join(os.tmpdir(), 'henji-explanation-audio'), private readonly asr: Pick<TimestampedAsrService, 'prepare' | 'execute' | 'preflight'> = timestampedAsrService) {}
  private directory(id: string): string { if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error('录音会话身份无效。'); return path.join(this.root, id) }
  private file(sessionId: string, chunkId: string): string { if (!/^[0-9a-f-]{36}$/i.test(chunkId)) throw new Error('录音块身份无效。'); return path.join(this.directory(sessionId), `${chunkId}.wav`) }
  async cleanupExpired(now = Date.now()): Promise<void> {
    await fs.mkdir(this.root, { recursive: true })
    for (const entry of await fs.readdir(this.root, { withFileTypes: true })) {
      if (!entry.isDirectory() || !/^[0-9a-f-]{36}$/i.test(entry.name) || this.active.has(entry.name)) continue
      const directory = this.directory(entry.name)
      if (now - (await fs.stat(directory)).mtimeMs > 24 * 60 * 60 * 1000) await this.release(entry.name)
    }
  }
  private async serial<T>(sessionId: string, operation: () => Promise<T>): Promise<T> {
    const next = (this.io.get(sessionId) ?? Promise.resolve()).catch(() => undefined).then(operation)
    this.io.set(sessionId, next)
    try { return await next } finally { if (this.io.get(sessionId) === next) this.io.delete(sessionId) }
  }
  async write(request: Extract<RecordingAudioRequest, { action: 'write' }>): Promise<void> { return this.serial(request.sessionId, () => this.writeChunk(request)) }
  private async writeChunk(request: Extract<RecordingAudioRequest, { action: 'write' }>): Promise<void> {
    if (this.erased.has(request.sessionId)) throw new Error('原录音已删除。')
    await fs.mkdir(this.directory(request.sessionId), { recursive: true })
    const bytes = encodeRecordingWav(request.samples, request.sampleRate)
    const file = this.file(request.sessionId, request.chunkId)
    if (this.erased.has(request.sessionId)) { await fs.rm(this.directory(request.sessionId), { recursive: true, force: true }); throw new Error('原录音已删除。') }
    try { await fs.writeFile(file, bytes, { flag: 'wx' }) }
    catch (error) {
      if (!(error && typeof error === 'object' && 'code' in error && error.code === 'EEXIST')) throw error
      const existing = await fs.readFile(file); if (!existing.equals(Buffer.from(bytes))) throw new Error('录音块已存在且内容不同。')
    }
    if (this.erased.has(request.sessionId)) { await fs.rm(this.directory(request.sessionId), { recursive: true, force: true }); throw new Error('原录音已删除。') }
    const now = new Date(); await fs.utimes(this.directory(request.sessionId), now, now)
  }
  async read(sessionId: string, chunkId: string): Promise<Uint8Array> { return new Uint8Array(await fs.readFile(this.file(sessionId, chunkId))) }
  cancel(sessionId: string): void { this.active.get(sessionId)?.abort() }
  async release(sessionId: string): Promise<void> {
    this.cancel(sessionId)
    // Keep submission receipts until privacy erasure. Audio TTL must not permit a second charge.
    await this.serial(sessionId, async () => { await fs.rm(this.directory(sessionId), { recursive: true, force: true }) })
  }
  async erase(sessionId: string): Promise<void> {
    this.erased.add(sessionId)
    await this.release(sessionId)
    deleteAudioEditTasks(`explanation:${sessionId}`)
  }
  private async identity(file: string): Promise<{ digest: string; bytes: number }> {
    const hash = crypto.createHash('sha256'); let bytes = 0
    for await (const chunk of createReadStream(file)) { const data = chunk as Buffer; hash.update(data); bytes += data.length }
    return { digest: `sha256:${hash.digest('hex')}`, bytes }
  }
  async archive(sessionId: string): Promise<{ path: string; digest: string; bytes: number }> {
    return this.serial(sessionId, () => this.archiveChunks(sessionId))
  }
  private async archiveChunks(sessionId: string): Promise<{ path: string; digest: string; bytes: number }> {
    if (this.erased.has(sessionId) || this.active.has(sessionId)) throw new Error('当前录音不能归档。')
    const directory = this.directory(sessionId); const file = path.join(directory, `recording-${crypto.randomUUID()}.zip`)
    const archive = new ZipArchive({ zlib: { level: 0 } }); const output = createWriteStream(file, { flags: 'wx' })
    try {
      const completed = new Promise<void>((resolve, reject) => { output.once('close', resolve); output.once('error', reject); archive.once('error', reject); archive.once('warning', reject) })
      archive.pipe(output)
      // Only immutable WAV chunks, no local paths or transcript/credentials in the archive.
      for (const entry of await fs.readdir(directory)) if (/^[0-9a-f-]{36}\.wav$/i.test(entry)) archive.file(path.join(directory, entry), { name: entry })
      await archive.finalize(); await completed
      if (this.erased.has(sessionId)) throw new Error('原录音已删除。')
      return { path: file, ...await this.identity(file) }
    } catch (error) { archive.abort(); output.destroy(); await fs.rm(file, { force: true }); throw error }
  }
  async restore(request: Extract<RecordingAudioRequest, { action: 'restore' }>): Promise<void> {
    return this.serial(request.sessionId, () => this.restoreChunks(request))
  }
  private async restoreChunks(request: Extract<RecordingAudioRequest, { action: 'restore' }>): Promise<void> {
    if (this.erased.has(request.sessionId) || this.active.has(request.sessionId)) throw new Error('原讲解不能恢复。')
    const identity = await this.identity(request.path)
    if (identity.digest !== request.digest || identity.bytes !== request.bytes) throw new Error('留存录音已修改，请恢复原文件。')
    const zip = await openZip(request.path)
    try {
      await fs.mkdir(this.directory(request.sessionId), { recursive: true })
      for await (const entry of iterateEntries(zip)) {
        // Per-entry size follows the 8 MiB PCM IPC budget; there is no session/chunk-count cap.
        if (!/^[0-9a-f-]{36}\.wav$/i.test(entry.fileName) || isSymbolicLinkEntry(entry) || entry.uncompressedSize > 4 * 1024 * 1024 + 44) throw new Error('留存录音条目无效。')
        const bytes = await readEntryBytes(zip, entry, '录音块'); if (this.erased.has(request.sessionId)) throw new Error('原录音已删除。')
        const file = this.file(request.sessionId, entry.fileName.slice(0,-4))
        try { await fs.writeFile(file, bytes, { flag: 'wx' }) } catch (error) { if (!(error && typeof error === 'object' && 'code' in error && error.code === 'EEXIST')) throw error; if (!(await fs.readFile(file)).equals(bytes)) throw new Error('恢复录音与当前录音不符。') }
      }
    } finally { zip.close() }
  }
  private async prepareRecording(request: Extract<RecordingAudioRequest, { action: 'transcribe' | 'preflight' }>) {
    if (this.erased.has(request.sessionId)) throw new Error('原录音已删除。')
    const audioPath = this.file(request.sessionId, request.chunkId)
    const handle = await fs.open(audioPath, 'r'); const header = Buffer.alloc(44)
    let bytes: number
    try { await handle.read(header, 0, 44, 0); bytes = (await handle.stat()).size } finally { await handle.close() }
    if (header.toString('ascii', 0, 4) !== 'RIFF' || header.toString('ascii', 8, 12) !== 'WAVE' || header.readUInt16LE(22) !== 1 || header.readUInt16LE(34) !== 16 || header.readUInt32LE(40) !== bytes - 44) throw new Error('录音块不完整，请恢复原录音。')
    const durationMs = (bytes - 44) / 2 * 1000 / header.readUInt32LE(24)
    const projectId = `explanation:${request.sessionId}`
    const identity = await this.identity(audioPath)
    const inputDigest = crypto.createHash('sha256').update(JSON.stringify([request.sessionId, request.chunkId, request.modelId, identity.digest, identity.bytes])).digest('hex')
    const existing = getAudioEditStoredTask(request.requestId)
    if (existing && (existing.document_id !== projectId || existing.input_digest !== inputDigest)) throw new Error('转写任务与录音不符。')
    if (existing && !(existing.state === 'completed' && existing.result_json) && (!request.resume || !existing.provider_task_id)) throw new Error('提交结果尚未确认，禁止重新发送收费请求。请核对原任务。')
    return { audioPath, durationMs, projectId, inputDigest, existing }
  }
  async preflight(request: Extract<RecordingAudioRequest, { action: 'preflight' }>): Promise<void> {
    if (this.active.has(request.sessionId)) throw new Error('这次讲解正在转写，请等待或取消。')
    const { audioPath, durationMs, existing } = await this.prepareRecording(request)
    if (existing?.state === 'completed' && existing.result_json) return
    if (existing?.provider_task_id) { this.asr.prepare({ modelId: request.modelId, audioPath, durationMs }); return }
    await this.asr.preflight({ modelId: request.modelId, sourcePath: audioPath, durationMs })
  }
  async transcribe(request: Extract<RecordingAudioRequest, { action: 'transcribe' }>): Promise<RecordingAudioResult> {
    if (this.active.has(request.sessionId)) throw new Error('这次讲解正在转写，请等待或取消。')
    const controller = new AbortController(); this.active.set(request.sessionId, controller)
    try { return await this.performTranscription(request, controller) } finally { this.active.delete(request.sessionId) }
  }
  private async performTranscription(request: Extract<RecordingAudioRequest, { action: 'transcribe' }>, controller: AbortController): Promise<RecordingAudioResult> {
    if (!request.audioUploadReceipt) throw new Error('请先确认音频外发与转写费用。')
    const { audioPath, durationMs, projectId, inputDigest, existing } = await this.prepareRecording(request)
    if (existing?.state === 'completed' && existing.result_json) return JSON.parse(existing.result_json) as RecordingAudioResult
    if (!existing) await this.asr.preflight({ modelId: request.modelId, sourcePath: audioPath, durationMs })
    const plan = this.asr.prepare({ modelId: request.modelId, audioPath, durationMs })
    controller.signal.throwIfAborted()
    if (this.erased.has(request.sessionId)) throw new Error('原录音已删除。')
    const release = registerAudioEditTaskController(request.requestId, projectId, controller)
    try {
      if (!existing) createAudioEditTask({ requestId: request.requestId, projectId, kind: 'explanation-transcription', inputDigest })
      updateAudioEditTask(request.requestId, { state: 'running' })
      const transcript = await this.asr.execute(plan, { requestId: request.requestId, signal: controller.signal, resumeTaskId: existing?.provider_task_id ?? undefined, onEvent: event => {
        // started.sessionId identifies the SDK session, not the provider's resumable job.
        const taskId = event.type === 'processing' ? event.taskId : undefined
        if (taskId) updateAudioEditTask(request.requestId, { state: 'running', providerTaskId: taskId })
      } })
      controller.signal.throwIfAborted()
      if (this.erased.has(request.sessionId)) throw new Error('原录音已删除。')
      const result = { transcript, modelId: plan.modelId, providerId: plan.providerId, requestId: request.requestId }
      updateAudioEditTask(request.requestId, { state: 'completed', result }); return result
    } catch {
      // SDK error messages can contain a transcript or URL. Never retain them in the task/log.
      if (!this.erased.has(request.sessionId)) updateAudioEditTask(request.requestId, { state: controller.signal.aborted ? 'cancelled' : 'failed', errorMessage: '讲解转写未完成，请查询原任务。' }); throw new Error('讲解转写未完成，请查询原任务。')
    } finally { release() }
  }
}
export const explanationAudioService = new ExplanationAudioService()
