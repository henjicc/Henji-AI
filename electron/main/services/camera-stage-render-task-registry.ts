import { randomUUID } from 'node:crypto'
import type {
  CameraStageRenderEvent as CameraStageRenderEventDto,
  CameraStageRenderRequest as CameraStageRenderRequestDto,
  CameraStageRenderResult as CameraStageRenderResultDto,
  CameraStageRenderTaskScope as CameraStageRenderTaskScopeDto,
  CameraStageRenderTaskSnapshot as CameraStageRenderTaskSnapshotDto,
  CameraStageRenderTaskStatus,
} from '../../../src/platform/contracts/cameraStageRender'

export type {
  CameraStageRenderEventDto,
  CameraStageRenderRequestDto,
  CameraStageRenderResultDto,
  CameraStageRenderTaskScopeDto,
  CameraStageRenderTaskSnapshotDto,
}

export interface CameraStageRenderTaskRecord extends CameraStageRenderTaskSnapshotDto {
  outputPersistence?: { result: CameraStageRenderResultDto; digest: string }
  ownerWebContentsId: number
  ownerSessionId: string
  requestFingerprint: string
  acknowledgedAt?: number
}

export interface CameraStageRenderTaskPersistence {
  get(requestId: string): CameraStageRenderTaskRecord | null
  list(canvasProjectId: string): CameraStageRenderTaskRecord[]
  save(record: CameraStageRenderTaskRecord, registration: boolean): void
}

export interface CameraStageRenderTaskRegistration {
  task: CameraStageRenderTaskSnapshotDto
  idempotent: boolean
}

function requestFingerprint(request: CameraStageRenderRequestDto): string {
  return JSON.stringify([
    request.canvasProjectId,
    request.nodeId,
    request.cameraStageProjectId,
    request.resolutionPreset,
    request.outputKind,
    request.selectedTimeSec ?? null,
    request.operationId ?? null,
  ])
}

function snapshot(record: CameraStageRenderTaskRecord): CameraStageRenderTaskSnapshotDto {
  const { ownerWebContentsId: _owner, ownerSessionId: _session, requestFingerprint: _fingerprint,
    acknowledgedAt: _acknowledged, outputPersistence: _outputPersistence, ...value } = record
  return structuredClone(value)
}

function isTerminal(status: CameraStageRenderTaskStatus): boolean {
  return status === 'completed' || status === 'failed' || status === 'cancelled'
}

export class CameraStageRenderTaskRegistry {
  private readonly sessionId = randomUUID()
  private readonly tasks = new Map<string, CameraStageRenderTaskRecord>()
  private readonly acknowledged = new Map<string, { ownerWebContentsId: number; fingerprint: string; expiresAt: number }>()

  constructor(private readonly persistence?: CameraStageRenderTaskPersistence) {}

  private restore(requestId: string, ownerWebContentsId: number, scope?: CameraStageRenderTaskScopeDto): void {
    if (this.tasks.has(requestId)) return
    const stored = this.persistence?.get(requestId)
    if (!stored) return
    if (scope && (stored.canvasProjectId !== scope.canvasProjectId || stored.nodeId !== scope.nodeId)) {
      throw new Error('Camera stage render task does not belong to this canvas project or node')
    }
    if (stored.ownerSessionId !== this.sessionId) {
      // 只恢复本地事实，不重新排队。调用方在 IPC 层验证当前正式主窗口。
      stored.ownerSessionId = this.sessionId
      stored.ownerWebContentsId = ownerWebContentsId
      if (!isTerminal(stored.status)) {
        Object.assign(stored, { status: 'cancelled', phase: null,
          message: '应用已退出，原渲染任务已停止；请核对已有结果后决定是否重新输出', updatedAt: Date.now() })
      }
      this.persistence!.save(stored, false)
    }
    this.tasks.set(requestId, stored)
  }

