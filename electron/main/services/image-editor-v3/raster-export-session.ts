import crypto from 'node:crypto'
import path from 'node:path'

import { createMainLogger } from '../logging'
import type {
  OutputTile,
  ResourceId,
  ResourceLease,
  TileOutputDescription,
  TileOutputSink,
} from './contracts'
import type { ImageEditDocumentRepository } from './document-repository'
import {
  createRasterTileOutputSink,
  ImageExportCapabilityError,
  type RasterExportFormat,
  type RasterExportOptions,
} from './export'
import type { ContentAddressedResourceStore } from './resource-store'
import {
  assertDocumentColorMatchesRasterExport,
  createImageEditSourceFingerprint,
  readRasterExportOutputDimensions,
} from './raster-export-snapshot'

const logger = createMainLogger('main.image_editor_v3.raster_export')
const SOURCE_FINGERPRINT_PATTERN = /^sha256:[a-f0-9]{64}$/
const DEFAULT_IDLE_TIMEOUT_MS = 10 * 60 * 1_000
const DEFAULT_SWEEP_INTERVAL_MS = 60 * 1_000
const DEFAULT_BEGIN_TIMEOUT_MS = 2 * 60 * 1_000
const DEFAULT_TILE_TIMEOUT_MS = 2 * 60 * 1_000
const DEFAULT_COMPLETE_TIMEOUT_MS = 30 * 60 * 1_000
const DEFAULT_CANCEL_TIMEOUT_MS = 10 * 1_000
const MAX_ACTIVE_SESSIONS_PER_OWNER = 2
const MAX_ICC_PROFILE_BYTES = 16 * 1024 * 1024

export type RasterExportPixelDescription = Omit<
  TileOutputDescription,
  'documentId' | 'revision' | 'sourceFingerprint' | 'hdrBigTiffExchange'
>

export interface StartRasterExportSessionRequest {
  ownerId: number
  targetPath: string
  documentRef: string
  revision: number
  sourceFingerprint: string
  format: RasterExportFormat
  description: RasterExportPixelDescription
  tileSize?: number
  compressionLevel?: number
  quality?: number
  effort?: number
  signal?: AbortSignal
}

export interface RasterExportSessionStartResult {
  sessionId: string
  documentId: string
  revision: number
  sourceFingerprint: string
  format: RasterExportFormat
}

export interface RasterExportSessionResult extends Omit<RasterExportSessionStartResult, 'sessionId'> {
  outputRef: `image-export-v3:${string}@${number}:${RasterExportFormat}`
  width: number
  height: number
}

interface RasterExportSession {
  id: string
  ownerId: number
  targetPath: string
  format: RasterExportFormat
  description: TileOutputDescription
  sink: TileOutputSink
  lease: ResourceLease
  state: 'writing' | 'completing' | 'cancelled' | 'failed'
  lastActivity: number
  activeKind?: 'tile' | 'complete'
  activeOperation?: Promise<void>
  cancellation?: Promise<void>
  restartRequest: Omit<StartRasterExportSessionRequest, 'signal'>
}

function isSessionCancelled(session: RasterExportSession): boolean {
  return session.state === 'cancelled'
}

export interface RasterExportSessionManagerDependencies {
  createSink?: (targetPath: string, options: RasterExportOptions) => TileOutputSink
  now?: () => number
  idleTimeoutMs?: number
  sweepIntervalMs?: number
  beginTimeoutMs?: number
  tileTimeoutMs?: number
  completeTimeoutMs?: number
  cancelTimeoutMs?: number
}

function abortError(): Error {
  const error = new Error('Raster export was cancelled')
  error.name = 'AbortError'
  return error
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError()
}

function withTimeout<T>(operation: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs)
    timer.unref()
  })
  return Promise.race([operation, timeout]).finally(() => {
    if (timer) clearTimeout(timer)
  })
}

export class RasterExportSessionManager {
  private readonly sessions = new Map<string, RasterExportSession>()
  private readonly closedListeners = new Map<string, Set<() => void>>()
  private readonly createSink: (targetPath: string, options: RasterExportOptions) => TileOutputSink
  private readonly now: () => number
  private readonly idleTimeoutMs: number
  private readonly beginTimeoutMs: number
  private readonly tileTimeoutMs: number
  private readonly completeTimeoutMs: number
  private readonly cancelTimeoutMs: number
  private readonly startingByOwner = new Map<number, number>()
  private readonly startingTargets = new Set<string>()
  private readonly sweepTimer: ReturnType<typeof setInterval>

