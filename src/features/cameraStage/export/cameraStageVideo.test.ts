import { beforeEach, expect, it, vi } from 'vitest'

const video = vi.hoisted(() => ({
  appended: [] as Array<{ frameIndex: number; first: number }>,
  cancel: vi.fn(async () => undefined),
}))
vi.mock('@/commands/video', () => ({
  startVideoFrameExport: async () => ({ sessionId: 'session' }),
  // IPC 在调用当下复制数据：这里同样当场记下帧内容，之后渲染层复用缓冲不影响已送出的帧
  appendVideoFrameExport: ({ frameIndex, bytes }: { frameIndex: number; bytes: Uint8Array }) => {
    video.appended.push({ frameIndex, first: bytes[0] })
    return Promise.resolve({ frameIndex })
  },
  finishVideoFrameExport: async () => ({ mediaPath: 'out.mp4', savedPath: 'out.mp4', durationSeconds: 1, frameCount: 6, width: 4, height: 2 }),
  cancelVideoFrameExport: video.cancel,
  onVideoFrameExportProgress: () => () => undefined,
}))
vi.mock('@/platform/desktopApi', () => ({ join: async (...parts: string[]) => parts.join('/'), saveDialog: async () => null, toDisplaySrc: (value: string) => value }))

import { exportCameraStageVideo, type CameraStageVideoExportOptions } from './cameraStageVideo'

beforeEach(() => {
  video.appended = []
  video.cancel.mockClear()
})

/** 读回按给定顺序兑现，模拟显卡 fence 轮询先后不定；每帧把帧号写进目标缓冲。 */
function pipelineOptions(overrides: Partial<CameraStageVideoExportOptions> = {}) {
  const pending: Array<() => void> = []
  let seeked = 0
  const options: CameraStageVideoExportOptions = {
    projectName: 'p', cameraRatio: 2, renderCameraCount: 1, isMultiCamera: false, hasInconsistentCameraAspectRatio: false,
    fps: 6, durationSeconds: 1, resolutionPreset: '720p', renderStyle: 'beauty', saveToLocal: false,
    seekFrame: async () => { seeked += 1 },
    captureFrame: ({ target }) => {
      const frameIndex = seeked - 1
      return new Promise((resolve) => pending.push(() => { target[0] = frameIndex; resolve(target) }))
    },
    disposeCaptureFrame: vi.fn(),
    onProgress: () => undefined,
    onSession: () => undefined,
    isCancelled: () => false,
    ...overrides,
  }
  // 后提交的读回先兑现
  const flush = (): void => { while (pending.length) pending.pop()!() }
  return { options, pending, flush }
}

it('流水中读回乱序兑现，仍按帧序把各自的画面交给编码器', async () => {
  const { options, flush } = pipelineOptions()
  const timer = setInterval(flush, 1)
  try {
    const result = await exportCameraStageVideo(options)
    expect(result?.frameCount).toBe(6)
  } finally { clearInterval(timer) }
  expect(video.appended).toEqual([0, 1, 2, 3, 4, 5].map(frameIndex => ({ frameIndex, first: frameIndex })))
})

it('取消时先结束编码会话，等在途读回全部收口后才释放离屏资源', async () => {
  let cancelled = false
  const order: string[] = []
  const { options, pending } = pipelineOptions({
    isCancelled: () => cancelled,
    onProgress: ({ doneFrames }) => { if (doneFrames === 2) cancelled = true },
  })
  options.disposeCaptureFrame = () => { order.push(`dispose:${pending.length}`) }
  video.cancel.mockImplementation(async () => { order.push(`cancel:${pending.length}`) })
  // 读回慢于取消：取消发生时仍有帧在等显卡
  const timer = setInterval(() => pending.shift()?.(), 5)
  try {
    await expect(exportCameraStageVideo(options)).resolves.toBeNull()
  } finally { clearInterval(timer) }
  expect(order[0]).toMatch(/^cancel:[1-9]/)
  expect(order[1]).toBe('dispose:0')
  expect(video.appended.map(frame => frame.frameIndex)).toEqual([0, 1])
})
