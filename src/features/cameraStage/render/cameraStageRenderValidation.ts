import type { CameraStageRenderOutputKind } from '@/platform/contracts/cameraStageRender'

export function assertCameraStageRenderOutputKind(
  outputKind: unknown,
): asserts outputKind is CameraStageRenderOutputKind {
  if (outputKind !== 'image' && outputKind !== 'video') {
    throw new Error('渲染请求缺少有效的输出类型，请重启应用后重试')
  }
}

export function assertCameraStageVideoRenderable(
  stateKeyframeCount: number,
  durationSeconds: number,
): void {
  if (stateKeyframeCount <= 1) {
    throw new Error('当前工程只有一个状态关键帧，应输出图片；输出视频至少需要两个状态关键帧')
  }
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    throw new Error('当前工程的视频时长无效，请调整关键帧时间后重试')
  }
}
