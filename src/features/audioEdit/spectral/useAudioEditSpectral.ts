import { useEffect, useMemo, useRef, useState } from 'react'
import {
  SPECTRAL_MAX_LEVEL, SPECTRAL_PERSISTED_MIN_LEVEL, SPECTRAL_TILE_COLUMNS, spectralColumnCount, spectralHop, spectralOrigin, spectralTileCount,
  type AudioEditSpectralProgress, type AudioEditSpectralTile, type AudioEditSpectralTileRequest,
} from '@/core/audioEdit/spectralPyramid'
import { spectralDesiredLevel, SpectralTileStore, spectralTileKey, type SpectralTileSet } from '@/core/audio/spectralTiles'
import { createLogger } from '@/core/logging'
import type { WaveformViewport } from '../waveformViewport'

const logger = createLogger('features.audioEdit.spectral')

export interface SpectralTileClient {
  fetch(request: AudioEditSpectralTileRequest): Promise<AudioEditSpectralTile>
  cancel(requestId: string): void
  subscribe(listener: (progress: AudioEditSpectralProgress) => void): () => void
}
export interface SpectralNeed { level: number; tile: number }
export interface AudioEditSpectralState { tiles?: SpectralTileSet; status: 'idle' | 'loading' | 'ready' | 'error'; error?: string; retry: () => void }

/** 整段放进一块的最细落盘层：总览永远有图可垫。 */
export function spectralOverviewLevel(durationFrames: number): number {
  const base = spectralColumnCount(0, durationFrames)
  return Math.max(SPECTRAL_PERSISTED_MIN_LEVEL, Math.min(SPECTRAL_MAX_LEVEL, Math.ceil(Math.log2(Math.max(1, base / SPECTRAL_TILE_COLUMNS)))))
}

function tilesOver(level: number, start: number, end: number, duration: number): number[] {
  const span = spectralHop(level) * SPECTRAL_TILE_COLUMNS, origin = spectralOrigin(level), count = spectralTileCount(level, duration)
  const first = Math.max(0, Math.floor((Math.max(0, start) - origin) / span)), last = Math.min(count - 1, Math.floor((Math.min(duration, end) - 1 - origin) / span))
  return Array.from({ length: Math.max(0, last - first + 1) }, (_, i) => first + i)
}

/** 取块顺序：目标层可见块（由中间向两边）→ 总览 → 目标层左右各半屏预取。 */
export function spectralNeeds(view: WaveformViewport, columns: number, duration: number): SpectralNeed[] {
  if (!(duration > 0) || columns <= 0 || !(view.end > view.start)) return []
  const span = view.end - view.start, level = spectralDesiredLevel({ startFrame: view.start, endFrame: view.end, width: columns })
  const center = (view.start + view.end) / 2, tileCenter = (tile: number): number => spectralOrigin(level) + (tile + 0.5) * spectralHop(level) * SPECTRAL_TILE_COLUMNS
  const visible = tilesOver(level, view.start, view.end, duration).sort((a, b) => Math.abs(tileCenter(a) - center) - Math.abs(tileCenter(b) - center))
  const overview = spectralOverviewLevel(duration)
  const needs: SpectralNeed[] = [...visible.map(tile => ({ level, tile })), ...tilesOver(overview, 0, duration, duration).map(tile => ({ level: overview, tile })),
    ...tilesOver(level, view.start - span / 2, view.end + span / 2, duration).map(tile => ({ level, tile }))]
  const seen = new Set<string>()
  return needs.filter(need => { const key = spectralTileKey(need.level, need.tile); if (seen.has(key)) return false; seen.add(key); return true })
}

/** 落盘层读盘很快，可多并发；更细层要 FFT，少并发让可见块先出来。 */
const DISK_CONCURRENCY = 4, COMPUTE_CONCURRENCY = 3, CANCEL_GRACE_MS = 300, RETRY_DELAY_MS = 600, MAX_FAILURES = 3