  constructor(
    private readonly documents: ImageEditDocumentRepository,
    private readonly resources: ContentAddressedResourceStore,
    dependencies: RasterExportSessionManagerDependencies = {},
  ) {
    this.createSink = dependencies.createSink ?? createRasterTileOutputSink
    this.now = dependencies.now ?? Date.now
    this.idleTimeoutMs = dependencies.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS
    this.beginTimeoutMs = dependencies.beginTimeoutMs ?? DEFAULT_BEGIN_TIMEOUT_MS
    this.tileTimeoutMs = dependencies.tileTimeoutMs ?? DEFAULT_TILE_TIMEOUT_MS
    this.completeTimeoutMs = dependencies.completeTimeoutMs ?? DEFAULT_COMPLETE_TIMEOUT_MS
    this.cancelTimeoutMs = dependencies.cancelTimeoutMs ?? DEFAULT_CANCEL_TIMEOUT_MS
    const sweepIntervalMs = dependencies.sweepIntervalMs ?? DEFAULT_SWEEP_INTERVAL_MS
    const timeouts = [
      this.idleTimeoutMs,
      sweepIntervalMs,
      this.beginTimeoutMs,
      this.tileTimeoutMs,
      this.completeTimeoutMs,
      this.cancelTimeoutMs,
    ]
    if (timeouts.some((timeout) => !Number.isSafeInteger(timeout) || timeout < 1)) {
      throw new Error('Invalid raster export session timeout')
    }
    this.sweepTimer = setInterval(() => { void this.cancelExpired() }, sweepIntervalMs)
    this.sweepTimer.unref()
  }

  async start(request: StartRasterExportSessionRequest): Promise<RasterExportSessionStartResult> {
    this.validateStartRequest(request)
    throwIfAborted(request.signal)
    const activeForOwner = [...this.sessions.values()].filter((session) => session.ownerId === request.ownerId)
    const startingForOwner = this.startingByOwner.get(request.ownerId) ?? 0
    if (activeForOwner.length + startingForOwner >= MAX_ACTIVE_SESSIONS_PER_OWNER) {
      throw new Error(`Raster export session limit reached (${MAX_ACTIVE_SESSIONS_PER_OWNER})`)
    }
    const resolvedTarget = path.resolve(request.targetPath)
    if (
      this.startingTargets.has(resolvedTarget)
      || [...this.sessions.values()].some((session) => session.targetPath === resolvedTarget)
    ) {
      throw new Error('A raster export is already writing to the selected file')
    }
    this.startingByOwner.set(request.ownerId, startingForOwner + 1)
    this.startingTargets.add(resolvedTarget)
    try {
      const snapshot = await this.documents.load(request.documentRef)
      const sourceFingerprint = createImageEditSourceFingerprint(snapshot)
      if (snapshot.revision !== request.revision || sourceFingerprint !== request.sourceFingerprint) {
        throw new Error('Raster export snapshot does not match the persisted document')
      }
      const dimensions = readRasterExportOutputDimensions(snapshot.document)
      if (request.description.width !== dimensions.width || request.description.height !== dimensions.height) {
        throw new Error('Raster export dimensions do not match the document output geometry')
      }
      const trustedColorMetadata = assertDocumentColorMatchesRasterExport(
        snapshot.document,
        request.format,
        request.description,
      )

      const lease = await this.resources.acquireLease(snapshot.resourceRefs)
      const leased = new Set(lease.resourceIds)
      let sink: TileOutputSink | undefined
      const description: TileOutputDescription = {
        ...request.description,
        ...trustedColorMetadata,
        documentId: snapshot.documentId,
        revision: snapshot.revision,
        sourceFingerprint,
      }
      try {
      const options: RasterExportOptions = {
        format: request.format,
        inputByteOrder: 'little-endian',
        tileSize: request.tileSize,
        compressionLevel: request.compressionLevel,
        quality: request.quality,
        effort: request.effort,
        validateSnapshot: () => this.isSnapshotCurrent(snapshot.documentId, snapshot.revision, sourceFingerprint),
        resolveIccProfile: async (resourceId: ResourceId) => {
          if (!leased.has(resourceId)) throw new Error('ICC profile is not referenced by the export snapshot')
          const descriptor = await this.resources.describe(resourceId)
          if (descriptor.byteLength > MAX_ICC_PROFILE_BYTES) {
            throw new ImageExportCapabilityError(
              'ICC_PROFILE_INVALID',
              request.format,
              `ICC profile exceeds ${MAX_ICC_PROFILE_BYTES} bytes`,
            )
          }
          return this.resources.readVerifiedBuffer(resourceId, MAX_ICC_PROFILE_BYTES)
        },
      }
      sink = this.createSink(resolvedTarget, options)
      const onAbort = (): void => { void sink?.cancel(abortError()) }
      request.signal?.addEventListener('abort', onAbort, { once: true })
      try {
        await withTimeout(sink.begin(description), this.beginTimeoutMs, 'Raster export begin')
        throwIfAborted(request.signal)
      } finally {
        request.signal?.removeEventListener('abort', onAbort)
      }
      const sessionId = crypto.randomUUID()
      const { signal: _signal, ...restartRequest } = request
      this.sessions.set(sessionId, {
        id: sessionId,
        ownerId: request.ownerId,
        targetPath: resolvedTarget,
        format: request.format,
        description,
        sink,
        lease,
        state: 'writing',
        lastActivity: this.now(),
        restartRequest: { ...restartRequest, targetPath: resolvedTarget },
      })
      logger.info('栅格导出会话已创建', {
        event: 'image_editor_v3.raster_export.session.started',
        requestId: sessionId,
        context: {
          documentId: snapshot.documentId,
          revision: snapshot.revision,
          format: request.format,
          width: description.width,
          height: description.height,
        },
      })
      return {
        sessionId,
        documentId: snapshot.documentId,
        revision: snapshot.revision,
        sourceFingerprint,
        format: request.format,
      }
      } catch (error) {
        if (sink) await this.cancelSink(sink, error)
        await lease.release()
        throw error
      }
    } finally {
      const remainingStarts = (this.startingByOwner.get(request.ownerId) ?? 1) - 1
      if (remainingStarts > 0) this.startingByOwner.set(request.ownerId, remainingStarts)
      else this.startingByOwner.delete(request.ownerId)
      this.startingTargets.delete(resolvedTarget)
    }
  }

