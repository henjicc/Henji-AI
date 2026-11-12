import fs from 'node:fs/promises'
import path from 'node:path'
import { audioEditProjectFromDocument, isEmptyAudioEditSource } from '../../../../src/core/audioEdit/documentContent'
import type { AudioEditSpliceRequest, AudioEditSpliceResult } from '../../../../src/core/audioEdit/splice'
import type { AudioEditProjectDocument, AudioEditSourceIdentity, AudioEditSourceMetadata } from '../../../../src/core/audioEdit/types'
import { videoEditRecordingGainDb } from '../../../../src/core/videoEdit/loudness'
import { measureAudioFileLoudness } from '../audio/loudness'
import { recordAudioLineage } from '../audio/lineage'
import { getUserAudioRecordingsDir } from '../appPaths'
import { getDocumentService } from '../documents/runtime'
import { createMainLogger } from '../logging'
import { resolveLocalMediaPath } from '../media/shared'
import { loadFfmpegPath } from '../video/ffmpeg-loader'
import { runAudioEditEffectsWorker } from './effects-worker-client'
import { audioEditCacheDirectory, prepareAudioEditAudio, probeAudioEditSource, verifyAudioEditSource } from './media'
import { openF32Wav } from './pcm-wav'
import { runAudioEditProcess } from './process'
import { audioEditSoundSourceKey } from './render'
import { digestWholeAudioEditSource } from './source-identity'
import type { AudioEditConcatResult } from './pcm-jobs'
import { recordAudioEditSourceSplice } from './source-splices'
import { registerOwnedMedia, enqueueMediaCandidates } from '../media-recycle/queue'
import { runAudioEditTask } from './task-store'

const logger = createMainLogger('main.audio_edit')

function audioSpliceOutputPath(requestId: string): string { return path.join(getUserAudioRecordingsDir(), `${requestId}.wav`) }

/** 已发布拼接结果的文件头：帧数、采样率、声道与预期一致才可复用。 */
async function f32Layout(file: string): Promise<{ frames: number; sampleRate: number; channels: number } | null> {
  const reader = await openF32Wav(file)
  await reader?.close()
  return reader && { frames: reader.frames, sampleRate: reader.sampleRate, channels: reader.channels }
}

/**
 * 拼接结果的素材信息：帧数是已知量，不用探测。身份是整文件 SHA-256（写出时顺带算出），覆盖全部内容：
 * 等长覆盖一句话、被替换段没碰到任何采样块时，采样指纹会与覆盖前相同，整文件摘要不会。
 */
function splicedSource(output: string, sampleRate: number, channels: number, durationFrames: number, identity: AudioEditSourceIdentity): AudioEditSourceMetadata {
  return { mediaType: 'audio', sourcePath: output, audioPath: output, ownership: 'managed', sampleRate, channels, durationFrames, audioStreamIndex: 0, audioStartSeconds: 0, identity }
}

/** 原素材的浮点 PCM：自管素材是它本身，外部素材用浮点副本；自管素材不是同规格浮点 WAV 时（罕见）转一份到临时目录。 */
async function f32Base(project: AudioEditProjectDocument, temporary: string, signal: AbortSignal): Promise<string> {
  const base = await prepareAudioEditAudio(project, signal)
  const layout = await f32Layout(base).catch(() => null)
  if (layout?.sampleRate === project.source.sampleRate && layout.channels === project.source.channels && layout.frames >= project.source.durationFrames) return base
  const converted = path.join(temporary, 'base.wav')
  await runAudioEditProcess(await loadFfmpegPath(), ['-v', 'error', '-nostdin', '-i', base, '-map', '0:a:0', '-vn', '-af', `asetpts=N/SR/TB,atrim=end_sample=${project.source.durationFrames},apad=whole_len=${project.source.durationFrames}`,
    '-ac', String(project.source.channels), '-ar', String(project.source.sampleRate), '-c:a', 'pcm_f32le', '-rf64', 'auto', converted], signal)
  return converted
}