export class SpectralTileScheduler {
  private needs: SpectralNeed[] = []
  private readonly inflight = new Map<string, { requestId: string; persisted: boolean; cancelAt?: number }>()
  private readonly stale = new Set<string>()
  private readonly failures = new Map<string, number>()
  private readonly retryAt = new Map<string, number>()
  /** 最近一次进度：部分块可能晚于进度通知到达，到达时要对照它决定是否立刻重取。 */
  private latest: AudioEditSpectralProgress | undefined
  private timer: ReturnType<typeof setTimeout> | undefined
  private disposed = false
  constructor(
    private readonly client: SpectralTileClient,
    readonly store: SpectralTileStore,
    private readonly target: { projectId: string; mode: 'source' | 'edited'; revision: number },
    private readonly onChange: () => void,
    private readonly onError: (message: string) => void,
    private readonly now: () => number = () => Date.now(),
  ) {}

  setNeeds(needs: SpectralNeed[]): void {
    this.needs = needs
    const wanted = new Set(needs.map(need => spectralTileKey(need.level, need.tile)))
    this.store.pin(wanted)
    for (const [key, flight] of this.inflight) {
      if (wanted.has(key)) delete flight.cancelAt
      else flight.cancelAt ??= this.now() + CANCEL_GRACE_MS
    }
    this.pump()
  }

  /** 后台整文件计算推进后，把落后于进度的部分块标为过期，重新取。 */
  progress(progress: AudioEditSpectralProgress): void {
    if (progress.projectId !== this.target.projectId || progress.mode !== this.target.mode || (progress.mode === 'edited' && progress.revision !== this.target.revision)) return
    this.latest = progress
    for (const need of this.needs) {
      const tile = this.store.get(need.level, need.tile)
      if (tile) this.markIfBehind(tile)
    }
    this.pump()
  }

  private markIfBehind(tile: AudioEditSpectralTile): void {
    const progress = this.latest
    if (tile.complete || !progress) return
    const frontier = spectralOrigin(tile.level) + (tile.columnStart + tile.columnCount) * spectralHop(tile.level)
    if (progress.done || progress.coveredFrames > frontier) this.stale.add(spectralTileKey(tile.level, tile.tile))
  }

  dispose(): void {
    this.disposed = true
    if (this.timer) clearTimeout(this.timer)
    for (const flight of this.inflight.values()) this.client.cancel(flight.requestId)
    this.inflight.clear()
  }

  private pump(): void {
    if (this.disposed) return
    const now = this.now()
    for (const [key, flight] of this.inflight) {
      if (flight.cancelAt !== undefined && flight.cancelAt <= now) { this.client.cancel(flight.requestId); this.inflight.delete(key) }
    }
    let disk = 0, compute = 0
    for (const flight of this.inflight.values()) flight.persisted ? disk++ : compute++
    let wake = Infinity
    for (const need of this.needs) {
      const key = spectralTileKey(need.level, need.tile), held = this.store.get(need.level, need.tile)
      if (this.inflight.has(key) || (held && (held.complete || !this.stale.has(key))) || (this.failures.get(key) ?? 0) >= MAX_FAILURES) continue
      const retry = this.retryAt.get(key)
      if (retry !== undefined && retry > now) { wake = Math.min(wake, retry); continue }
      const persisted = need.level >= SPECTRAL_PERSISTED_MIN_LEVEL
      if (persisted ? disk >= DISK_CONCURRENCY : compute >= COMPUTE_CONCURRENCY) continue
      persisted ? disk++ : compute++
      this.start(need, key, persisted)
    }
    for (const flight of this.inflight.values()) if (flight.cancelAt !== undefined) wake = Math.min(wake, flight.cancelAt)
    if (this.timer) clearTimeout(this.timer)
    this.timer = Number.isFinite(wake) ? setTimeout(() => { this.timer = undefined; this.pump() }, Math.max(0, wake - now)) : undefined
  }

