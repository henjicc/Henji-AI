import { getPlatform } from '@/platform'
import type {
  CameraStageRenderEvent,
  CameraStageRenderRequest,
} from '@/platform/contracts/cameraStageRender'

export async function startCameraStageRender(
  request: CameraStageRenderRequest,
): Promise<{ accepted: true }> {
  return await getPlatform().cameraStageRender.start(request)
}

export async function cancelCameraStageRender(requestId: string): Promise<void> {
  await getPlatform().cameraStageRender.cancel(requestId)
}

export function onCameraStageRenderEvent(
  listener: (event: CameraStageRenderEvent) => void,
): () => void {
  return getPlatform().cameraStageRender.onEvent(listener)
}

export async function notifyCameraStageRenderWorkerReady(): Promise<void> {
  await getPlatform().cameraStageRender.workerReady()
}

export function onCameraStageRenderWorkerJob(
  listener: (request: CameraStageRenderRequest) => void,
): () => void {
  return getPlatform().cameraStageRender.onWorkerJob(listener)
}

export function onCameraStageRenderWorkerCancel(
  listener: (requestId: string) => void,
): () => void {
  return getPlatform().cameraStageRender.onWorkerCancel(listener)
}

export async function reportCameraStageRenderWorkerEvent(
  event: CameraStageRenderEvent,
): Promise<void> {
  await getPlatform().cameraStageRender.reportWorkerEvent(event)
}
