import { getPlatform } from '@/platform'
import type {
  CameraStageRenderEvent,
  CameraStageRenderRequest,
  CameraStageRenderTaskScope,
  CameraStageRenderTaskSnapshot,
} from '@/platform/contracts/cameraStageRender'

export async function startCameraStageRender(
  request: CameraStageRenderRequest,
): Promise<{ task: CameraStageRenderTaskSnapshot; idempotent: boolean }> {
  return await getPlatform().cameraStageRender.start(request)
}

export async function getCameraStageRenderTask(scope: CameraStageRenderTaskScope): Promise<CameraStageRenderTaskSnapshot | null> {
  return await getPlatform().cameraStageRender.get(scope)
}

export async function listCameraStageRenderTasks(canvasProjectId: string): Promise<CameraStageRenderTaskSnapshot[]> {
  return await getPlatform().cameraStageRender.list(canvasProjectId)
}

export async function cancelCameraStageRender(scope: CameraStageRenderTaskScope): Promise<void> {
  await getPlatform().cameraStageRender.cancel(scope)
}

export async function acknowledgeCameraStageRender(scope: CameraStageRenderTaskScope): Promise<void> {
  await getPlatform().cameraStageRender.acknowledge(scope)
}

export function onCameraStageRenderEvent(
  listener: (event: CameraStageRenderTaskSnapshot) => void,
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