  private start(need: SpectralNeed, key: string, persisted: boolean): void {
    // 请求 ID 必须全局唯一：同一作品换版本或重试会新建调度器，旧请求可能仍在主进程登记中。
    const requestId = `spectral-${crypto.randomUUID()}`
    this.inflight.set(key, { requestId, persisted })
    this.stale.delete(key)
    void this.client.fetch({ projectId: this.target.projectId, mode: this.target.mode, level: need.level, tile: need.tile, requestId }).then(tile => {
      if (this.disposed || this.inflight.get(key)?.requestId !== requestId) return
      if (tile.mode !== this.target.mode || (tile.mode === 'edited' && tile.revision !== this.target.revision)) return
      this.failures.delete(key); this.retryAt.delete(key)
      this.store.set(tile)
      this.markIfBehind(tile)
      this.onChange()
    }, error => {
      if (this.disposed || this.inflight.get(key)?.requestId !== requestId) return
      const failures = (this.failures.get(key) ?? 0) + 1
      this.failures.set(key, failures); this.retryAt.set(key, this.now() + RETRY_DELAY_MS * failures)
      logger.warn('频谱块读取失败', { event: 'audio_edit.spectral.tile_failed', error, context: { level: need.level, tile: need.tile, failures } })
      if (failures >= MAX_FAILURES) this.onError(error instanceof Error ? error.message : '频谱图没有生成出来。')
    }).finally(() => {
      if (this.inflight.get(key)?.requestId === requestId) this.inflight.delete(key)
      this.pump()
    })
  }
}

export function useAudioEditSpectral(client: SpectralTileClient, projectId: string, view: WaveformViewport, columns: number, duration: number, mode: 'source' | 'edited', revision: number, sourceKey = ''): AudioEditSpectralState {
  const [attempt, setAttempt] = useState(0)
  const [version, setVersion] = useState(0)
  const [error, setError] = useState<string | undefined>()
  // 原始模式不随剪切变化，但录音拼接、重新定位或撤销更换素材时必须丢掉旧块。
  const effectiveRevision = mode === 'edited' ? revision : 0
  const target = useMemo(() => ({ projectId, mode, revision: effectiveRevision }), [projectId, mode, effectiveRevision])
  const shown = useRef<{ store: SpectralTileStore; projectId: string; mode: 'source' | 'edited'; sourceKey: string } | null>(null)
  // 调度器随挂载创建、随卸载销毁：开发模式会挂载两次，不能把已销毁的实例留给第二次挂载。
  const [binding, setBinding] = useState<{ scheduler: SpectralTileScheduler; sourceKey: string } | null>(null)
  const scheduler = binding?.sourceKey === sourceKey ? binding.scheduler : null
  useEffect(() => {
    let frame = 0
    const next = new SpectralTileScheduler(client, new SpectralTileStore(), target,
      () => { if (!frame) frame = requestAnimationFrame(() => { frame = 0; setVersion(value => value + 1) }) },
      message => setError(message))
    const unsubscribe = client.subscribe(progress => next.progress(progress))
    setError(undefined)
    setBinding({ scheduler: next, sourceKey })
    return () => { unsubscribe(); next.dispose(); if (frame) cancelAnimationFrame(frame) }
  }, [client, target, attempt, sourceKey])

  useEffect(() => {
    scheduler?.setNeeds(spectralNeeds(view, columns, duration))
  }, [scheduler, view.start, view.end, columns, duration]) // eslint-disable-line react-hooks/exhaustive-deps -- view 只用起止

  // 同一作品同一模式换版本（或重试）时，新块到达前继续显示旧图；换作品或换模式不沿用。
  const current = scheduler?.store
  const held = shown.current
  const display = current && current.version > 0 ? current : held && held.projectId === projectId && held.mode === mode && held.sourceKey === sourceKey ? held.store : null
  if (current && current.version > 0) shown.current = { store: current, projectId, mode, sourceKey }
  const displayVersion = display?.version ?? 0
  const tiles = useMemo<SpectralTileSet | undefined>(() => display && displayVersion > 0 ? {
    sampleRate: display.sampleRate, channels: display.channels, durationFrames: display.durationFrames, lowBins: display.lowBins, highBins: display.highBins,
    version: displayVersion, get: (level, tile) => display.get(level, tile),
  } : undefined, [display, displayVersion, version]) // eslint-disable-line react-hooks/exhaustive-deps -- version 驱动快照刷新

  return {
    ...(tiles ? { tiles } : {}),
    status: tiles ? 'ready' : error ? 'error' : duration > 0 ? 'loading' : 'idle',
    ...(error && !tiles ? { error } : {}),
    retry: () => { setError(undefined); setAttempt(value => value + 1) },
  }
}
