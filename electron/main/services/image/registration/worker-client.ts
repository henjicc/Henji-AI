import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { Worker, type TransferListItem } from 'node:worker_threads'

import { createMainLogger } from '../../logging'
import type { RegistrationQuality } from './quality-profiles'
import type { RegistrationFrame, RegistrationResult } from './types'
import {
  isRegistrationWorkerResponse,
  REGISTRATION_WORKER_PROTOCOL_VERSION,
  type RegistrationWorkerRequest,
} from './worker-contracts'

const logger = createMainLogger('main.image.registration_worker')

const DEFAULT_TIMEOUT_MS: Record<RegistrationQuality, number> = {
  fast: 15_000,
  precise: 30_000,
  extreme: 60_000,
}

export interface RegistrationWorkerExecutionResult {
  result: RegistrationResult
  movingData: Uint8Array
}

export interface RegistrationWorkerExecutionOptions {
  requestId?: string
  signal?: AbortSignal
  timeoutMs?: number
}

export interface RegistrationWorkerHandle {
  postMessage: (message: RegistrationWorkerRequest, transfer: readonly TransferListItem[]) => void
  onMessage: (listener: (message: unknown) => void) => () => void
  onError: (listener: (error: Error) => void) => () => void
  onExit: (listener: (code: number) => void) => () => void
  terminate: () => void
}

export type RegistrationWorkerFactory = () => RegistrationWorkerHandle

function createNodeWorkerHandle(): RegistrationWorkerHandle {
  const worker = new Worker(path.join(__dirname, 'image-registration-worker.cjs'), {
    name: 'henji-image-registration',
  })
  return {
    postMessage: (message, transfer) => worker.postMessage(message, transfer),
    onMessage: (listener) => {
      worker.on('message', listener)
      return () => worker.off('message', listener)
    },
    onError: (listener) => {
      worker.on('error', listener)
      return () => worker.off('error', listener)
    },
    onExit: (listener) => {
      worker.on('exit', listener)
      return () => worker.off('exit', listener)
    },
    terminate: () => { void worker.terminate() },
  }
}

function isolatedTransferView(data: Uint8Array): Uint8Array {
  if (!Buffer.isBuffer(data)
    && data.buffer instanceof ArrayBuffer
    && data.byteOffset === 0
    && data.byteLength === data.buffer.byteLength) {
    return data
  }
  return Uint8Array.from(data)
}

function transferableFrame(frame: RegistrationFrame): RegistrationFrame {
  return {
    ...frame,
    data: isolatedTransferView(frame.data),
    validMask: frame.validMask ? isolatedTransferView(frame.validMask) : undefined,
  }
}

function transferListFor(request: RegistrationWorkerRequest): TransferListItem[] {
  const buffers = new Set<ArrayBuffer>()
  const add = (view: Uint8Array | undefined): void => {
    if (view?.buffer instanceof ArrayBuffer) buffers.add(view.buffer)
  }
  add(request.referenceFrame.data)
  add(request.referenceFrame.validMask)
  add(request.movingFrame.data)
  add(request.movingFrame.validMask)
  return [...buffers]
}

function abortError(reason: unknown): Error {
  const error = new Error(reason === 'TIMEOUT' ? '图像配准计算超时' : '图像配准计算已取消')
  error.name = reason === 'TIMEOUT' ? 'TimeoutError' : 'AbortError'
  return error
}

export function createRegistrationWorkerExecutor(
  createWorker: RegistrationWorkerFactory = createNodeWorkerHandle,
): (
  referenceFrame: RegistrationFrame,
  movingFrame: RegistrationFrame,
  quality: RegistrationQuality,
  forceApplyResult?: boolean,
  options?: RegistrationWorkerExecutionOptions,
) => Promise<RegistrationWorkerExecutionResult> {
  return async (
    referenceFrame,
    movingFrame,
    quality,
    forceApplyResult = false,
    options = {},
  ) => {
    if (options.signal?.aborted) throw abortError(options.signal.reason)

    const requestId = options.requestId ?? randomUUID()
    const startedAt = performance.now()
    const request: RegistrationWorkerRequest = {
      type: 'registration.run',
      protocolVersion: REGISTRATION_WORKER_PROTOCOL_VERSION,
      requestId,
      referenceFrame: transferableFrame(referenceFrame),
      movingFrame: transferableFrame(movingFrame),
      quality,
      forceApplyResult,
    }
    const expectedMovingBytes = request.movingFrame.data.byteLength
    const worker = createWorker()

    logger.debug('图像配准 Worker 计算开始', {
      event: 'image.registration_worker.run.start',
      requestId,
      context: {
        quality,
        width: referenceFrame.width,
        height: referenceFrame.height,
      },
    })

    return await new Promise<RegistrationWorkerExecutionResult>((resolve, reject) => {
      let settled = false
      const disposers: Array<() => void> = []
      const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS[quality]
      const timer = setTimeout(() => fail(abortError('TIMEOUT')), timeoutMs)
      timer.unref()

      const dispose = (): void => {
        clearTimeout(timer)
        for (const remove of disposers) remove()
        options.signal?.removeEventListener('abort', onAbort)
      }
      const fail = (error: Error): void => {
        if (settled) return
        settled = true
        dispose()
        worker.terminate()
        logger.warn('图像配准 Worker 计算失败', {
          event: 'image.registration_worker.run.failed',
          requestId,
          context: {
            errorName: error.name,
            durationMs: Math.round(performance.now() - startedAt),
          },
        })
        reject(error)
      }
      const onAbort = (): void => fail(abortError(options.signal?.reason))
      const succeed = (result: RegistrationWorkerExecutionResult): void => {
        if (settled) return
        settled = true
        dispose()
        worker.terminate()
        logger.debug('图像配准 Worker 计算完成', {
          event: 'image.registration_worker.run.completed',
          requestId,
          context: {
            quality,
            success: result.result.success,
            durationMs: Math.round(performance.now() - startedAt),
          },
        })
        resolve(result)
      }

      disposers.push(worker.onMessage((raw) => {
        if (!isRegistrationWorkerResponse(raw) || raw.requestId !== requestId) {
          fail(new Error('图像配准 Worker 返回无效响应'))
          return
        }
        if (raw.movingData.byteLength !== expectedMovingBytes) {
          fail(new Error('图像配准 Worker 返回的像素缓冲长度不一致'))
          return
        }
        if (!raw.ok) {
          const error = new Error(raw.error.message)
          error.name = raw.error.name
          fail(error)
          return
        }
        succeed({ result: raw.result, movingData: raw.movingData })
      }))
      disposers.push(worker.onError((error) => fail(error)))
      disposers.push(worker.onExit((code) => {
        if (!settled) fail(new Error(`图像配准 Worker 意外退出（${code}）`))
      }))
      options.signal?.addEventListener('abort', onAbort, { once: true })

      try {
        worker.postMessage(request, transferListFor(request))
      } catch (error) {
        fail(error instanceof Error ? error : new Error(String(error)))
      }
    })
  }
}

export const registerLocalRedrawFramesInWorker = createRegistrationWorkerExecutor()
