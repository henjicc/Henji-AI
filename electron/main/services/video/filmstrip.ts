import { execFile, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { app } from 'electron'
import { createMainLogger } from '../logging'
import { createContentDiskCache, type ContentDiskCache } from '../media/content-disk-cache'
import { identifyMediaContent, type MediaContentIdentity } from '../media/content-identity'
import { loadFfmpegPath, loadFfprobePath } from './ffmpeg-loader'
import { FILMSTRIP_FORMAT_VERSION, type FilmstripHeight } from '../../../../src/core/media/filmstripFrames'

/**
 * 剪辑时间线片段缩略图条的取帧服务（任务 2.4）。
 *
 * 选型（执行记录第一节）：用与原生解码服务同一份 FFmpeg 9 的命令行，在独立的低优先级子进程里按时间点精确取帧，
 * 不占用原生解码服务的显卡解码会话与预览播放；同一素材、同一高度的多个时间点合并进一个进程（每个时间点一路
 * `-ss <相对容器起点的时间> -i`，容器起点每个素材探测一次），摊薄进程启动成本。取到的是呈现时间不早于请求时间的第一帧。结果按“内容身份 + 绝对时间 + 高度 + 格式版本”
 * 写入 `userData/HenjiCache/Filmstrip/<sha256>.webp`，渲染层按路径显示，二次打开直接命中。
 *
 * 调度：相同帧的请求共享一次生成；无人等待的帧在排队时直接移除，整批都无人等待时结束进程；
 * 并发进程数与每批帧数受限，每个进程的解码线程受限且以低于正常的系统优先级运行。
 */

export interface FilmstripFrameRequest {
  /** 已授权的本地绝对路径。 */
  source: string
  /** 素材绝对时钟上的取帧时间（微秒）。 */
  timeUs: number
  height: FilmstripHeight
}

interface ChildLike {
  pid?: number
  stderr: NodeJS.ReadableStream | null
  kill(): boolean
  once(event: 'close', listener: (code: number | null) => void): unknown
  once(event: 'error', listener: (error: Error) => void): unknown
}

export interface FilmstripServiceDependencies {
  ffmpegPath?: () => Promise<string>
  /** 素材容器起点（秒，绝对时钟）与画面尺寸；默认用 ffprobe 读 format.start_time 与第一路画面的宽高。 */
  probe?: (sourcePath: string) => Promise<FilmstripSourceProbe>
  identity?: (source: string) => Promise<MediaContentIdentity>
  /** 缩略帧磁盘缓存；默认 userData/HenjiCache/Filmstrip，上限 256MB。 */
  cache?: ContentDiskCache
  spawnProcess?: (binary: string, args: string[]) => ChildLike
  /** 同时运行的取帧进程数。 */
  concurrency?: number
  /** 每个进程最多取的帧数。 */
  batchSize?: number
  /** 收集同一批请求的等待时间（毫秒）：一屏的请求成批到达，每个请求先做授权、身份与缓存查询。 */
  gatherMs?: number
  timeoutMs?: number
  /** 每一路输入的解码线程数。 */
  decodeThreads?: number
}

export interface FilmstripSourceProbe { startSeconds: number; width: number; height: number }

export interface FilmstripStatistics { hits: number; generated: number; failed: number; batches: number; batchMs: number; pending: number; running: number }

interface Tile {
  key: string
  groupKey: string
  source: MediaContentIdentity
  timeUs: number
  height: FilmstripHeight
  users: number
  state: 'pending' | 'running'
  batch?: Batch
  promise: Promise<string>
  resolve: (path: string) => void
  reject: (error: unknown) => void
}
interface Batch { tiles: Tile[]; child?: ChildLike; cancelled: boolean }

const logger = createMainLogger('main.video.filmstrip')
const STDERR_LIMIT = 4096
const IDENTITY_REUSE_MS = 1000
/** 直接定位解不出画面时，重试从目标前多远开始解码（微秒）。 */
const RETRY_MARGIN_US = 10_000_000

const abortError = (): DOMException => new DOMException('缩略帧请求已取消', 'AbortError')

export function filmstripScaleFilter(height: FilmstripHeight): string {
  // 按显示比例（含非方形像素）缩放到目标高度；area 适合 4K → 几十像素的大倍率缩小。
  return `scale=w='max(2,trunc(${height}*dar/2)*2)':h=${height}:flags=area`
}

/**
 * 一批取帧的 FFmpeg 参数：每个时间点一路输入、一路输出，全部是同一素材、同一高度。
 * - 输入侧 `-ss` 相对容器起点（FFmpeg 会再加上 format.start_time），由调用方先减去容器起点；不用 `-seek_timestamp 1`：
 *   实测 9.0.2 在起点 1.43s 的 M2TS 上 3s 之后的精确裁剪取不到帧。
 * - `marginUs`（重试）：输入侧先定位到目标前 `marginUs`，再用输出侧 `-ss` 解码丢弃到目标。用于 MPEG-TS 这类按字节定位、
 *   直接定位会落在非关键帧上而解不出画面的素材（实测长 GOP H.264 TS 直接定位整段无输出）。
 */
export function filmstripBatchArgs(sourcePath: string, height: FilmstripHeight, times: readonly number[], outputs: readonly string[], options: { decodeThreads?: number; containerStartUs?: number; marginUs?: number } = {}): string[] {
  const { decodeThreads = 2, containerStartUs = 0, marginUs = 0 } = options
  const seconds = (us: number): string => (us / 1_000_000).toFixed(6)
  const args = ['-hide_banner', '-nostdin', '-v', 'error', '-filter_threads', '1']
  const relative = times.map(timeUs => Math.max(0, timeUs - containerStartUs))
  const inputSeek = relative.map(us => Math.max(0, us - marginUs))
  for (const seek of inputSeek) args.push('-threads', String(decodeThreads), '-ss', seconds(seek), '-i', sourcePath)
  outputs.forEach((output, index) => {
    const trim = relative[index] - inputSeek[index]
    args.push('-map', `${index}:v:0`, ...(trim > 0 ? ['-ss', seconds(trim)] : []), '-frames:v', '1', '-vf', filmstripScaleFilter(height), '-c:v', 'libwebp', '-quality', '75', '-f', 'webp', '-y', output)
  })
  return args
}

function defaultSpawn(binary: string, args: string[]): ChildLike {
  const child = spawn(binary, args, { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] })
  // 缩略图只是辅助显示：低于正常优先级，播放、导出与界面线程永远先拿到 CPU。
  if (child.pid) { try { os.setPriority(child.pid, os.constants.priority.PRIORITY_BELOW_NORMAL) } catch { /* 进程已结束或无权限 */ } }
  return child
}

