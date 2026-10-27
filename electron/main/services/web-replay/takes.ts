import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'
import { parseWebReplayDirector, webReplayTakeNameSchema, type WebReplayDirector } from '../../../../src/core/webReplay/director'
import { webRecordingBehaviorSchema, type WebRecordingBehaviorEvent } from '../../../../src/core/webReplay/schema'
import { createMainLogger } from '../logging'
import { WebRecordingPlayer, type ReplayOptions, type ReplayResult } from './player/player'
import { BOX_TRACK_FILE } from './boxTrack'
import { TEXT_TRACK_FILE } from './textTrack'

const logger = createMainLogger('main.web_replay.takes')

/**
 * 版本（take）：按导演稿重演出的一份成片素材，放在录制文件夹的 takes/<名字>/ 里，录制本身不动。
 * 视频、位置轨、文字轨与行为轨都在版本自己的输出时间上；timemap.json 对照输出时间与录制时间；director.json 是
 * 生成它的导演稿（登记的持久格式，可据此重新生成整个版本）。位置轨与文字轨与录制的同名，项目里读轨道的脚本照样能读。
 */
export const TAKES_DIRECTORY = 'takes'
export const TAKE_FILES = { video: 'video.mp4', boxes: BOX_TRACK_FILE, text: TEXT_TRACK_FILE, behavior: 'behavior.json', timeMap: 'timemap.json', director: 'director.json', manifest: 'take.json' } as const

export const webReplayTakeManifestSchema = z.object({
  version: z.literal(1),
  name: z.string(),
  recordingId: z.string(),
  createdAt: z.string(),
  fps: z.number().positive(),
  width: z.number().int().nonnegative(),
  height: z.number().int().nonnegative(),
  frames: z.number().int().nonnegative(),
  durationUs: z.number().int().nonnegative(),
  /** 鼠标画进了画面；false 是干净画面（导入剪辑时重画鼠标）。 */
  pointer: z.boolean(),
  /** 有没有视频（只出轨道时没有）。 */
  video: z.boolean(),
  conflicts: z.number().int().nonnegative(),
  warnings: z.number().int().nonnegative(),
}).strict()
export type WebReplayTakeManifest = z.infer<typeof webReplayTakeManifestSchema>

export interface WebReplayTakeSummary extends WebReplayTakeManifest { directory: string; videoPath: string | null }

export function takeDirectory(recordingDirectory: string, name: string): string {
  const parsed = webReplayTakeNameSchema.safeParse(name)
  if (!parsed.success) throw new Error(`版本名不对：${parsed.error.issues[0]?.message ?? name}`)
  return path.join(recordingDirectory, TAKES_DIRECTORY, parsed.data)
}

async function readTakeManifest(directory: string): Promise<WebReplayTakeManifest> {
  return webReplayTakeManifestSchema.parse(JSON.parse(await fs.readFile(path.join(directory, TAKE_FILES.manifest), 'utf8')))
}

