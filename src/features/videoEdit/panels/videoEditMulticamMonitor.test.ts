import { beforeEach, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ note: vi.fn(), present: vi.fn(async () => ({ id: 1, presented: true })) }))
vi.mock('../application/videoEditRenderCache', () => ({ noteVideoEditProgramSideLoad: state.note }))
vi.mock('../application/videoEditService', () => ({
  subscribeVideoEditView: () => () => undefined, subscribeVideoEditDomain: () => () => undefined, listVideoEditInstances: () => [],
  getActiveVideoEditSequence: () => ({}), videoEditProgramCommandIdentity: () => ({}),
}))
vi.mock('../application/videoEditMulticam', () => ({ videoEditProgramMulticam: () => undefined }))
vi.mock('../application/videoEditProxy', () => ({ getVideoEditProxySources: () => ({}) }))
vi.mock('../application/videoEditMulticamPlayback', () => ({ ensureVideoEditMulticamPlayback: async () => undefined, readVideoEditMulticamPlayback: () => undefined, reportVideoEditMulticamPlayback: () => undefined }))
vi.mock('../engine/videoEditRenderSession', () => ({ VideoEditRenderSession: class {} }))
vi.mock('../engine/videoEditMulticamGrid', () => ({ videoEditMulticamGrid: () => undefined, videoEditMulticamGridDivisor: () => 1, videoEditMulticamProxyKey: () => '' }))
import { VideoEditMulticamMonitor } from './videoEditMulticamMonitor'

type Instance = ConstructorParameters<typeof VideoEditMulticamMonitor>[0]
const canvas = (width: number): HTMLCanvasElement => ({ getBoundingClientRect: () => ({ width, height: width }) }) as unknown as HTMLCanvasElement
beforeEach(() => { vi.clearAllMocks() })

it('格子没有尺寸（或窗口隐藏）时不出帧，也不登记节目旁负载；每请求一帧网格画面就登记一次', async () => {
  const instance = { document: { id: 'p' }, frame: 0, playing: false } as unknown as Instance
  const monitor = new VideoEditMulticamMonitor(instance, 'source', [canvas(0)], { presented: () => undefined, failed: () => undefined })
  await new Promise(resolve => setTimeout(resolve, 0))
  expect(state.note).not.toHaveBeenCalled()
  // 出帧的唯一入口：请求一帧网格画面时登记。
  const request = (monitor as unknown as { request(session: unknown, grid: number, sequential: boolean, scrubbing: boolean): void }).request.bind(monitor)
  request({ present: state.present }, 0, false, false)
  expect(state.note).toHaveBeenCalledWith(instance)
  await monitor.dispose()
})