  async writeTile(ownerId: number, sessionId: string, tile: OutputTile): Promise<void> {
    const session = this.getOwnedSession(ownerId, sessionId)
    if (session.state !== 'writing') throw new Error(`Cannot write raster tile while ${session.state}`)
    if (session.activeOperation) throw new Error('Concurrent raster export operations are not allowed')
    const operation = withTimeout(
      session.sink.writeTile(tile),
      this.tileTimeoutMs,
      'Raster export tile write',
    )
    session.activeKind = 'tile'
    session.activeOperation = operation
    try {
      await operation
      session.lastActivity = this.now()
    } catch (error) {
      if (!isSessionCancelled(session)) await this.closeFailed(session, error)
      throw error
    } finally {
      if (session.activeOperation === operation) {
        session.activeOperation = undefined
        session.activeKind = undefined
      }
    }
  }

  async complete(ownerId: number, sessionId: string): Promise<RasterExportSessionResult> {
    const session = this.getOwnedSession(ownerId, sessionId)
    if (session.state !== 'writing' || session.activeOperation) {
      throw new Error('Raster export session is not ready to complete')
    }
    session.state = 'completing'
    const operation = withTimeout(
      session.sink.complete(),
      this.completeTimeoutMs,
      'Raster export completion',
    )
    session.activeKind = 'complete'
    session.activeOperation = operation
    try {
      await operation
      return {
        outputRef: `image-export-v3:${session.description.documentId}@${session.description.revision}:${session.format}`,
        documentId: session.description.documentId,
        revision: session.description.revision,
        sourceFingerprint: session.description.sourceFingerprint!,
        format: session.format,
        width: session.description.width,
        height: session.description.height,
      }
    } catch (error) {
      if (!isSessionCancelled(session)) await this.cancelSink(session.sink, error)
      throw error
    } finally {
      if (session.activeOperation === operation) {
        session.activeOperation = undefined
        session.activeKind = undefined
      }
      if (!isSessionCancelled(session)) await this.closeSession(session)
    }
  }

  async cancel(ownerId: number, sessionId: string, reason = 'requested'): Promise<boolean> {
    const session = this.sessions.get(sessionId)
    if (!session) return false
    if (session.ownerId !== ownerId) throw new Error('Raster export session belongs to another renderer')
    if (session.state === 'failed') return false
    if (session.state === 'cancelled') {
      await session.cancellation
      return true
    }
    if (session.state === 'completing') {
      const closed = new Promise<void>((resolve) => { this.onClosed(sessionId, resolve) })
      try {
        await session.activeOperation
        await closed
        return false
      } catch {
        await closed
        return true
      }
    }
    session.state = 'cancelled'
    const cancellation = (async (): Promise<void> => {
      if (session.activeKind === 'tile') await session.activeOperation?.catch(() => undefined)
      await this.cancelSink(session.sink, reason)
      await session.activeOperation?.catch(() => undefined)
      await this.closeSession(session)
    })()
    session.cancellation = cancellation
    await cancellation
    logger.info('栅格导出会话已取消', {
      event: 'image_editor_v3.raster_export.session.cancelled',
      requestId: sessionId,
      context: { reason },
    })
    return true
  }