/** 录制下的全部版本，新的在前；读不了的跳过并记日志（可以按它的 director.json 重新生成）。 */
export async function listWebReplayTakes(recordingDirectory: string): Promise<WebReplayTakeSummary[]> {
  const root = path.join(recordingDirectory, TAKES_DIRECTORY)
  const names = (await fs.readdir(root, { withFileTypes: true }).catch(() => [])).filter(entry => entry.isDirectory() && !entry.name.startsWith('.')).map(entry => entry.name)
  const takes = await Promise.all(names.map(async name => {
    const directory = path.join(root, name)
    try {
      const manifest = await readTakeManifest(directory)
      return { ...manifest, directory, videoPath: manifest.video ? path.join(directory, TAKE_FILES.video) : null }
    } catch (error) {
      logger.warn('网页重演版本无法读取', { event: 'web_replay.take.unreadable', context: { directory }, error: String(error) })
      return null
    }
  }))
  return takes.filter((take): take is WebReplayTakeSummary => take !== null).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

export async function readWebReplayTake(recordingDirectory: string, name: string): Promise<WebReplayTakeSummary> {
  const directory = takeDirectory(recordingDirectory, name)
  const manifest = await readTakeManifest(directory).catch(error => {
    throw new Error((error as NodeJS.ErrnoException)?.code === 'ENOENT' ? `这段录制没有叫“${name}”的版本，先用导演稿重演出这个版本` : `版本“${name}”读不出来：${String(error)}`)
  })
  return { ...manifest, directory, videoPath: manifest.video ? path.join(directory, TAKE_FILES.video) : null }
}

export async function readWebReplayTakeBehavior(directory: string): Promise<WebRecordingBehaviorEvent[]> {
  return webRecordingBehaviorSchema.parse(JSON.parse(await fs.readFile(path.join(directory, TAKE_FILES.behavior), 'utf8'))).events
}

export async function readWebReplayTakeDirector(directory: string): Promise<WebReplayDirector> {
  return parseWebReplayDirector(JSON.parse(await fs.readFile(path.join(directory, TAKE_FILES.director), 'utf8')))
}

export interface WebReplayTakeRequest {
  recordingId: string
  name: string
  director: WebReplayDirector
  fps?: number
  pointer: boolean
  longEdge?: number
  textOnly?: boolean
  boxSelectors?: string[]
  signal?: AbortSignal
  onFrame?: ReplayOptions['onFrame']
}

/**
 * 按导演稿重演出一个版本：先写进 takes/ 下的暂存文件夹，全部写完再换上（同名的旧版本这时才被替换）；
 * 失败或取消时暂存文件夹删掉，旧版本原样保留。
 */
export async function renderWebReplayTake(recordingDirectory: string, request: WebReplayTakeRequest): Promise<{ result: ReplayResult; take: WebReplayTakeSummary }> {
  const final = takeDirectory(recordingDirectory, request.name)
  const root = path.dirname(final)
  await fs.mkdir(root, { recursive: true })
  const staging = path.join(root, `.${path.basename(final)}.${crypto.randomUUID()}.tmp`)
  await fs.mkdir(staging)
  const video = request.textOnly !== true
  try {
    const result = await WebRecordingPlayer.open(recordingDirectory).render({
      output: path.join(staging, video ? TAKE_FILES.video : TAKE_FILES.text), fps: request.fps, pointer: request.pointer, longEdge: request.longEdge, video,
      textTrack: path.join(staging, TAKE_FILES.text), boxTrack: path.join(staging, TAKE_FILES.boxes), boxSelectors: request.boxSelectors,
      director: request.director, signal: request.signal, onFrame: request.onFrame,
    })
    if (!result.takeTracks) throw new Error('重演没有交回版本的轨道')
    const behavior = webRecordingBehaviorSchema.parse({ events: result.takeTracks.behavior })
    const manifest: WebReplayTakeManifest = {
      version: 1, name: path.basename(final), recordingId: request.recordingId, createdAt: new Date().toISOString(), fps: request.fps ?? 30,
      width: result.width, height: result.height, frames: result.frames, durationUs: Math.round(result.durationMs * 1000), pointer: request.pointer, video,
      conflicts: result.issues.filter(issue => issue.kind === 'conflict').length, warnings: result.issues.filter(issue => issue.kind === 'warning').length,
    }
    await fs.writeFile(path.join(staging, TAKE_FILES.behavior), JSON.stringify(behavior))
    await fs.writeFile(path.join(staging, TAKE_FILES.timeMap), JSON.stringify(result.takeTracks.timeMap))
    await fs.writeFile(path.join(staging, TAKE_FILES.director), `${JSON.stringify(request.director, null, 2)}\n`)
    await fs.writeFile(path.join(staging, TAKE_FILES.manifest), `${JSON.stringify(manifest, null, 2)}\n`)
    await publish(staging, final)
    logger.info('网页重演版本已保存', { event: 'web_replay.take.saved', context: { recordingId: request.recordingId, take: manifest.name, frames: manifest.frames, durationUs: manifest.durationUs, conflicts: manifest.conflicts, steps: result.takeTracks.steps.length } })
    return { result, take: { ...manifest, directory: final, videoPath: video ? path.join(final, TAKE_FILES.video) : null } }
  } catch (error) {
    await fs.rm(staging, { recursive: true, force: true }).catch(cleanup => logger.warn('网页重演版本暂存没能清理', { event: 'web_replay.take.cleanup_failed', context: { staging }, error: String(cleanup) }))
    throw error
  }
}

/** 换上新版本：旧的先挪开，新的改名到位，再删旧的；改名失败时把旧的放回去。 */
async function publish(staging: string, final: string): Promise<void> {
  const old = await fs.access(final).then(() => path.join(path.dirname(final), `.${path.basename(final)}.${crypto.randomUUID()}.old`), () => null)
  if (old) await fs.rename(final, old)
  try {
    await fs.rename(staging, final)
  } catch (error) {
    if (old) await fs.rename(old, final).catch(() => undefined)
    throw error
  }
  if (old) await fs.rm(old, { recursive: true, force: true }).catch(error => logger.warn('被替换的旧版本没能删除', { event: 'web_replay.take.old_cleanup_failed', context: { old }, error: String(error) }))
}
