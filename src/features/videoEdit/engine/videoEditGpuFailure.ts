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

/**
 * 渲染会话的请求队列已满（背压，不是画面失败）：调用方应少发请求、稍后重试，不能当成渲染失败停播或提示用户。
 * 节目预览在发请求处按在途帧数限流，这个拒绝只是最后一道防线。
 */
export class VideoEditRenderBusyError extends Error {
  readonly code = 'video-edit-render-busy'
  constructor() {
    super('剪辑渲染请求过多。')
    this.name = 'VideoEditRenderBusyError'
  }
}
