import type { SpatialOutput, SpatialPropagationRequest, PlanSpatialPropagation, SpatialSnapshot, SpatialLayoutIntent, SpatialPatch } from '@/core/videoEdit/spatialTypes'
import type { MotionCandidate, MotionCandidateResult, OptimizeMotionInput } from '@/core/creativeIntent/candidates'
import { CreativeIntentError } from '@/core/creativeIntent/sampling'
import type { MotionSample } from '@/core/creativeIntent/contracts'
import type { MotionWorkerRequest, MotionOptimizationResponse, SpatialWorkerResponse } from '../engine/videoEditMotionWorkerProtocol'

import { videoEditMotionWorkerLifecycle as lifecycle } from './videoEditMotionWorkerLifecycle'

// 只缓存一个空闲计算进程，控制常驻内存；并发任务各自拥有 Worker，不限制项目或任务数量。
const IDLE_WORKER_MS = 10000
let idle: { worker: Worker; ownerId: string; timer: ReturnType<typeof setTimeout> } | undefined
let unsubscribeIdle: (() => void) | undefined
function takeWorker(): Worker {
  if (!idle) return new Worker(new URL('../engine/videoEditMotionWorker.ts', import.meta.url), { type: 'module' })
  const { worker, timer } = idle; clearTimeout(timer); idle = undefined; unsubscribeIdle?.(); unsubscribeIdle = undefined
  return worker
}
function discardIdle(): void {
  if (idle) { clearTimeout(idle.timer); idle.worker.terminate(); idle = undefined }
  unsubscribeIdle?.(); unsubscribeIdle = undefined
}
function recycleWorker(worker: Worker, ownerId: string): void {
  discardIdle()
  if (!lifecycle?.isOpen(ownerId)) { worker.terminate(); return }
  idle = { worker, ownerId, timer: setTimeout(discardIdle, IDLE_WORKER_MS) }
  unsubscribeIdle = lifecycle.subscribe(() => { if (idle && !lifecycle?.isOpen(idle.ownerId)) discardIdle() })
}
export function optimizeVideoEditMotionOffThread(input: OptimizeMotionInput, signal: AbortSignal, pages?: AsyncIterable<MotionSample[]>): Promise<{ result: MotionCandidateResult; original?: MotionCandidate }> {
  signal.throwIfAborted()
  const worker = takeWorker()
  return new Promise((resolve, reject) => {
    let settled = false
    let acknowledge: (() => void) | undefined; let failPage: ((error: unknown) => void) | undefined
    const finish = (reusable = false): void => { settled = true; worker.onmessage = null; worker.onerror = null; signal.removeEventListener('abort', abort); if (reusable) recycleWorker(worker, input.draft.ownerRef.id); else worker.terminate() }
    const abort = (): void => { if (settled) return; const error = signal.reason ?? new Error('整理已取消，原稿保留。'); finish(); failPage?.(error); reject(error) }
    worker.onmessage = (event: MessageEvent<MotionOptimizationResponse>): void => {
      if (settled) return
      if ('kind' in event.data) { acknowledge?.(); return }
      if ('result' in event.data) { finish(true); resolve(event.data) }
      else { finish(); const error = new CreativeIntentError(event.data.code ?? 'worker', event.data.refs, event.data.error); failPage?.(error); reject(error) }
    }
    worker.onerror = event => { if (settled) return; const error = new Error(event.message); finish(); failPage?.(error); reject(error) }
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) { abort(); return }
    const send = (message: MotionWorkerRequest): Promise<void> => new Promise((resolve, reject) => { signal.throwIfAborted(); acknowledge = resolve; failPage = reject; worker.postMessage(message) })
    const feed = async (): Promise<void> => {
      await send({ kind: 'begin', input })
      if (pages) for await (const entries of pages) { signal.throwIfAborted(); await send({ kind: 'page', entries }) }
      signal.throwIfAborted(); failPage = undefined; worker.postMessage({ kind: 'compile' } satisfies MotionWorkerRequest)
    }
    void feed().catch(error => { if (!settled) { finish(); reject(error) } })
  })
}

/** 每个计算独占 Worker；取消立即终止，迟到结果不能写回作品。 */
function spatialOffThread(ownerId: string, request: Extract<MotionWorkerRequest, { kind: 'spatial-evaluate' | 'spatial-propagate' | 'spatial-layout' }>, signal: AbortSignal): Promise<Exclude<SpatialWorkerResponse, { error: string }>> {
  signal.throwIfAborted()
  const worker = takeWorker()
  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (reusable: boolean): void => {
      settled = true; worker.onmessage = null; worker.onerror = null; signal.removeEventListener('abort', abort)
      if (reusable) {
        const documentId = lifecycle?.ownerOf(ownerId)
        if (documentId) recycleWorker(worker, documentId); else worker.terminate()
      } else worker.terminate()
    }
    const abort = (): void => { if (!settled) { finish(false); reject(signal.reason ?? new DOMException('空间计算已取消。', 'AbortError')) } }
    worker.onmessage = (event: MessageEvent<SpatialWorkerResponse>): void => {
      if (settled) return
      if ('error' in event.data) { finish(false); reject(Object.assign(new Error(event.data.error), { facts: event.data.facts, code: event.data.code })); return }
      finish(true); resolve(event.data)
    }
    worker.onerror = event => { if (!settled) { finish(false); reject(new Error(event.message)) } }
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) { abort(); return }
    try { worker.postMessage(request) } catch (error) { finish(false); reject(error) }
  })
}
export async function planVideoEditSpatialPropagationOffThread(request: SpatialPropagationRequest): ReturnType<PlanSpatialPropagation> {
  const { signal, ...input } = request
  const result = await spatialOffThread(request.before.composition.id, { kind: 'spatial-propagate', request: input }, signal)
  if (result.kind !== 'spatial-propagation') throw new Error('空间传播返回了不匹配的结果。')
  return result.result
}
export async function planVideoEditSpatialLayoutOffThread(snapshot: SpatialSnapshot, intent: SpatialLayoutIntent, output: SpatialOutput, signal: AbortSignal): Promise<SpatialPatch> {
  const result = await spatialOffThread(snapshot.sequenceId, { kind: 'spatial-layout', snapshot, intent, output }, signal)
  if (result.kind !== 'spatial-layout') throw new Error('空间布局返回了不匹配的结果。')
  return result.patch
}
