/** Device loss invalidates every texture and pipeline in the session; decoder fallback cannot repair it. */
export class VideoEditGpuDeviceLostError extends Error {
  readonly code = 'video-edit-gpu-device-lost'
  constructor(readonly detail: string) {
    super('画面处理已中断，请重新加载预览。', { cause: new Error(detail) })
    this.name = 'VideoEditGpuDeviceLostError'
  }
}

export function videoEditRenderFailure(error: unknown): { error: string; gpuDeviceLost?: string } {
  return { error: error instanceof Error ? error.message : String(error),
    ...(error instanceof VideoEditGpuDeviceLostError ? { gpuDeviceLost: error.detail } : {}) }
}
