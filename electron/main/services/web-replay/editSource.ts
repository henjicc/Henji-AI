import crypto from 'node:crypto'
import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import { CaptureLogCollector } from '../../../../src/core/captureLog/collector'
import type { CaptureEvent, CaptureLogPage } from '../../../../src/core/captureLog/events'
import { recordingCursorPageReference } from '../../../../src/core/videoEdit/recordingCursor'
import { projectWebRecordingEvents, webRecordingBackupTimingSchema, type WebRecordingVideoClock } from '../../../../src/core/webReplay/videoEvents'
import { WEB_RECORDING_FILES } from '../../../../src/core/webReplay/schema'
import type { WebRecordingEditSource } from '../../../../src/platform/contracts/webReplay'
import { createMainLogger } from '../logging'
import { RecordingEventStore } from '../screen-recording/event-store'
import { loadFfprobePath } from '../video/ffmpeg-loader'
import { BACKUP_TIMING_FILE, BACKUP_VIDEO_FILE } from './backupVideo'
import { resolveWebRecordingLocation } from './locations'
import { WebRecordingStore } from './store'
import { isCleanReplayName, newestReplayName } from '../../../../src/core/webReplay/replayVideos'
import { readWebReplayTake, readWebReplayTakeBehavior, TAKE_FILES } from './takes'

const logger = createMainLogger('main.web_replay.edit_source')
/** Pages projected for one video live beside it: `edit-events/<video name>/`. Pages are immutable and reused. */
const EDIT_EVENTS_DIRECTORY = 'edit-events'
/** Bumped when the projection itself changes (v2: a still pointer is held between moves), so cached pages are rebuilt. */
const PROJECTION_VERSION = 2