function defaultCache(): ContentDiskCache {
  return createContentDiskCache({
    extension: '.webp',
    directory: () => app?.getPath ? filmstripCacheDirectory(app.getPath('userData')) : undefined,
    budgetBytes: 256 * 1024 * 1024,
    pruneIntervalMs: 60_000,
    onError: (event, error) => logger.warn('缩略帧磁盘缓存失败', { event: `video.filmstrip.cache.${event}_failed`, error }),
  })
}

async function probeSource(sourcePath: string): Promise<FilmstripSourceProbe> {
  const binary = await loadFfprobePath()
  const stdout = await new Promise<string>((resolve, reject) => {
    execFile(binary, ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'format=start_time:stream=width,height', '-of', 'json', sourcePath], { windowsHide: true, timeout: 15_000 }, (error, out) => error ? reject(error) : resolve(String(out)))
  })
  const parsed = JSON.parse(stdout) as { format?: { start_time?: string }; streams?: Array<{ width?: number; height?: number }> }
  const startSeconds = Number.parseFloat(parsed.format?.start_time ?? '')
  const stream = parsed.streams?.[0]
  return { startSeconds: Number.isFinite(startSeconds) ? startSeconds : 0, width: stream?.width ?? 0, height: stream?.height ?? 0 }
}

/**
 * 一个进程同时解码的输入受像素总量限制：每路输入常驻一套参考帧（实测 4K HEVC 10 位约 230MB/路、4K H.264 约 120MB/路），
 * 每进程 1800 万像素即 4K 两路、1440p 四路、1080p 八路；两个进程合计 4K 不超过约 1GB。
 */