  /**
   * 丢弃当前 staged 输出并从同一权威快照、同一正式目标创建全新的编码会话。
   * 返回前旧 sink 已完成 cancel/lease 释放，因此不会混合不同渲染后端的瓦片。
   */
  async restart(ownerId: number, sessionId: string): Promise<RasterExportSessionStartResult> {
    const session = this.getOwnedSession(ownerId, sessionId)
    if (session.state !== 'writing' || session.activeOperation) {
      throw new Error('Raster export session is not ready to restart')
    }
    const request = session.restartRequest
    await this.cancel(ownerId, sessionId, 'render_backend_retry')
    return this.start(request)
  }

  onClosed(sessionId: string, listener: () => void): () => void {
    if (!this.sessions.has(sessionId)) {
      listener()
      return () => undefined
    }
    const listeners = this.closedListeners.get(sessionId) ?? new Set<() => void>()
    listeners.add(listener)
    this.closedListeners.set(sessionId, listeners)
    return () => {
      listeners.delete(listener)
      if (listeners.size === 0) this.closedListeners.delete(sessionId)
    }
  }

  async dispose(reason = 'runtime_disposed'): Promise<void> {
    clearInterval(this.sweepTimer)
    await Promise.all([...this.sessions.values()].map((session) => (
      this.cancel(session.ownerId, session.id, reason)
    )))
  }

  private validateStartRequest(request: StartRasterExportSessionRequest): void {
    if (!Number.isSafeInteger(request.ownerId) || request.ownerId < 1) throw new Error('Invalid raster export owner')
    if (!path.isAbsolute(request.targetPath) || request.targetPath.includes('\0')) {
      throw new Error('Invalid raster export target selected by the host')
    }
    if (!Number.isSafeInteger(request.revision) || request.revision < 0) {
      throw new Error('Invalid raster export revision')
    }
    if (!SOURCE_FINGERPRINT_PATTERN.test(request.sourceFingerprint)) {
      throw new Error('Invalid raster export source fingerprint')
    }
  }

  private getOwnedSession(ownerId: number, sessionId: string): RasterExportSession {
    const session = this.sessions.get(sessionId)
    if (!session) throw new Error('Raster export session was not found')
    if (session.ownerId !== ownerId) throw new Error('Raster export session belongs to another renderer')
    return session
  }

  private async isSnapshotCurrent(
    documentId: string,
    revision: number,
    sourceFingerprint: string,
  ): Promise<boolean> {
    try {
      const current = await this.documents.load(documentId)
      return current.revision === revision
        && createImageEditSourceFingerprint(current) === sourceFingerprint
    } catch {
      return false
    }
  }

  private async closeFailed(session: RasterExportSession, error: unknown): Promise<void> {
    session.state = 'failed'
    this.sessions.delete(session.id)
    await this.cancelSink(session.sink, error)
    await session.lease.release()
    this.notifyClosed(session.id)
  }

  private async closeSession(session: RasterExportSession): Promise<void> {
    if (this.sessions.delete(session.id)) await session.lease.release()
    this.notifyClosed(session.id)
  }

  private async cancelSink(sink: TileOutputSink, reason: unknown): Promise<void> {
    try {
      await withTimeout(sink.cancel(reason), this.cancelTimeoutMs, 'Raster export cancellation')
    } catch (error) {
      logger.error('栅格导出清理超时或失败', {
        event: 'image_editor_v3.raster_export.cleanup.failed',
        error,
      })
    }
  }

  private notifyClosed(sessionId: string): void {
    const listeners = this.closedListeners.get(sessionId)
    this.closedListeners.delete(sessionId)
    for (const listener of listeners ?? []) listener()
  }

  private async cancelExpired(): Promise<void> {
    const deadline = this.now() - this.idleTimeoutMs
    const expired = [...this.sessions.values()].filter((session) => (
      session.state === 'writing' && !session.activeOperation && session.lastActivity <= deadline
    ))
    await Promise.all(expired.map((session) => this.cancel(session.ownerId, session.id, 'idle_timeout')))
  }
}
