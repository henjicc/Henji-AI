import type {
  CameraStageRenderEventDto,
  CameraStageRenderRequestDto,
  CameraStageRenderResultDto,
} from '../services/camera-stage-render'
import {
  cancelCameraStageRenderTask,
  handleCameraStageRenderWorkerEvent,
  markCameraStageRenderWorkerReady,
  startCameraStageRenderTask,
} from '../services/camera-stage-render'
import { parseRecord, parseStringField, parseVoid, registerIpcHandler } from './registry'

function parseRenderRequest(input: unknown): CameraStageRenderRequestDto {
  const record = parseRecord(input)
  const requestId = record.requestId
  const nodeId = record.nodeId
  const projectId = record.projectId
  const resolutionPreset = record.resolutionPreset
  const outputKind = record.outputKind
  const selectedTimeSec = record.selectedTimeSec === undefined ? undefined : Number(record.selectedTimeSec)
  if (typeof requestId !== 'string' || !requestId) throw new Error('Expected render requestId')
  if (typeof nodeId !== 'string' || !nodeId) throw new Error('Expected render nodeId')
  if (typeof projectId !== 'string' || !projectId) throw new Error('Expected render projectId')
  if (resolutionPreset !== '720p' && resolutionPreset !== '1080p') {
    throw new Error('Expected render resolutionPreset')
  }
  if (outputKind !== 'image' && outputKind !== 'video') throw new Error('Expected render outputKind')
  if (selectedTimeSec !== undefined && (!Number.isFinite(selectedTimeSec) || selectedTimeSec < 0)) {
    throw new Error('Expected non-negative render selectedTimeSec')
  }
  return { requestId, nodeId, projectId, resolutionPreset, outputKind, selectedTimeSec }
}

function parseRenderResult(input: unknown): CameraStageRenderResultDto {
  const record = parseRecord(input)
  const kind = record.kind
  const mediaUrl = record.mediaUrl
  const mediaPath = record.mediaPath
  const savedPath = record.savedPath
  const width = Number(record.width)
  const height = Number(record.height)
  if (typeof mediaUrl !== 'string' || typeof mediaPath !== 'string' || typeof savedPath !== 'string') {
    throw new Error('Expected camera stage render result paths')
  }
  if (![width, height].every(Number.isFinite)) throw new Error('Expected finite camera stage render dimensions')
  if (kind === 'image') {
    const aspectRatio = record.aspectRatio
    const selectedTimeSec = Number(record.selectedTimeSec)
    if (typeof aspectRatio !== 'string' || !aspectRatio || !Number.isFinite(selectedTimeSec)) {
      throw new Error('Expected camera stage image render metadata')
    }
    return { kind, mediaUrl, mediaPath, savedPath, width, height, aspectRatio, selectedTimeSec }
  }
  if (kind === 'video') {
    const durationSeconds = Number(record.durationSeconds)
    const frameCount = Number(record.frameCount)
    if (![durationSeconds, frameCount].every(Number.isFinite)) {
      throw new Error('Expected finite camera stage video render metadata')
    }
    return { kind, mediaUrl, mediaPath, savedPath, durationSeconds, frameCount, width, height }
  }
  throw new Error('Expected camera stage render result kind')
}

function parseWorkerEvent(input: unknown): CameraStageRenderEventDto {
  const record = parseRecord(input)
  const type = record.type
  const requestId = record.requestId
  const nodeId = record.nodeId
  if (typeof requestId !== 'string' || !requestId || typeof nodeId !== 'string' || !nodeId) {
    throw new Error('Expected camera stage render event identity')
  }
  if (type === 'progress') {
    const phase = record.phase
    const progress = Number(record.progress)
    if (phase !== 'preparing' && phase !== 'rendering' && phase !== 'encoding') {
      throw new Error('Expected camera stage render progress phase')
    }
    if (!Number.isFinite(progress)) throw new Error('Expected camera stage render progress value')
    return { type, requestId, nodeId, phase, progress: Math.max(0, Math.min(1, progress)) }
  }
  if (type === 'completed') {
    return { type, requestId, nodeId, result: parseRenderResult(record.result) }
  }
  if (type === 'failed') {
    const message = record.message
    if (typeof message !== 'string' || !message) throw new Error('Expected camera stage render error message')
    return { type, requestId, nodeId, message }
  }
  if (type === 'cancelled') return { type, requestId, nodeId }
  throw new Error('Expected camera stage render event type')
}

export function registerCameraStageRenderIpc(): void {
  registerIpcHandler<CameraStageRenderRequestDto, { accepted: true }>(
    'cameraStageRender:start',
    parseRenderRequest,
    (request, event) => startCameraStageRenderTask(request, event.sender.id),
  )
  registerIpcHandler<{ requestId: string }, void>(
    'cameraStageRender:cancel',
    (input) => ({ requestId: parseStringField(input, 'requestId') }),
    ({ requestId }) => cancelCameraStageRenderTask(requestId),
  )
  registerIpcHandler<void, void>(
    'cameraStageRender:workerReady',
    parseVoid,
    (_input, event) => markCameraStageRenderWorkerReady(event.sender.id),
  )
  registerIpcHandler<CameraStageRenderEventDto, void>(
    'cameraStageRender:workerEvent',
    parseWorkerEvent,
    (workerEvent, event) => handleCameraStageRenderWorkerEvent(workerEvent, event.sender.id),
  )
}
