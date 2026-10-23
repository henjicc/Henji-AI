import fs from 'node:fs/promises'
import path from 'node:path'
import { audioEditProjectFromDocument, isEmptyAudioEditSource } from '../../../../src/core/audioEdit/documentContent'
import type { AudioEditSpliceRequest, AudioEditSpliceResult } from '../../../../src/core/audioEdit/splice'
import { videoEditRecordingGainDb } from '../../../../src/core/videoEdit/loudness'
import { measureAudioFileLoudness } from '../audio/loudness'
import { getUserRootDir } from '../appPaths'
import { getDocumentService } from '../documents/runtime'
import { resolveLocalMediaPath } from '../media/shared'
import { loadFfmpegPath } from '../video/ffmpeg-loader'
import { probeAudioEditSource, verifyAudioEditSource } from './media'
import { runAudioEditProcess } from './process'
import { registerOwnedMedia, enqueueMediaCandidates } from '../media-recycle/queue'
import { runAudioEditTask } from './task-store'

export function audioSpliceOutputPath(requestId: string): string { return path.join(getUserRootDir(), '录音', `${requestId}.wav`) }

/** 分段顺序解码后用 FFmpeg concat 顺序复制，避免 asplit 等待后半段时缓存整段 PCM。 */
export async function spliceAudioFile(request: AudioEditSpliceRequest): Promise<AudioEditSpliceResult> {
  const read = await getDocumentService().readDocument({ id: request.projectId })
  if (read.meta.kind !== 'audio_edit') throw new Error('请选择音频作品')
  const project = audioEditProjectFromDocument(read.meta, read.content, true).project
  if (request.endFrame > project.source.durationFrames) throw new Error('录音位置已超出作品，请重新选择')
  return runAudioEditTask(project.id, 'splice', async (signal, progress) => {
    const input = await resolveLocalMediaPath(request.sourcePath)
    const take = await probeAudioEditSource(input, signal)
    const empty = isEmptyAudioEditSource(project.source)
    if (!empty) await verifyAudioEditSource(project, true, signal)
    const rate = empty ? take.sampleRate : project.source.sampleRate
    const channels = empty ? take.channels : project.source.channels
    const insertedFrames = Math.min(Math.round(take.durationFrames * rate / take.sampleRate), request.endFrame > request.startFrame ? request.endFrame - request.startFrame : Number.MAX_SAFE_INTEGER)
    if (insertedFrames < 1) throw new Error('这段录音没有可用声音')
    const output = audioSpliceOutputPath(request.resultId ?? request.requestId)
    // 测量最终拼入的区间（包含重采样和覆盖裁切），重试也沿同一入口；静音、短录音不创建增益区。
    const recordingGain = async (): Promise<{ recordingGainDb?: number }> => {
      if (!request.matchRecordingLoudness || insertedFrames / rate < .4) return {}
      const measured = await measureAudioFileLoudness(output, request.startFrame, insertedFrames, rate, signal)
      const gainDb = videoEditRecordingGainDb(0, measured)
      return gainDb === 0 ? {} : { recordingGainDb: gainDb }
    }
    // 上次已完成独占发布但尚未提交文档：复用完整产物，仍校验实际帧数。
    try {
      await fs.access(output)
      const saved = await probeAudioEditSource(output, signal)
      if (saved.durationFrames !== project.source.durationFrames - (request.endFrame - request.startFrame) + insertedFrames || saved.sampleRate !== rate || saved.channels !== channels) throw new Error('已有拼接结果与原作品不匹配')
      return { source: { ...saved, ownership: 'managed' as const }, insertedFrames, ...await recordingGain() }
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    const directory = path.dirname(output)
    await fs.mkdir(directory, { recursive: true })
    const temporary = await fs.mkdtemp(path.join(directory, '.splice-'))
    const ffmpeg = await loadFfmpegPath()
    const segments: Array<{ file: string; start: number; frames: number; rate: number }> = []
    if (request.startFrame) segments.push({ file: project.source.sourcePath, start: 0, frames: request.startFrame, rate })
    segments.push({ file: input, start: 0, frames: insertedFrames, rate })
    if (request.endFrame < project.source.durationFrames) segments.push({ file: project.source.sourcePath, start: request.endFrame, frames: project.source.durationFrames - request.endFrame, rate })
    try {
      for (const [index, segment] of segments.entries()) {
        await runAudioEditProcess(ffmpeg, ['-v', 'error', '-nostdin', '-i', segment.file, '-map', '0:a:0', '-vn', '-af', `aresample=${rate},atrim=start_sample=${segment.start}:end_sample=${segment.start + segment.frames},asetpts=PTS-STARTPTS`, '-ac', String(channels), '-c:a', 'pcm_f32le', '-rf64', 'auto', '-progress', 'pipe:2', path.join(temporary, `${index}.wav`)], signal, line => {
          if (line.startsWith('out_time_us=')) progress((index + Math.min(1, Number(line.slice(12)) / 1e6 * rate / segment.frames)) / (segments.length + 1))
        })
      }
      const list = path.join(temporary, 'segments.txt')
      await fs.writeFile(list, segments.map((_, index) => `file '${index}.wav'`).join('\n'), 'utf8')
      const resultPath = path.join(temporary, 'result.wav')
      await runAudioEditProcess(ffmpeg, ['-v', 'error', '-nostdin', '-f', 'concat', '-safe', '1', '-i', list, '-c:a', 'copy', '-rf64', 'auto', resultPath], signal)
      const source = await probeAudioEditSource(resultPath, signal)
      const expected = project.source.durationFrames - (request.endFrame - request.startFrame) + insertedFrames
      if (source.durationFrames !== expected) throw new Error('拼接音频长度不匹配，原作品未修改')
      const handle = await fs.open(resultPath, 'r+')
      try { await handle.sync() } finally { await handle.close() }
      signal.throwIfAborted()
      // 独占发布，不能覆盖已有结果或用户文件。失败时原录音仍留在恢复登记中。
      await fs.link(resultPath, output)
      await registerOwnedMedia(output)
      enqueueMediaCandidates([output])
      progress(1)
      return { source: { ...source, sourcePath: output, audioPath: output, ownership: 'managed' as const }, insertedFrames, ...await recordingGain() }
    } finally { await fs.rm(temporary, { recursive: true, force: true }) }
  }, request.requestId, JSON.stringify([project.source, request.startFrame, request.endFrame, request.sourcePath, request.matchRecordingLoudness]))
}