const PROCESS_INPUT_PIXELS = 18_000_000
export function filmstripInputsPerProcess(width: number, height: number, batchSize: number): number {
  const pixels = width * height
  return pixels > 0 ? Math.max(1, Math.min(batchSize, Math.floor(PROCESS_INPUT_PIXELS / pixels))) : batchSize
}

export function filmstripCacheDirectory(userData: string): string {
  return path.join(userData, 'HenjiCache', 'Filmstrip')
}

export function createFilmstripService(dependencies: FilmstripServiceDependencies = {}): {
  frame(request: FilmstripFrameRequest, signal?: AbortSignal): Promise<string>
  statistics(): FilmstripStatistics
  dispose(): void
} {
  const ffmpegPath = dependencies.ffmpegPath ?? loadFfmpegPath
  const probe = dependencies.probe ?? probeSource
  const identity = dependencies.identity ?? identifyMediaContent
  const cache = dependencies.cache ?? defaultCache()
  const spawnProcess = dependencies.spawnProcess ?? defaultSpawn
  const concurrency = dependencies.concurrency ?? 2
  const batchSize = dependencies.batchSize ?? 8
  const gatherMs = dependencies.gatherMs ?? 16
  const timeoutMs = dependencies.timeoutMs ?? 30_000
  const decodeThreads = dependencies.decodeThreads ?? 2
  const tiles = new Map<string, Tile>()
  /** 每个“素材 + 高度”一组待生成的帧；组按首次排队的先后轮转，组内按时间。 */
  const groups = new Map<string, Tile[]>()
  const running = new Set<Batch>()
  const stats = { hits: 0, generated: 0, failed: 0, batches: 0, batchMs: 0 }
  let gatherTimer: ReturnType<typeof setTimeout> | undefined
  let disposed = false

  const digest = (parts: unknown[]): string => createHash('sha256').update(JSON.stringify(parts)).digest('hex')
  /** 一屏几十上百个请求指向少数几个文件：身份在短时间内复用；生成后的复核总是重新读取。 */
  const identities = new Map<string, { at: number; value: Promise<MediaContentIdentity> }>()
  /** 容器起点与画面尺寸按内容身份探测一次。 */
  const probes = new Map<string, Promise<FilmstripSourceProbe>>()
  const probeOf = (source: MediaContentIdentity): Promise<FilmstripSourceProbe> => {
    let value = probes.get(source.identity)
    if (!value) {
      if (probes.size > 256) probes.clear()
      value = probe(source.path)
      probes.set(source.identity, value)
      value.catch(() => { if (probes.get(source.identity) === value) probes.delete(source.identity) })
    }
    return value
  }
  const knownIdentity = (source: string): Promise<MediaContentIdentity> => {
    const now = Date.now()
    const held = identities.get(source)
    if (held && now - held.at < IDENTITY_REUSE_MS) return held.value
    if (identities.size > 256) identities.clear()
    const value = identity(source)
    identities.set(source, { at: now, value })
    value.catch(() => { if (identities.get(source)?.value === value) identities.delete(source) })
    return value
  }

  const settle = (tile: Tile): void => { if (tiles.get(tile.key) === tile) tiles.delete(tile.key) }
  const removePending = (tile: Tile): void => {
    const group = groups.get(tile.groupKey)
    if (!group) return
    const index = group.indexOf(tile)
    if (index >= 0) group.splice(index, 1)
    if (!group.length) groups.delete(tile.groupKey)
  }
  const release = (tile: Tile): void => {
    tile.users--
    if (tile.users > 0) return
    if (tile.state === 'pending') {
      removePending(tile); settle(tile); tile.reject(abortError())
      return
    }
    const batch = tile.batch
    if (batch && !batch.cancelled && batch.tiles.every(item => item.users <= 0)) {
      batch.cancelled = true
      // Later requests for these frames start a fresh generation instead of joining the cancelled one.
      for (const item of batch.tiles) settle(item)
      batch.child?.kill()
    }
  }

  const schedule = (): void => {
    if (gatherTimer || disposed) return
    gatherTimer = setTimeout(() => { gatherTimer = undefined; pump() }, gatherMs)
  }
  const pump = (): void => {
    while (!disposed && running.size < concurrency && groups.size) {
      const [groupKey, group] = groups.entries().next().value as [string, Tile[]]
      groups.delete(groupKey)
      group.sort((a, b) => a.timeUs - b.timeUs)
      const taken = group.splice(0, batchSize)
      // Remaining frames of this source rotate behind the other sources so one long clip cannot starve the rest.
      if (group.length) groups.set(groupKey, group)
      const batch: Batch = { tiles: taken, cancelled: false }
      for (const tile of taken) { tile.state = 'running'; tile.batch = batch }
      running.add(batch)
      void runBatch(batch).finally(() => { running.delete(batch); pump() })
    }
  }

  /** 运行一个取帧进程，返回退出码。 */
  async function execute(batch: Batch, binary: string, args: string[], log: { stderr: string }): Promise<number | null> {
    return new Promise<number | null>((resolve, reject) => {
      const child = spawnProcess(binary, args)
      batch.child = child
      const timer = setTimeout(() => { batch.cancelled = true; child.kill(); reject(new Error('生成缩略帧超时。')) }, timeoutMs)
      child.stderr?.on('data', (chunk: Buffer | string) => { if (log.stderr.length < STDERR_LIMIT) log.stderr += chunk.toString() })
      child.once('error', error => { clearTimeout(timer); reject(error) })
      child.once('close', exit => { clearTimeout(timer); resolve(exit) })
      if (batch.cancelled) child.kill()
    })
  }
  const outputSize = (output: string): Promise<number> => fs.stat(output).then(stat => stat.size, () => 0)

  async function runBatch(batch: Batch): Promise<void> {
    const started = Date.now()
    const [first] = batch.tiles
    const outputs: Array<string | undefined> = []
    const log = { stderr: '' }
    const removeOutputs = (): Promise<unknown> => Promise.all(outputs.map(output => output ? fs.rm(output, { force: true }).catch(() => undefined) : undefined))
    try {
      const binary = await ffmpegPath()
      const probed = await probeOf(first.source)
      const containerStartUs = Math.round(probed.startSeconds * 1_000_000)
      const perProcess = filmstripInputsPerProcess(probed.width, probed.height, batchSize)
      for (const tile of batch.tiles) outputs.push(await cache.prepareTemporary(tile.key))
      if (outputs.some(output => !output)) throw new Error('缩略帧缓存目录不可用。')
      if (batch.cancelled) throw abortError()
      logger.debug('开始生成缩略帧', { event: 'video.filmstrip.batch.started', context: { frames: batch.tiles.length, height: first.height } })
      // Large pictures run in consecutive smaller processes so the decoders' reference frames stay within the memory budget.
      let code: number | null = 0
      const run = async (indices: number[], marginUs: number): Promise<void> => {
        for (let from = 0; from < indices.length; from += perProcess) {
          const chunk = indices.slice(from, from + perProcess)
          code = await execute(batch, binary, filmstripBatchArgs(first.source.path, first.height, chunk.map(index => batch.tiles[index].timeUs), chunk.map(index => outputs[index]!), { decodeThreads, containerStartUs, marginUs }), log)
          if (batch.cancelled) throw abortError()
        }
      }
      await run(batch.tiles.map((_tile, index) => index), 0)
      // Frames a direct seek could not decode (byte-seeking containers landing between key frames) retry once from a margin earlier.
      const sizes = await Promise.all(outputs.map(output => outputSize(output!)))
      const missing = batch.tiles.flatMap((_tile, index) => sizes[index] > 0 ? [] : [index])
      if (missing.length) await run(missing, RETRY_MARGIN_US)
      // The source must still be the content the cache key names; a replaced file would publish wrong frames.
      const after = await identity(first.source.path)
      if (after.identity !== first.source.identity) throw new Error('素材在生成缩略帧期间发生变化。')
      let produced = 0
      for (const [index, tile] of batch.tiles.entries()) {
        const output = outputs[index]!
        if ((await outputSize(output)) > 0) {
          try { tile.resolve(await cache.adopt(tile.key, output)); produced++; stats.generated++ } catch (error) { stats.failed++; tile.reject(error) }
        } else {
          stats.failed++
          tile.reject(new Error(`未能取得该时刻的画面${code === 0 ? '' : `（FFmpeg 退出码 ${code}）`}。`))
        }
        settle(tile)
      }
      stats.batches++; stats.batchMs += Date.now() - started
      logger.debug('缩略帧生成完成', { event: 'video.filmstrip.batch.completed', context: { frames: batch.tiles.length, produced, retried: missing.length, height: first.height, durationMs: Date.now() - started } })
      if (produced < batch.tiles.length) logger.warn('部分缩略帧未能生成', { event: 'video.filmstrip.batch.partial', context: { frames: batch.tiles.length, produced, code, stderr: log.stderr.slice(0, 1024) } })
    } catch (error) {
      const cancelled = batch.cancelled && error instanceof DOMException && error.name === 'AbortError'
      if (!cancelled) {
        stats.failed += batch.tiles.length
        logger.warn('缩略帧生成失败', { event: 'video.filmstrip.batch.failed', error, context: { frames: batch.tiles.length, stderr: log.stderr.slice(0, 1024) } })
      }
      await removeOutputs()
      for (const tile of batch.tiles) { settle(tile); tile.reject(error) }
    } finally {
      await removeOutputs()
    }
  }

  async function frame(request: FilmstripFrameRequest, signal?: AbortSignal): Promise<string> {
    if (disposed) throw new Error('缩略帧服务已关闭。')
    signal?.throwIfAborted()
    const source = await knownIdentity(request.source)
    const key = digest(['filmstrip', FILMSTRIP_FORMAT_VERSION, source.identity, request.timeUs, request.height])
    const hit = await cache.locate(key)
    if (hit) { stats.hits++; return hit }
    signal?.throwIfAborted()
    let tile = tiles.get(key)
    if (!tile) {
      let resolve!: (path: string) => void
      let reject!: (error: unknown) => void
      const promise = new Promise<string>((done, fail) => { resolve = done; reject = fail })
      // Waiters attach below; an unobserved rejection after every waiter left must not surface as unhandled.
      promise.catch(() => undefined)
      const groupKey = `${source.identity}|${request.height}`
      tile = { key, groupKey, source, timeUs: request.timeUs, height: request.height, users: 0, state: 'pending', promise, resolve, reject }
      tiles.set(key, tile)
      const group = groups.get(groupKey)
      if (group) group.push(tile); else groups.set(groupKey, [tile])
      schedule()
    }
    const owned = tile
    owned.users++
    let onAbort: (() => void) | undefined
    try {
      if (!signal) return await owned.promise
      return await Promise.race([owned.promise, new Promise<never>((_resolve, reject) => {
        onAbort = () => reject(signal.reason ?? abortError())
        signal.addEventListener('abort', onAbort, { once: true })
        if (signal.aborted) onAbort()
      })])
    } finally {
      if (onAbort) signal?.removeEventListener('abort', onAbort)
      release(owned)
    }
  }

  return {
    frame,
    statistics: () => ({ ...stats, pending: [...groups.values()].reduce((sum, group) => sum + group.length, 0), running: running.size }),
    dispose() {
      disposed = true
      if (gatherTimer) clearTimeout(gatherTimer)
      for (const batch of running) { batch.cancelled = true; batch.child?.kill() }
      for (const tile of tiles.values()) if (tile.state === 'pending') tile.reject(abortError())
      tiles.clear(); groups.clear()
    },
  }
}

let shared: ReturnType<typeof createFilmstripService> | undefined
/** 主进程唯一的缩略帧服务。 */
export function filmstripService(): ReturnType<typeof createFilmstripService> {
  if (!shared) {
    shared = createFilmstripService()
    // Windows does not end child processes with their parent: stop running FFmpeg batches on quit.
    app?.once?.('will-quit', () => shared?.dispose())
  }
  return shared
}