/**
 * 补录拼接：新素材 = 原素材 [0, start) + 录音 + 原素材 [end, 结尾)。原素材的样本按字节原样复制（不解码、不重采样），
 * 录音由 FFmpeg 解码成同规格后裁到 inserted 帧，一遍写出并顺带算出整文件摘要。帧数是已知量，读回文件头核对即可，不整段探测，也不额外读一遍算哈希。
 * 结果记来历（拼接点之前与原素材相同；长度不变时后段也原位相同）与“声音来源拼接”，波形、频谱、编辑后声音据此只重算拼接点附近。
 */
export async function spliceAudioFile(request: AudioEditSpliceRequest): Promise<AudioEditSpliceResult> {
  const read = await getDocumentService().readDocument({ id: request.projectId })
  if (read.meta.kind !== 'audio_edit') throw new Error('请选择音频作品')
  const project = audioEditProjectFromDocument(read.meta, read.content, true).project
  if (request.endFrame > project.source.durationFrames) throw new Error('录音位置已超出作品，请重新选择')
  return runAudioEditTask(project.id, 'splice', async (signal, progress) => {
    const started = performance.now()
    const input = await resolveLocalMediaPath(request.sourcePath)
    const take = await probeAudioEditSource(input, signal)
    const empty = isEmptyAudioEditSource(project.source)
    if (!empty) await verifyAudioEditSource(project, signal)
    const verifyMs = performance.now() - started
    const rate = empty ? take.sampleRate : project.source.sampleRate
    const channels = empty ? take.channels : project.source.channels
    const insertedFrames = Math.min(Math.round(take.durationFrames * rate / take.sampleRate), request.endFrame > request.startFrame ? request.endFrame - request.startFrame : Number.MAX_SAFE_INTEGER)
    if (insertedFrames < 1) throw new Error('这段录音没有可用声音')
    const sourceFrames = empty ? 0 : project.source.durationFrames
    const durationFrames = sourceFrames - (request.endFrame - request.startFrame) + insertedFrames
    const output = audioSpliceOutputPath(request.resultId ?? request.requestId)
    // 测量最终拼入的区间（包含重采样和覆盖裁切），重试也沿同一入口；静音、短录音不创建增益区。
    // 刚写出时量解码好的录音本身（与结果里这一段逐样本相同），不必从头读整条结果；复用已发布的结果时才量结果里的这一段。
    const recordingGain = async (file = output, startFrame = request.startFrame): Promise<{ recordingGainDb?: number }> => {
      if (!request.matchRecordingLoudness || insertedFrames / rate < .4) return {}
      const measured = await measureAudioFileLoudness(file, startFrame, insertedFrames, rate, signal)
      const gainDb = videoEditRecordingGainDb(0, measured)
      return gainDb === 0 ? {} : { recordingGainDb: gainDb }
    }
    // 上次已完成独占发布但尚未提交文档（崩溃恢复）：复用完整产物，核对文件头里的帧数与规格，整文件读一遍算身份。
    try {
      await fs.access(output)
      const saved = await f32Layout(output)
      if (saved?.frames !== durationFrames || saved.sampleRate !== rate || saved.channels !== channels) throw new Error('已有拼接结果与原作品不匹配')
      return { source: splicedSource(output, rate, channels, durationFrames, await digestWholeAudioEditSource(output, signal)), insertedFrames, ...await recordingGain() }
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    const directory = path.dirname(output)
    await fs.mkdir(directory, { recursive: true })
    const temporary = await fs.mkdtemp(path.join(directory, '.splice-'))
    try {
      const takeStarted = performance.now()
      const takePath = path.join(temporary, 'take.wav')
      // 先按样本序号重排时间戳再裁剪：起点不在 0 的录音（mp3 编码延迟等）也从解码出的第一个样本算起。
      await runAudioEditProcess(await loadFfmpegPath(), ['-v', 'error', '-nostdin', '-i', input, '-map', '0:a:0', '-vn',
        '-af', `aresample=${rate},asetpts=N/SR/TB,atrim=end_sample=${insertedFrames},apad=whole_len=${insertedFrames}`,
        '-ac', String(channels), '-c:a', 'pcm_f32le', '-rf64', 'auto', '-progress', 'pipe:2', takePath], signal, line => {
        if (line.startsWith('out_time_us=')) progress(Math.min(1, Number(line.slice(12)) / 1e6 * rate / insertedFrames) * 0.1)
      })
      const takeMs = performance.now() - takeStarted
      const base = empty ? undefined : await f32Base(project, temporary, signal)
      const writeStarted = performance.now()
      const resultPath = path.join(temporary, 'result.wav')
      const { startFrame, endFrame } = request
      const written = await runAudioEditEffectsWorker({ kind: 'concat', output: resultPath, sampleRate: rate, channels, pieces: [
        ...(base && startFrame > 0 ? [{ input: base, startFrame: 0, frames: startFrame }] : []),
        { input: takePath, startFrame: 0, frames: insertedFrames },
        ...(base && endFrame < sourceFrames ? [{ input: base, startFrame: endFrame, frames: sourceFrames - endFrame }] : []),
      ] }, signal, value => progress(0.1 + value * 0.85)) as AudioEditConcatResult | undefined
      const layout = await f32Layout(resultPath)
      if (!written?.digest || layout?.frames !== durationFrames || layout.sampleRate !== rate || layout.channels !== channels) throw new Error('拼接音频长度不匹配，原作品未修改')
      const handle = await fs.open(resultPath, 'r+')
      try { await handle.sync() } finally { await handle.close() }
      const writeMs = performance.now() - writeStarted
      signal.throwIfAborted()
      const { size, mtimeMs } = await fs.stat(resultPath)
      const identity: AudioEditSourceIdentity = { size, mtimeMs, digest: written.digest }
      // 独占发布，不能覆盖已有结果或用户文件。失败时原录音仍留在恢复登记中。
      await fs.link(resultPath, output)
      await registerOwnedMedia(output)
      enqueueMediaCandidates([output])
      const source = splicedSource(output, rate, channels, durationFrames, identity)
      if (base) {
        // 长度不变时被替换段之后原位相同；长度变了后段平移，只有拼接点之前能按位置沿用。临时转出来的底声随后删掉，不当来历。
        const delta = insertedFrames - (endFrame - startFrame)
        if (path.dirname(base) !== temporary) await recordAudioLineage(output, durationFrames, { file: base, frames: sourceFrames, dirty: [[startFrame, delta === 0 ? startFrame + insertedFrames : durationFrames]] }, { central: true })
        else await recordAudioLineage(output, durationFrames, undefined, { central: true })
        await recordAudioEditSourceSplice(audioEditCacheDirectory(project.id), {
          from: await audioEditSoundSourceKey(project, signal), to: await audioEditSoundSourceKey({ ...project, source }, signal), start: startFrame, end: endFrame, inserted: insertedFrames,
        })
      } else await recordAudioLineage(output, durationFrames, undefined, { central: true })
      progress(1)
      logger.info('补录拼接已写出', { event: 'audio_edit.source.splice.completed', requestId: request.requestId, context: {
        projectId: project.id, mode: empty ? 'new' : 'splice', startFrame, endFrame, insertedFrames, sourceFrames, durationFrames, durationSeconds: durationFrames / rate,
        bytes: size, verifyMs, takeMs, writeMs, elapsedMs: performance.now() - started,
      } })
      return { source, insertedFrames, ...await recordingGain(takePath, 0) }
    } finally {
      // media-recycle-allow: this splice's private .splice- staging dir; the published output is a separate hard link.
      await fs.rm(temporary, { recursive: true, force: true })
    }
  }, request.requestId, JSON.stringify([project.source, request.startFrame, request.endFrame, request.sourcePath, request.matchRecordingLoudness]))
}
