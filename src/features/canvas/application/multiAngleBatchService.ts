import { createLogger } from '@/core/logging'

import {
  MULTI_ANGLE_BATCH_VERSION,
  MULTI_ANGLE_CONCURRENCY,
  createMultiAngleBatchPlan,
  type MultiAngleBatchPlanItem,
  type MultiAngleCompletedView,
  type MultiAngleControlProfile,
} from '../capabilities/multiAnglePolicy'

const logger = createLogger('features.canvas.multi-angle-batch')

export type MultiAngleBatchItemStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'cancelled'

export interface MultiAngleBatchItemStateV1 {
  viewId: string
  order: number
  label: string
  status: MultiAngleBatchItemStatus
  attempt: number
  modelId: string
  endpointId: string
  providerRequestId?: string
  mediaUrl?: string
  error?: string
}

export interface MultiAngleBatchSnapshotV1 {
  version: 1
  batchId: string
  sourceImage: string
  profile: MultiAngleControlProfile
  configFingerprint: string
  startedAt: number
  updatedAt: number
  items: MultiAngleBatchItemStateV1[]
}

export interface MultiAngleBatchExecutionResult {
  snapshot: MultiAngleBatchSnapshotV1
  completed: MultiAngleCompletedView[]
  complete: boolean
  errors: string[]
}

export interface MultiAngleBatchExecuteContext {
  signal: AbortSignal
  resumeProviderRequestId?: string
  onProviderRequestId: (requestId: string) => void
}

export interface ExecuteMultiAngleBatchInput {
  config: unknown
  sourceImage: string
  previous?: MultiAngleBatchSnapshotV1 | null
  signal?: AbortSignal
  execute: (
    plan: MultiAngleBatchPlanItem,
    context: MultiAngleBatchExecuteContext,
  ) => Promise<{ mediaUrl: string; providerRequestId?: string }>
  cancelTask?: (providerRequestId: string) => Promise<void>
  onSnapshot?: (snapshot: MultiAngleBatchSnapshotV1) => void
  now?: () => number
  createBatchId?: () => string
}

function fingerprintPlan(sourceImage: string, plan: readonly MultiAngleBatchPlanItem[]): string {
  return JSON.stringify({
    sourceImage,
    views: plan.map((item) => ({
      viewId: item.viewId,
      order: item.order,
      profile: item.profile,
      cameraControl: item.cameraControl,
    })),
  })
}

function cloneSnapshot(snapshot: MultiAngleBatchSnapshotV1): MultiAngleBatchSnapshotV1 {
  return { ...snapshot, items: snapshot.items.map((item) => ({ ...item })) }
}

function makeInitialSnapshot(input: {
  plan: readonly MultiAngleBatchPlanItem[]
  sourceImage: string
  previous?: MultiAngleBatchSnapshotV1 | null
  now: () => number
  createBatchId: () => string
}): MultiAngleBatchSnapshotV1 {
  const configFingerprint = fingerprintPlan(input.sourceImage, input.plan)
  const previous = input.previous?.version === 1
    && input.previous.configFingerprint === configFingerprint
    && input.previous.profile === input.plan[0].profile
    ? input.previous
    : null
  const previousById = new Map(previous?.items.map((item) => [item.viewId, item]) ?? [])
  const timestamp = input.now()
  return {
    version: MULTI_ANGLE_BATCH_VERSION,
    batchId: previous?.batchId ?? input.createBatchId(),
    sourceImage: input.sourceImage,
    profile: input.plan[0].profile,
    configFingerprint,
    startedAt: previous?.startedAt ?? timestamp,
    updatedAt: timestamp,
    items: input.plan.map((plan) => {
      const cached = previousById.get(plan.viewId)
      const reusable = cached?.status === 'succeeded' && cached.mediaUrl && cached.providerRequestId
      const resumable = cached?.status === 'running' && cached.providerRequestId
      return {
        viewId: plan.viewId,
        order: plan.order,
        label: plan.label,
        status: reusable ? 'succeeded' : 'pending',
        attempt: cached?.attempt ?? 0,
        modelId: plan.modelId,
        endpointId: plan.endpointId,
        ...(reusable || resumable ? {
          providerRequestId: cached.providerRequestId,
        } : {}),
        ...(reusable ? { mediaUrl: cached.mediaUrl } : {}),
      }
    }),
  }
}

function readError(error: unknown): string {
  return error instanceof Error && error.message.trim() ? error.message : '多角度视图生成失败'
}

