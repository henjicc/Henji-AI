import fs from 'node:fs/promises'
import path from 'node:path'
import { decodePersistenceResource } from '../../../../src/core/persistence/resourceContracts'
import { RECORDING_TRACK_JOURNAL_FILE, RecordingTrackState, recordingTrackJournalLine, recordingTrackRecordSchema, type RecordingTrackOpenSegment, type RecordingTrackRecord } from '../../../../src/core/screenRecording/trackJournal'
import type { RecordingTrackKind, RecordingTracks, RecordingTrackSegment } from '../../../../src/core/screenRecording/tracks'
import { createMainLogger } from '../logging'
import { repairWavHeader } from './wav-file'
import { probeMediaDurationUs } from './capture/storage'

const logger = createMainLogger('main.screen_recording.tracks')

/**
 * 录制声音与摄像头轨道的权威状态在主进程：界面每封一段只报这一段，主进程追加一行到 tracks.journal。
 * 录制多久每次写入都一样小；界面进程重载或崩溃不影响已登记的内容，应用崩溃后重放这份记录即可。
 */
export class RecordingTrackLedger {
  readonly state: RecordingTrackState
  private handle: Promise<fs.FileHandle> | undefined
  private queue: Promise<void> = Promise.resolve()
  private failed = false
  maxWriteMs = 0
  detaches = 0
  constructor(private readonly directory: string, private readonly sessionId: string, private readonly originUs: number, kinds: readonly RecordingTrackKind[], private readonly cameraFps = 30) {
    this.state = new RecordingTrackState(kinds)
  }
  /** 记录先进内存再追加落盘；落盘失败只削弱崩溃恢复，不中断录制。 */
  record(raw: RecordingTrackRecord): Promise<void> {
    const record = recordingTrackRecordSchema.parse(raw)
    this.state.apply(record)
    if (record.type === 'detach') this.detaches++
    const line = recordingTrackJournalLine(this.sessionId, record)
    const task = this.queue.then(async () => {
      if (this.failed) return
      const started = performance.now()
      try {
        this.handle ??= fs.open(path.join(this.directory, RECORDING_TRACK_JOURNAL_FILE), 'a')
        const handle = await this.handle
        await handle.write(line); await handle.datasync()
      } catch (error) {
        this.failed = true
        logger.error('录制轨道恢复记录写入失败，录制继续', { event: 'recording.tracks.journal.failed', error })
      }
      this.maxWriteMs = Math.max(this.maxWriteMs, performance.now() - started)
    })
    this.queue = task
    return task
  }
  /** 收尾：补出界面来不及封口的分段，关闭记录文件。 */
  async finish(): Promise<RecordingTracks> {
    await this.queue
    await settleUnsealed(this.directory, this.state, this.cameraFps)
    const handle = this.handle; this.handle = undefined
    await handle?.then(value => value.close()).catch(() => undefined)
    return this.state.tracks(this.sessionId, this.originUs)
  }
}

/** 重放崩溃前的记录；没有记录（旧版本录制）返回 null，由调用方沿用文档里的轨道。 */
export async function replayTrackJournal(directory: string, sessionId: string, originUs: number, kinds: readonly RecordingTrackKind[], cameraFps = 30): Promise<RecordingTracks | null> {
  let text: string
  try { text = await fs.readFile(path.join(directory, RECORDING_TRACK_JOURNAL_FILE), 'utf8') } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
  const state = new RecordingTrackState(kinds)
  const lines = text.split('\n')
  for (const [index, line] of lines.entries()) {
    if (!line.trim()) continue
    let parsed
    try { parsed = decodePersistenceResource('screen-recording-track-journal', JSON.parse(line)) } catch (error) {
      // 更新版本写的记录不能按旧理解拼：整次恢复交给新版本做。
      if ((error as { code?: string }).code === 'newer-version') throw error
      // 最后一行可能是写到一半的半行；中间某行坏了只丢这一条（最多少一段声音），其余照常恢复。
      logger.warn('丢弃读不懂的轨道记录', { event: 'recording.tracks.journal.bad_line', error, context: { line: index + 1, last: lines.slice(index + 1).every(rest => !rest.trim()) } })
      continue
    }
    if (parsed.sessionId !== sessionId) throw new Error('轨道恢复记录不属于该录制')
    try { state.apply(parsed.record) } catch (error) { logger.warn('丢弃与这次录制轨道对不上的记录', { event: 'recording.tracks.journal.bad_line', error, context: { line: index + 1 } }) }
  }
  await settleUnsealed(directory, state, cameraFps)
  return state.tracks(sessionId, originUs)
}

async function settleUnsealed(directory: string, state: RecordingTrackState, cameraFps: number): Promise<void> {
  for (const { kind, segment } of state.unsealed()) {
    const repaired = await repairSegment(directory, kind, segment, cameraFps).catch(error => { logger.warn('未封口的录制分段无法补回', { event: 'recording.tracks.repair.failed', error, context: { kind } }); return null })
    if (repaired) state.apply({ type: 'seal', kind, segment: repaired })
    else state.discard(segment.id)
  }
}

/** 界面进程退出时正在写的那一段：按文件里实际写到的采样补出长度，没有采样就放弃。 */
export async function repairSegment(directory: string, kind: RecordingTrackKind, open: RecordingTrackOpenSegment, cameraFps = 30): Promise<RecordingTrackSegment | null> {
  const file = path.join(directory, open.file)
  let units: number, durationUs: number
  if (kind === 'camera') {
    durationUs = await probeMediaDurationUs(file)
    units = Math.max(1, Math.round(durationUs * cameraFps / 1_000_000))
  } else {
    const { layout, frames } = await repairWavHeader(file)
    units = frames; durationUs = Math.round(frames * 1_000_000 / layout.sampleRate)
  }
  if (!units || durationUs <= 0) return null
  const { monoStartUs, anchor, ...rest } = open
  const end = monoStartUs + durationUs
  logger.info('补回未封口的录制分段', { event: 'recording.tracks.repair.completed', context: { kind, durationUs } })
  return { ...rest, monoSpanUs: [monoStartUs, end], units, anchors: [anchor, { ...anchor, monoUs: end, ...(anchor.audioSample !== undefined ? { audioSample: units } : {}) }] }
}