  register(request: CameraStageRenderRequestDto, ownerWebContentsId: number): CameraStageRenderTaskRegistration {
    this.pruneAcknowledged()
    this.restore(request.requestId, ownerWebContentsId, request)
    const existing = this.tasks.get(request.requestId)
    const fingerprint = requestFingerprint(request)
    const consumed = this.acknowledged.get(request.requestId)
    if (consumed) {
      const reason = consumed.ownerWebContentsId === ownerWebContentsId && consumed.fingerprint === fingerprint
        ? 'Camera stage render request was already completed and acknowledged'
        : 'Camera stage render request identity conflicts with an acknowledged task'
      throw new Error(reason)
    }
    if (existing) {
      if (existing.ownerWebContentsId !== ownerWebContentsId
        || existing.requestFingerprint !== fingerprint) {
        throw new Error('Camera stage render request identity conflicts with an existing task')
      }
      if (existing.acknowledgedAt !== undefined) throw new Error('Camera stage render request was already completed and acknowledged')
      return { task: snapshot(existing), idempotent: true }
    }
    const now = Date.now()
    const record: CameraStageRenderTaskRecord = {
      ...request,
      ownerWebContentsId,
      ownerSessionId: this.sessionId,
      requestFingerprint: fingerprint,
      status: 'queued',
      phase: 'preparing',
      progress: 0,
      result: null,
      message: null,
      createdAt: now,
      updatedAt: now,
    }
    this.persistence?.save(record, true)
    this.tasks.set(request.requestId, record)
    return { task: snapshot(record), idempotent: false }
  }

  require(scope: CameraStageRenderTaskScopeDto, ownerWebContentsId: number): CameraStageRenderTaskSnapshotDto | null {
    this.restore(scope.requestId, ownerWebContentsId, scope)
    const record = this.tasks.get(scope.requestId)
    if (!record) return null
    this.assertScope(record, scope, ownerWebContentsId)
    if (record.acknowledgedAt !== undefined) return null
    return snapshot(record)
  }

  list(canvasProjectId: string, ownerWebContentsId: number): CameraStageRenderTaskSnapshotDto[] {
    for (const record of this.persistence?.list(canvasProjectId) ?? []) this.restore(record.requestId, ownerWebContentsId)
    return [...this.tasks.values()]
      .filter((record) => record.ownerWebContentsId === ownerWebContentsId
        && record.canvasProjectId === canvasProjectId && record.acknowledgedAt === undefined)
      .sort((left, right) => left.createdAt - right.createdAt)
      .map(snapshot)
  }

  markRunning(requestId: string): void {
    const record = this.requireRecord(requestId)
    if (record.status !== 'queued') throw new Error('Camera stage render task is not queued')
    const next: CameraStageRenderTaskRecord = { ...record, status: 'running', updatedAt: Date.now() }
    this.persistence?.save(next, false)
    this.tasks.set(requestId, next)
  }

  prepareOutput(requestId: string, result: CameraStageRenderResultDto, digest: string): void {
    const record = this.requireRecord(requestId)
    if (isTerminal(record.status) || result.kind !== record.outputKind) throw new Error('RENDER_OUTPUT_STATE_INVALID')
    const outputPersistence = { result, digest }
    if (record.outputPersistence && JSON.stringify(record.outputPersistence) !== JSON.stringify(outputPersistence)) {
      throw new Error('RENDER_OUTPUT_IDENTITY_CONFLICT')
    }
    const next = { ...record, outputPersistence, updatedAt: Date.now() }
    this.persistence?.save(next, false)
    this.tasks.set(requestId, next)
  }

  /** 仅核对原任务在写文件前登记的路径及摘要，不重新渲染。 */
  async reconcileOutput(scope: CameraStageRenderTaskScopeDto, ownerWebContentsId: number,
    matchesFile: (filePath: string, digest: string) => Promise<boolean>): Promise<void> {
    const record = this.tasks.get(scope.requestId) ?? this.persistence?.get(scope.requestId)
    if (!record) return
    if (record.canvasProjectId !== scope.canvasProjectId || record.nodeId !== scope.nodeId
      || (record.ownerSessionId === this.sessionId && record.ownerWebContentsId !== ownerWebContentsId)) throw new Error('RENDER_OUTPUT_OWNER_INVALID')
    const anchor = record.outputPersistence
    if (!anchor || record.result || !await matchesFile(anchor.result.mediaPath, anchor.digest)) return
    // 异步核对期间取消、接收或完成均可能到达；不得用旧快照覆盖它们。
    const current = this.tasks.get(scope.requestId) ?? this.persistence?.get(scope.requestId)
    if (!current || current.result || current.acknowledgedAt !== undefined
      || JSON.stringify(current.outputPersistence) !== JSON.stringify(anchor)) return
    const next: CameraStageRenderTaskRecord = { ...current, status: 'completed', phase: null, progress: 1,
      result: anchor.result, message: null, updatedAt: Date.now() }
    this.persistence?.save(next, false)
    // 重启宿主的归属转移仍由 restore 在可信主窗口入口完成。
    if (this.tasks.has(scope.requestId)) this.tasks.set(scope.requestId, next)
  }

