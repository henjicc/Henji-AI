import type { CameraStageRenderPlatform } from '@/platform/contracts/cameraStageRender'

const DOMAIN = 'cameraStageRender'

function getNativeCameraStageRender(): NonNullable<typeof window.henjiNative>['cameraStageRender'] {
  const native = window.henjiNative
  if (!native?.cameraStageRender) {
    throw new Error(`[platform:${DOMAIN}] henjiNative.cameraStageRender is not available`)
  }
  return native.cameraStageRender
}

export function createElectronCameraStageRender(): CameraStageRenderPlatform {
  return {
    start: (request) => getNativeCameraStageRender().start(request),
    get: (scope) => getNativeCameraStageRender().get(scope),
    list: (canvasProjectId) => getNativeCameraStageRender().list(canvasProjectId),
    cancel: (scope) => getNativeCameraStageRender().cancel(scope),
    acknowledge: (scope) => getNativeCameraStageRender().acknowledge(scope),
    onEvent: (listener) => getNativeCameraStageRender().onEvent(listener),
    workerReady: () => getNativeCameraStageRender().workerReady(),
    onWorkerJob: (listener) => getNativeCameraStageRender().onWorkerJob(listener),
    onWorkerCancel: (listener) => getNativeCameraStageRender().onWorkerCancel(listener),
    reportWorkerEvent: (event) => getNativeCameraStageRender().reportWorkerEvent(event),
  }
}
