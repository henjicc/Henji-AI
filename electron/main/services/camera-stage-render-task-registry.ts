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

interface CameraStageRenderTaskRecord extends CameraStageRenderTaskSnapshotDto {
  ownerWebContentsId: number
  requestFingerprint: string
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
  ])
}

function snapshot(record: CameraStageRenderTaskRecord): CameraStageRenderTaskSnapshotDto {
  const { ownerWebContentsId: _owner, requestFingerprint: _fingerprint, ...value } = record
  return structuredClone(value)
}

function isTerminal(status: CameraStageRenderTaskStatus): boolean {
  return status === 'completed' || status === 'failed' || status === 'cancelled'
}

export class CameraStageRenderTaskRegistry {
  private readonly tasks = new Map<string, CameraStageRenderTaskRecord>()
  private readonly acknowledged = new Map<string, { ownerWebContentsId: number; fingerprint: string; expiresAt: number }>()

  register(request: CameraStageRenderRequestDto, ownerWebContentsId: number): CameraStageRenderTaskRegistration {
    this.pruneAcknowledged()
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
      return { task: snapshot(existing), idempotent: true }
    }
    const now = Date.now()
    const record: CameraStageRenderTaskRecord = {
      ...request,
      ownerWebContentsId,
      requestFingerprint: fingerprint,
      status: 'queued',
      phase: 'preparing',
      progress: 0,
      result: null,
      message: null,
      createdAt: now,
      updatedAt: now,
    }
    this.tasks.set(request.requestId, record)
    return { task: snapshot(record), idempotent: false }
  }

  require(scope: CameraStageRenderTaskScopeDto, ownerWebContentsId: number): CameraStageRenderTaskSnapshotDto | null {
    const record = this.tasks.get(scope.requestId)
    if (!record) return null
    this.assertScope(record, scope, ownerWebContentsId)
    return snapshot(record)
  }

  list(canvasProjectId: string, ownerWebContentsId: number): CameraStageRenderTaskSnapshotDto[] {
    return [...this.tasks.values()]
      .filter((record) => record.ownerWebContentsId === ownerWebContentsId
        && record.canvasProjectId === canvasProjectId)
      .sort((left, right) => left.createdAt - right.createdAt)
      .map(snapshot)
  }

  markRunning(requestId: string): void {
    const record = this.requireRecord(requestId)
    if (record.status !== 'queued') throw new Error('Camera stage render task is not queued')
    Object.assign(record, { status: 'running', updatedAt: Date.now() })
  }

  applyEvent(event: CameraStageRenderEventDto): CameraStageRenderTaskSnapshotDto {
    const record = this.requireRecord(event.requestId)
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
    return snapshot(record)
  }

  acknowledge(scope: CameraStageRenderTaskScopeDto, ownerWebContentsId: number): void {
    const record = this.tasks.get(scope.requestId)
    if (!record) return
    this.assertScope(record, scope, ownerWebContentsId)
    if (!isTerminal(record.status)) throw new Error('Camera stage render task is not terminal')
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