  applyEvent(event: CameraStageRenderEventDto): CameraStageRenderTaskSnapshotDto {
    const record = structuredClone(this.requireRecord(event.requestId))
    if (record.nodeId !== event.nodeId) throw new Error('Camera stage render event node does not match task')
    if (isTerminal(record.status)) return snapshot(record)
    if (event.type === 'progress') {
      Object.assign(record, {
        status: 'running',
        phase: event.phase,
        progress: event.progress,
        updatedAt: Date.now(),
      })
    } else if (event.type === 'completed') {
      if (record.outputPersistence && JSON.stringify(record.outputPersistence.result) !== JSON.stringify(event.result)) {
        // 比较语义字段，不依赖对象的属性枚举顺序。
        const anchor = record.outputPersistence.result
        if (Object.entries(anchor).some(([key, value]) => Reflect.get(event.result, key) !== value)) throw new Error('RENDER_OUTPUT_IDENTITY_CONFLICT')
      }
      Object.assign(record, {
        status: 'completed',
        phase: null,
        progress: 1,
        result: event.result,
        message: null,
        updatedAt: Date.now(),
      })
    } else if (event.type === 'failed') {
      Object.assign(record, {
        status: 'failed',
        phase: null,
        message: event.message,
        updatedAt: Date.now(),
      })
    } else {
      Object.assign(record, {
        status: 'cancelled',
        phase: null,
        message: null,
        updatedAt: Date.now(),
      })
    }
    // 终态先保存再发布；保存失败不能把内存成功当成持久成功。
    if (event.type !== 'progress') this.persistence?.save(record, false)
    this.tasks.set(record.requestId, record)
    return snapshot(record)
  }

  acknowledge(scope: CameraStageRenderTaskScopeDto, ownerWebContentsId: number): void {
    this.restore(scope.requestId, ownerWebContentsId, scope)
    const record = this.tasks.get(scope.requestId)
    if (!record) return
    this.assertScope(record, scope, ownerWebContentsId)
    if (!isTerminal(record.status)) throw new Error('Camera stage render task is not terminal')
    if (record.outputPersistence && !record.result) throw new Error('RENDER_OUTPUT_NEEDS_CHECK:结果文件仍待核对，不能清除原任务入口')
    this.persistence?.save({ ...record, acknowledgedAt: Date.now() }, false)
    this.acknowledged.set(scope.requestId, {
      ownerWebContentsId,
      fingerprint: record.requestFingerprint,
      expiresAt: Date.now() + 60 * 60 * 1000,
    })
    this.tasks.delete(scope.requestId)
    this.pruneAcknowledged()
  }

  clear(): void {
    this.tasks.clear()
    this.acknowledged.clear()
  }

  private pruneAcknowledged(): void {
    const now = Date.now()
    for (const [requestId, entry] of this.acknowledged) {
      if (entry.expiresAt <= now) this.acknowledged.delete(requestId)
    }
    while (this.acknowledged.size > 500) {
      const oldest = this.acknowledged.keys().next().value
      if (typeof oldest !== 'string') break
      this.acknowledged.delete(oldest)
    }
  }

  private requireRecord(requestId: string): CameraStageRenderTaskRecord {
    const record = this.tasks.get(requestId)
    if (!record) throw new Error('Camera stage render task does not exist')
    return record
  }

  private assertScope(
    record: CameraStageRenderTaskRecord,
    scope: CameraStageRenderTaskScopeDto,
    ownerWebContentsId: number,
  ): void {
    if (record.ownerWebContentsId !== ownerWebContentsId
      || record.canvasProjectId !== scope.canvasProjectId
      || record.nodeId !== scope.nodeId) {
      throw new Error('Camera stage render task does not belong to this host or canvas project')
    }
  }
}