export async function executeMultiAngleBatch(
  input: ExecuteMultiAngleBatchInput,
): Promise<MultiAngleBatchExecutionResult> {
  const now = input.now ?? Date.now
  const createBatchId = input.createBatchId ?? (() => `multi-angle-${crypto.randomUUID()}`)
  const plan = createMultiAngleBatchPlan(input.config, input.sourceImage)
  const controller = new AbortController()
  const onExternalAbort = (): void => controller.abort()
  input.signal?.addEventListener('abort', onExternalAbort, { once: true })
  let snapshot = makeInitialSnapshot({
    plan,
    sourceImage: input.sourceImage,
    previous: input.previous,
    now,
    createBatchId,
  })
  const planById = new Map(plan.map((item) => [item.viewId, item]))
  const emit = (): void => {
    snapshot = { ...snapshot, updatedAt: now(), items: snapshot.items.map((item) => ({ ...item })) }
    input.onSnapshot?.(cloneSnapshot(snapshot))
  }
  emit()

  logger.info('多角度批次开始', {
    event: 'canvas.multi_angle.batch.start',
    requestId: snapshot.batchId,
    providerId: 'fal',
    context: { profile: snapshot.profile, viewCount: plan.length, concurrency: MULTI_ANGLE_CONCURRENCY },
  })

  let cursor = 0
  const pending = snapshot.items.filter((item) => item.status !== 'succeeded')
  const takeNext = (): MultiAngleBatchItemStateV1 | undefined => {
    const item = pending[cursor]
    cursor += 1
    return item
  }
  const updateItem = (viewId: string, patch: Partial<MultiAngleBatchItemStateV1>): void => {
    snapshot = {
      ...snapshot,
      items: snapshot.items.map((item) => item.viewId === viewId ? { ...item, ...patch } : item),
    }
    emit()
  }

  const worker = async (): Promise<void> => {
    while (!controller.signal.aborted) {
      const item = takeNext()
      if (!item) return
      const itemPlan = planById.get(item.viewId)
      if (!itemPlan) return
      let requestId = item.providerRequestId ?? ''
      updateItem(item.viewId, { status: 'running', attempt: item.attempt + 1, error: undefined })
      try {
        const result = await input.execute(itemPlan, {
          signal: controller.signal,
          resumeProviderRequestId: requestId || undefined,
          onProviderRequestId: (value) => {
            requestId = value.trim()
            if (requestId) updateItem(item.viewId, { providerRequestId: requestId })
          },
        })
        if (controller.signal.aborted) {
          if (requestId && input.cancelTask) await input.cancelTask(requestId).catch(() => undefined)
          updateItem(item.viewId, { status: 'cancelled', error: '批次已取消' })
          continue
        }
        const mediaUrl = result.mediaUrl.trim()
        const providerRequestId = result.providerRequestId?.trim() || requestId
        if (!mediaUrl || !providerRequestId) {
          throw new Error('多角度视图缺少媒体或 Fal request ID')
        }
        updateItem(item.viewId, { status: 'succeeded', mediaUrl, providerRequestId, error: undefined })
      } catch (error) {
        updateItem(item.viewId, {
          status: controller.signal.aborted ? 'cancelled' : 'failed',
          error: controller.signal.aborted ? '批次已取消' : readError(error),
        })
      }
    }
  }

  try {
    await Promise.all(Array.from(
      { length: Math.min(MULTI_ANGLE_CONCURRENCY, pending.length) },
      () => worker(),
    ))
  } finally {
    input.signal?.removeEventListener('abort', onExternalAbort)
  }

  if (controller.signal.aborted) {
    for (const item of snapshot.items) {
      if (item.status === 'pending' || item.status === 'running') {
        if (item.providerRequestId && input.cancelTask) {
          await input.cancelTask(item.providerRequestId).catch(() => undefined)
        }
        updateItem(item.viewId, { status: 'cancelled', error: '批次已取消' })
      }
    }
  }

  const errors = snapshot.items
    .filter((item) => item.status === 'failed' || item.status === 'cancelled')
    .map((item) => `${item.label}：${item.error ?? '生成失败'}`)
  const complete = snapshot.items.length === plan.length
    && snapshot.items.every((item) => item.status === 'succeeded')
  const completed = complete
    ? snapshot.items.map((item) => ({
        plan: planById.get(item.viewId)!,
        mediaUrl: item.mediaUrl!,
        providerRequestId: item.providerRequestId!,
      }))
    : []

  logger[complete ? 'info' : 'warn'](complete ? '多角度批次完成' : '多角度批次未完成', {
    event: complete ? 'canvas.multi_angle.batch.completed' : 'canvas.multi_angle.batch.failed',
    requestId: snapshot.batchId,
    providerId: 'fal',
    context: { succeeded: snapshot.items.filter((item) => item.status === 'succeeded').length, errors },
  })
  return { snapshot: cloneSnapshot(snapshot), completed, complete, errors }
}