async function probeVideo(file: string): Promise<{ width: number; height: number; durationUs: number }> {
  const ffprobe = await loadFfprobePath()
  const text = await new Promise<string>((resolve, reject) => execFile(ffprobe, ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height:format=duration', '-of', 'json', file], { windowsHide: true }, (error, stdout) => (error ? reject(error) : resolve(stdout))))
  const parsed = JSON.parse(text) as { streams?: Array<{ width?: number; height?: number }>; format?: { duration?: string } }
  const stream = parsed.streams?.[0]
  const duration = Number(parsed.format?.duration)
  if (!stream?.width || !stream.height || !Number.isFinite(duration)) throw new Error('读不出这段视频的尺寸和时长')
  return { width: stream.width, height: stream.height, durationUs: Math.round(duration * 1e6) }
}

/** 干净画面的重演优先；只有画了鼠标的重演时用它（鼠标已在画面里，只补点击）。 */
async function newestReplay(directory: string): Promise<string | null> {
  const names = await fs.readdir(directory).catch(() => [] as string[])
  const name = newestReplayName(names, { clean: true }) ?? newestReplayName(names)
  return name ? path.join(directory, name) : null
}

async function readPages(directory: string): Promise<CaptureLogPage[]> {
  const pages: CaptureLogPage[] = []
  for await (const page of new RecordingEventStore(directory).recover()) pages.push(page)
  return pages
}

/**
 * The video a web recording brings into an edit, with its behavior track projected onto that video's clock and pixels
 * as capture-log pages, so the clip gets the existing redrawn pointer and click zoom. Newest clean replay first (no pointer
 * in the picture: the pointer is redrawn), then a replay rendered with the pointer, then the backup screen recording
 * (for both of those the pointer is already in the picture: only clicks are drawn). With `take`, that take's video and its
 * own behavior track (already on the take's clock) instead.
 */
export async function webRecordingEditSource(recordingId: string, prefer: 'replay' | 'backup' | 'auto' = 'auto', takeName?: string): Promise<WebRecordingEditSource> {
  const { directory: recordingDirectory } = await resolveWebRecordingLocation(recordingId)
  const store = new WebRecordingStore(recordingDirectory)
  const manifest = await store.readManifest()
  if (manifest.status === 'recording') throw new Error('这段网页录制还在进行，请先停止')
  const take = takeName ? await readWebReplayTake(recordingDirectory, takeName) : null
  if (take && !take.videoPath) throw new Error(`版本“${take.name}”只出了轨道没有视频，请不带 textOnly 重新按导演稿重演`)
  // Pages projected for a take live in the take's own folder.
  const directory = take?.directory ?? recordingDirectory
  const replay = take ? take.videoPath : await newestReplay(directory)
  const backupPath = path.join(recordingDirectory, BACKUP_VIDEO_FILE)
  const backup = take ? null : await fs.access(backupPath).then(() => backupPath, () => null)
  const kind = prefer === 'backup' && !take ? (backup ? 'backup' : null) : prefer === 'replay' || take ? (replay ? 'replay' : null) : replay ? 'replay' : backup ? 'backup' : null
  if (!kind) throw new Error(prefer === 'auto' ? '这段网页录制还没有视频：请先重演出视频，或在录制时开启备份录屏' : prefer === 'replay' ? '这段网页录制还没有重演视频，请先重演出视频' : '这段网页录制没有备份录屏')
  const video = kind === 'replay' ? replay! : backup!
  const frame = await probeVideo(video)
  const warnings: string[] = []
  const pointerInPicture = kind === 'backup' || (take ? take.pointer : !isCleanReplayName(path.basename(video)))
  if (kind === 'replay' && pointerInPicture) warnings.push('这段重演视频里已经画了鼠标，只补点击效果；想在剪辑里重画鼠标，先用 render_web_app_replay（pointer=false）重演出干净画面')
  let clock: WebRecordingVideoClock | null = { kind: 'replay' }
  if (kind === 'backup') {
    const timing = await fs.readFile(path.join(directory, BACKUP_TIMING_FILE), 'utf8').then(text => webRecordingBackupTimingSchema.parse(JSON.parse(text)), () => null)
    clock = manifest.clock && timing ? { kind: 'backup', monoAtZeroUs: manifest.clock.monoAtZeroUs, timing } : null
    if (!clock) warnings.push('备份录屏缺少和录制对齐的时钟，鼠标效果与自动缩放没有加上')
  }
  const behavior = take ? await readWebReplayTakeBehavior(take.directory) : await store.readBehavior()
  const projected = clock ? projectWebRecordingEvents(manifest, behavior, clock, frame) : []
  if (clock && projected.length && !projected.some(event => event.payload.kind === 'cursor')) warnings.push('视频画面和网页尺寸对不上（可能录的是整个屏幕），没能画回鼠标位置')
  const base = { video, kind, width: frame.width, height: frame.height, durationUs: frame.durationUs, title: take ? `${manifest.title ?? manifest.app.name} · ${take.name}` : manifest.title ?? null, warnings, ...(take ? { take: take.name } : {}) } as const
  if (!projected.some(event => event.payload.kind === 'cursor' || event.payload.kind === 'click')) return { ...base, cursor: null, events: [] }

  const behaviorBytes = await fs.readFile(path.join(directory, take ? TAKE_FILES.behavior : WEB_RECORDING_FILES.behavior))
  const digest = crypto.createHash('sha256').update(behaviorBytes).update(`\0${path.basename(video)}\0${frame.width}x${frame.height}\0${JSON.stringify(clock)}\0projection-v${PROJECTION_VERSION}`).digest('hex')
  const ownerRef = { kind: 'screen_recording.web_recording', id: manifest.id }
  const sourceDigest = `sha256:${digest}`
  const pagesDirectory = path.join(directory, EDIT_EVENTS_DIRECTORY, `${path.basename(video, '.mp4')}-${digest.slice(0, 12)}`)
  let pages = await readPages(pagesDirectory).catch(() => [] as CaptureLogPage[])
  if (!pages.length || pages[0].sourceDigest !== sourceDigest) {
    await fs.rm(pagesDirectory, { recursive: true, force: true })
    await fs.mkdir(pagesDirectory, { recursive: true })
    const eventStore = new RecordingEventStore(pagesDirectory)
    let sequence = 0
    // Deterministic ids: the same recording and video always give the same pages, so edits keep matching hashes.
    const collector = new CaptureLogCollector({ ownerRef, sourceDigest, originUs: 0, id: () => `e${sequence++}` }, async page => { await eventStore.write(page) }, error => logger.warn('网页录制事件页写入积压', { event: 'web_replay.edit_source.pressure', error: String(error) }))
    collector.start(0)
    for (const event of projected) collector.record(event.videoUs, event.payload)
    await collector.stop(frame.durationUs)
    pages = await readPages(pagesDirectory)
    logger.info('网页录制已投影成剪辑事件', { event: 'web_replay.edit_source.projected', context: { recordingId, kind, events: projected.length, pages: pages.length } })
  }
  const names = (await fs.readdir(pagesDirectory)).filter(name => /^\d{16}-[a-f0-9]{64}\.capture\.json$/.test(name)).sort()
  if (names.length !== pages.length) throw new Error('网页录制的事件页不完整，请重试')
  const events: CaptureEvent[] = pages.flatMap(page => page.entries.filter(entry => entry.kind === 'click' || entry.kind === 'key'))
  return {
    ...base,
    cursor: {
      ownerRef, sourceDigest, cursorBakedIn: pointerInPicture, recordingStartUs: 0, width: frame.width, height: frame.height,
      pages: pages.map((page, index) => recordingCursorPageReference(page, path.join(pagesDirectory, names[index]), names[index].slice(17, 81))),
    },
    events,
  }
}
